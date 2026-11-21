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

import {
  computeSpaceMembers,
  notEmpty,
  readOnlyGuestAccountUuid,
  type Ref,
  type Space,
  type UserGroup
} from '@hcengineering/core'

export type SpaceOperation = 'members' | 'groups' | 'autojoin' | 'guest-autojoin'

export function getSpaceOperationKey (space: Space, operation: SpaceOperation): string {
  return `${space._id}:${operation}`
}

export function isSpaceOperationPending (
  pendingOperations: Set<string>,
  space: Space,
  operation?: SpaceOperation
): boolean {
  if (operation !== undefined) return pendingOperations.has(getSpaceOperationKey(space, operation))
  return [...pendingOperations].some((key) => key.startsWith(`${space._id}:`))
}

/** A change of user groups or of their bindings, checked before it is written. */
export interface UserGroupsChange {
  /** The groups after the change (a removed group is absent, a changed one has its new members). */
  groups: UserGroup[]
  /** New bindings of spaces, by space. Spaces not listed keep their groups. */
  bindings?: Map<Ref<Space>, Array<Ref<UserGroup>>>
}

/**
 * Private spaces that have members now and would have none after the change: nobody could open them anymore, not
 * even workspace owners in Access control. `members` after the change is `directMembers ∪ members of groups`, as
 * the server computes it.
 */
export function getSpacesLeftWithoutMembers (spaces: Space[], change: UserGroupsChange): Space[] {
  const groups = new Map(change.groups.map((group) => [group._id, group]))
  return spaces.filter((space) => {
    if (!space.private || space.archived) return false
    const current = space.members.filter((member) => member !== readOnlyGuestAccountUuid)
    if (current.length === 0) return false
    const bound = change.bindings?.get(space._id) ?? space.groups ?? []
    const next = computeSpaceMembers(
      space.directMembers ?? space.members,
      bound.map((id) => groups.get(id)).filter(notEmpty)
    )
    return next.filter((member) => member !== readOnlyGuestAccountUuid).length === 0
  })
}
