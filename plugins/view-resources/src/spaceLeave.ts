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

import core, { getCurrentAccount, type Space } from '@hcengineering/core'
import { getClient, MessageBox } from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'
import view from '@hcengineering/view'
import plugin from './plugin'

/**
 * Leaving a space removes only the direct membership: groups bound to the space keep giving access.
 * Returns whether to go on with the leave.
 * - Member through groups only: leaving changes nothing, the user is told which groups give the access.
 * - Direct member also given access by groups: the user confirms, knowing the access stays.
 * - Otherwise (no groups, or a guest who can not read groups): leave as before.
 */
export async function confirmLeaveSpace (space: Space): Promise<boolean> {
  const groups = space.groups ?? []
  if (groups.length === 0) return true

  const me = getCurrentAccount().uuid
  const memberOf = await getClient().findAll(core.class.UserGroup, { _id: { $in: groups }, members: me })
  if (memberOf.length === 0) return true

  const direct = (space.directMembers ?? space.members).includes(me)
  return await new Promise<boolean>((resolve) => {
    showPopup(
      MessageBox,
      {
        label: view.string.Leave,
        message: direct ? plugin.string.LeaveSpaceGroupsRemain : plugin.string.LeaveSpaceGroupsOnly,
        params: { space: space.name, groups: memberOf.map((group) => group.name).join(', ') },
        okLabel: view.string.Leave,
        canSubmit: direct
      },
      undefined,
      (result) => {
        resolve(result === true)
      }
    )
  })
}
