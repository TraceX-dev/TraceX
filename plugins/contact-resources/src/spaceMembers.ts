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

import type { AccountUuid, Space } from '@hcengineering/core'

function sameAccounts (left: AccountUuid[], right: AccountUuid[]): boolean {
  const set = new Set(left)
  return set.size === new Set(right).size && right.every((it) => set.has(it))
}

/**
 * The members part of a space update made by a settings dialog with `SpaceSettingsForm`.
 *
 * When the form edits direct members (`directMembers` bound, a space with user groups), only `directMembers` is
 * written: the server computes `members` from them and the groups. A full `members` list can not tell an account
 * that becomes a direct member from one that is already a member through a group.
 * Otherwise `members` is written as before. Empty when nothing changed.
 */
export function getSpaceMembersUpdate (
  space: Space,
  members: AccountUuid[],
  directMembers: AccountUuid[] | undefined
): { members?: AccountUuid[], directMembers?: AccountUuid[] } {
  if (directMembers !== undefined) {
    return sameAccounts(space.directMembers ?? space.members, directMembers) ? {} : { directMembers }
  }
  return sameAccounts(space.members, members) ? {} : { members }
}
