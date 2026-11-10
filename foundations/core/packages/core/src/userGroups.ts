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

import type { AccountUuid, Class, Doc, Ref, Space, UserGroup } from './classes'
import core from './component'
import type { Hierarchy } from './hierarchy'

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
