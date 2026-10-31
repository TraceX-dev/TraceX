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
  touchesAttribute,
  type TxCUD,
  type Tx,
  type TxCreateDoc,
  type TxUpdateDoc,
  type TypedSpace,
  type UserGroup
} from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'

const SOURCE_FIELDS = ['directMembers', 'groups']

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
  let changed = false
  for (const role of roles) {
    const assigned = assignment[role._id]
    if (!Array.isArray(assigned)) continue
    const kept = (assigned as AccountUuid[]).filter((it) => !removed.includes(it))
    update[role._id] = kept
    if (kept.length !== assigned.length) changed = true
  }
  if (!changed) return []
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
 * Recomputes each affected space once per batch, including changes to bound groups.
 * Legacy creates initialize directMembers before the membership delta is applied.
 */
export async function OnSpaceMembershipChange (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  const affected = new Map<Ref<Space>, Space>()
  const removedGroups = new Set<Ref<UserGroup>>()
  for (const tx of txes) {
    const cud = tx as TxCUD<Space | UserGroup>
    if (control.hierarchy.isDerived(cud.objectClass, core.class.UserGroup)) {
      if (tx._class === core.class.TxRemoveDoc) {
        removedGroups.add(cud.objectId as Ref<UserGroup>)
      } else if (tx._class !== core.class.TxUpdateDoc ||
        !touchesAttribute((tx as TxUpdateDoc<UserGroup>).operations, 'members')) {
        continue
      }
      const spaces = await control.findAll(control.ctx, core.class.Space, { groups: cud.objectId as Ref<UserGroup> })
      for (const space of spaces) affected.set(space._id, space)
      continue
    }
    if (tx._class === core.class.TxCreateDoc) {
      const create = tx as TxCreateDoc<Space>
      const attributes = create.attributes as Partial<Space>
      const directMembers = attributes.directMembers ?? [...(attributes.members ?? [])]
      if (attributes.directMembers === undefined) {
        result.push(
          control.txFactory.createTxUpdateDoc(create.objectClass, create.objectSpace, create.objectId, { directMembers })
        )
      }
      const space = await findSpace(control, create.objectClass, create.objectId)
      if (space !== undefined) affected.set(space._id, { ...space, directMembers })
    } else if (tx._class === core.class.TxUpdateDoc) {
      const update = tx as TxUpdateDoc<Space>
      if (!SOURCE_FIELDS.some((field) => touchesAttribute(update.operations, field))) continue
      if (affected.has(update.objectId)) continue
      const space = await findSpace(control, update.objectClass, update.objectId)
      if (space !== undefined) affected.set(space._id, space)
    }
  }
  for (const space of affected.values()) {
    const groups = space.groups ?? []
    for (const group of groups) {
      if (!removedGroups.has(group)) continue
      result.push(
        control.txFactory.createTxUpdateDoc(space._class, space.space, space._id, { $pull: { groups: group } })
      )
    }
    const current = removedGroups.size === 0
      ? space
      : { ...space, groups: groups.filter((group) => !removedGroups.has(group)) }
    result.push(...(await recomputeSpaceMembers(control, current)))
  }
  return result
}

/** Follows user group changes using the same batch recomputation as space changes. */
export async function OnUserGroupChange (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  return await OnSpaceMembershipChange(txes, control)
}
