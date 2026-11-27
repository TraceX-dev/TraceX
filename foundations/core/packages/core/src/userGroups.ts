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

import { AccountRole, type AccountUuid, type Class, type Doc, type Ref, type Space, type UserGroup } from './classes'
import core from './component'
import type { Hierarchy } from './hierarchy'

/**
 * System spaces that guests can not read (see `isGuestHiddenSpacesRole`): space security leaves them out of the
 * spaces a guest may see, so documents there and their transactions reach neither guest queries, lookups,
 * associations, full-text search nor broadcasts. Other accounts see them as any system space.
 */
export const guestHiddenSpaces: ReadonlySet<Ref<Space>> = new Set([core.space.UserGroups])

export function isSpaceHiddenFromGuests (space: Ref<Space> | undefined): boolean {
  return space !== undefined && guestHiddenSpaces.has(space)
}

/** Roles that do not read `guestHiddenSpaces`: guests and read-only guests. Document guests are not covered yet. */
export function isGuestHiddenSpacesRole (role: AccountRole | undefined): boolean {
  return role === AccountRole.Guest || role === AccountRole.ReadOnlyGuest
}

// Spelled out: core does not depend on the chunter plugin.
const CHANNEL = 'chunter:class:Channel' as Ref<Class<Space>>

/**
 * Whether user groups can be bound to spaces of the class: typed spaces and channels.
 * The single rule for the server checks and the UI.
 */
export function supportsUserGroups (hierarchy: Hierarchy, _class: Ref<Class<Doc>>): boolean {
  return hierarchy.isDerived(_class, core.class.TypedSpace) || hierarchy.isDerived(_class, CHANNEL)
}

/** `Space.members` of a space: `unique(directMembers ∪ members of its groups)`, direct members first. */
export function computeSpaceMembers (
  directMembers: AccountUuid[],
  groups: Array<Pick<UserGroup, 'members'>>
): AccountUuid[] {
  const result = new Set<AccountUuid>(directMembers)
  for (const group of groups) {
    for (const member of group.members ?? []) {
      result.add(member)
    }
  }
  return Array.from(result)
}
