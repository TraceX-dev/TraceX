//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import core, {
  type AccountUuid,
  type Class,
  type Ref,
  type Space,
  type SpaceType,
  type Tx,
  type TxCreateDoc,
  type TxUpdateDoc,
  type TypedSpace,
  type UserGroup
} from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'

const SOURCE_FIELDS = ['directMembers', 'groups']

function touches (ops: Record<string, any>, field: string): boolean {
  return ops[field] !== undefined || ops.$push?.[field] !== undefined || ops.$pull?.[field] !== undefined
}

/**
 * Accounts that the groups make members of a space. The single place that resolves groups: nested groups, when
 * added, extend this function without changing the `Space.members` contract.
 */
export async function resolveGroupMembers (
  control: Pick<TriggerControl, 'findAll' | 'ctx'>,
  groups: Array<Ref<UserGroup>>
): Promise<Set<AccountUuid>> {
  const result = new Set<AccountUuid>()
  if (groups.length === 0) return result
  const docs = await control.findAll(control.ctx, core.class.UserGroup, { _id: { $in: groups } })
  for (const group of docs) {
    for (const member of group.members ?? []) {
      result.add(member)
    }
  }
  return result
}

/**
 * Brings `members` of the space to `unique(directMembers ∪ members of groups)` with plain `$push` / `$pull`
 * updates, so space security, caches, subscriptions and collaborators follow it as for any member change.
 * Accounts that left `members` completely also leave the roles of the space, as the members editor does.
 */
export async function recomputeSpaceMembers (control: TriggerControl, space: Space): Promise<Tx[]> {
  const direct = space.directMembers ?? space.members ?? []
  const target = new Set<AccountUuid>([...direct, ...(await resolveGroupMembers(control, space.groups ?? []))])
  const current = space.members ?? []

  const added = Array.from(target).filter((it) => !current.includes(it))
  const removed = Array.from(new Set(current)).filter((it) => !target.has(it))

  const result: Tx[] = []
  if (added.length > 0) {
    result.push(
      control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, {
        $push: { members: added.length === 1 ? added[0] : { $each: added, $position: 0 } }
      })
    )
  }
  if (removed.length > 0) {
    result.push(
      control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, {
        $pull: { members: removed.length === 1 ? removed[0] : { $in: removed } }
      })
    )
    result.push(...removeFromRoles(control, space, removed))
  }
  return result
}

function removeFromRoles (control: TriggerControl, space: Space, removed: AccountUuid[]): Tx[] {
  const hierarchy = control.hierarchy
  if (!hierarchy.isDerived(space._class, core.class.TypedSpace)) return []
  const typeId = (space as TypedSpace).type
  const spaceType = control.modelDb.findAllSync<SpaceType>(core.class.SpaceType, { _id: typeId })[0]
  const mixin = spaceType?.targetClass
  if (mixin === undefined || !hierarchy.hasMixin(space, mixin)) return []

  const assignment = hierarchy.as(space, mixin) as unknown as Record<string, unknown>
  const roles = control.modelDb.findAllSync(core.class.Role, { attachedTo: typeId })
  const update: Record<string, AccountUuid[]> = {}
  for (const role of roles) {
    const assigned = assignment[role._id]
    if (!Array.isArray(assigned)) continue
    const kept = (assigned as AccountUuid[]).filter((it) => !removed.includes(it))
    if (kept.length !== assigned.length) update[role._id] = kept
  }
  if (Object.keys(update).length === 0) return []
  return [control.txFactory.createTxMixin(space._id, space._class, space.space, mixin, update)]
}

async function findSpace (
  control: TriggerControl,
  _class: Ref<Class<Space>>,
  _id: Ref<Space>
): Promise<Space | undefined> {
  return (await control.findAll(control.ctx, _class, { _id }, { limit: 1 }))[0]
}

/**
 * Keeps `Space.members` computed from `directMembers` and `groups`.
 *
 * - Space created without `directMembers` (by a server trigger or an old client): `directMembers = members`.
 * - `directMembers` or `groups` changed: `members` is recomputed.
 * Changes of `members` itself (including the ones emitted here) do not trigger a recompute.
 */
export async function OnSpaceMembershipChange (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  for (const tx of txes) {
    if (tx._class === core.class.TxCreateDoc) {
      const create = tx as TxCreateDoc<Space>
      const attributes = create.attributes as Partial<Space>
      if (attributes.directMembers === undefined) {
        result.push(
          control.txFactory.createTxUpdateDoc(create.objectClass, create.objectSpace, create.objectId, {
            directMembers: [...(attributes.members ?? [])]
          })
        )
        continue
      }
      if ((attributes.groups ?? []).length === 0) continue
    } else if (tx._class === core.class.TxUpdateDoc) {
      const ops = (tx as TxUpdateDoc<Space>).operations as Record<string, any>
      if (!SOURCE_FIELDS.some((field) => touches(ops, field))) continue
    } else {
      continue
    }

    const { objectClass, objectId } = tx as TxCreateDoc<Space>
    const space = await findSpace(control, objectClass, objectId)
    if (space === undefined) continue
    result.push(...(await recomputeSpaceMembers(control, space)))
  }
  return result
}

/**
 * Follows changes of user groups: a membership change recomputes every bound space, a removed group is unbound
 * from its spaces (which recomputes them).
 */
export async function OnUserGroupChange (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  for (const tx of txes) {
    const groupId = (tx as TxUpdateDoc<UserGroup>).objectId
    if (tx._class === core.class.TxRemoveDoc) {
      const spaces = await control.findAll(control.ctx, core.class.Space, { groups: groupId })
      for (const space of spaces) {
        result.push(
          control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, { $pull: { groups: groupId } })
        )
      }
      continue
    }
    if (tx._class !== core.class.TxUpdateDoc) continue
    const ops = (tx as TxUpdateDoc<UserGroup>).operations as Record<string, any>
    if (!touches(ops, 'members')) continue

    const spaces = await control.findAll(control.ctx, core.class.Space, { groups: groupId })
    for (const space of spaces) {
      result.push(...(await recomputeSpaceMembers(control, space)))
    }
  }
  return result
}
