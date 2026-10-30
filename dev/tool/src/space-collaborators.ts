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

import contact from '@hcengineering/contact'
import core, {
  type AccountUuid,
  type Class,
  type Collaborator,
  type Doc,
  type Ref,
  type Space,
  type TxOperations
} from '@hcengineering/core'

// Spelled out: the tool does not depend on the notification plugin.
const DOC_NOTIFY_CONTEXT = 'notification:class:DocNotifyContext' as Ref<Class<NotifyContextDoc>>

interface NotifyContextDoc extends Doc {
  objectId: Ref<Doc>
  user: AccountUuid
}

const GUEST_ROLES = ['GUEST', 'READONLYGUEST']
const CHUNK = 500

export interface StaleSpaceCollaborator {
  space: Ref<Space>
  spaceClass: Ref<Class<Space>>
  spaceName: string
  account: AccountUuid
  role: string | undefined
}

export interface CleanupSpaceCollaboratorsResult {
  stale: StaleSpaceCollaborator[]
  removedCollaborators: number
  removedContexts: number
}

export interface CleanupSpaceCollaboratorsOptions {
  dryRun: boolean
  /** Also remove stale collaborators that are not guests; by default only guests, whose access depends on it. */
  includeUsers: boolean
}

/**
 * Finds collaborators of spaces left outside `members`: removing a member with a full replacement of `members`
 * used to keep the collaborator, and a guest collaborator keeps reading the messages of the space.
 *
 * Only space classes whose collaborators come from `members` alone are checked (e.g. Channel, DirectMessage);
 * there every collaborator outside `members` is stale.
 */
export async function cleanupSpaceCollaborators (
  ops: TxOperations,
  options: CleanupSpaceCollaboratorsOptions
): Promise<CleanupSpaceCollaboratorsResult> {
  const hierarchy = ops.getHierarchy()
  const spaceClasses = ops
    .getModel()
    .findAllSync(core.class.ClassCollaborators, {})
    .filter(
      (it) =>
        hierarchy.isDerived(it.attachedTo, core.class.Space) &&
        it.allFields !== true &&
        it.fields.length === 1 &&
        (it.fields[0] as string) === 'members'
    )
    .map((it) => it.attachedTo as Ref<Class<Space>>)

  const spaces = new Map<Ref<Space>, Space>()
  for (const _class of spaceClasses) {
    for (const space of await ops.findAll(_class, {})) {
      spaces.set(space._id, space)
    }
  }

  const candidates: Array<{ collaborator: Collaborator, space: Space }> = []
  const ids = Array.from(spaces.keys())
  for (let i = 0; i < ids.length; i += CHUNK) {
    const collaborators = await ops.findAll(core.class.Collaborator, { attachedTo: { $in: ids.slice(i, i + CHUNK) } })
    for (const collaborator of collaborators) {
      const space = spaces.get(collaborator.attachedTo as Ref<Space>)
      if (space !== undefined && !space.members.includes(collaborator.collaborator)) {
        candidates.push({ collaborator, space })
      }
    }
  }

  const accounts = Array.from(new Set(candidates.map((it) => it.collaborator.collaborator)))
  const roles = new Map<AccountUuid, string>()
  for (let i = 0; i < accounts.length; i += CHUNK) {
    const employees = await ops.findAll(contact.mixin.Employee, { personUuid: { $in: accounts.slice(i, i + CHUNK) } })
    for (const employee of employees) {
      if (employee.personUuid !== undefined && employee.role !== undefined) {
        roles.set(employee.personUuid, employee.role)
      }
    }
  }

  const result: CleanupSpaceCollaboratorsResult = { stale: [], removedCollaborators: 0, removedContexts: 0 }
  for (const { collaborator, space } of candidates) {
    const account = collaborator.collaborator
    const role = roles.get(account)
    if (!options.includeUsers && (role === undefined || !GUEST_ROLES.includes(role))) continue

    const stale: StaleSpaceCollaborator = {
      space: space._id,
      spaceClass: space._class,
      spaceName: space.name,
      account,
      role
    }
    result.stale.push(stale)

    if (options.dryRun) {
      console.log('[dry-run] stale space collaborator', JSON.stringify(stale))
      continue
    }

    await ops.remove(collaborator)
    result.removedCollaborators++
    for (const context of await ops.findAll(DOC_NOTIFY_CONTEXT, { objectId: space._id, user: account })) {
      await ops.remove(context)
      result.removedContexts++
    }
  }

  return result
}
