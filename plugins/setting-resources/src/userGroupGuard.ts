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

import type { Space } from '@hcengineering/core'
import type { IntlString } from '@hcengineering/platform'
import { MessageBox } from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'

import setting from './plugin'
import { getSpacesLeftWithoutMembers, type UserGroupsChange } from './spaceAccessUtils'

/**
 * Whether a change of user groups or bindings can be written: it must not leave a private space without members.
 * When it would, the user is told which spaces need direct members first and nothing is written.
 */
export function canChangeUserGroups (spaces: Space[], change: UserGroupsChange, label: IntlString): boolean {
  const left = getSpacesLeftWithoutMembers(spaces, change)
  if (left.length === 0) return true
  showPopup(MessageBox, {
    label,
    message: setting.string.UserGroupChangeLeavesSpacesEmpty,
    params: { spaces: left.map((space) => space.name).join(', ') },
    // Informs only: the main button closes the box, nothing is written.
    canSubmit: false
  })
  return false
}
