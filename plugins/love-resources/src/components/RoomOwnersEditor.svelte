<!--
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
-->
<script lang="ts">
  import { type Employee, getCurrentEmployee } from '@hcengineering/contact'
  import { EmployeeArrayEditor } from '@hcengineering/contact-resources'
  import core, { AccountRole, getCurrentAccount, hasAccountRole, type Ref } from '@hcengineering/core'
  import { canManageRoomOwners, getRoomOwners, isApprovalAccess, isOffice, type Room } from '@hcengineering/love'
  import type { IntlString } from '@hcengineering/platform'
  import { MessageBox } from '@hcengineering/presentation'
  import { type ButtonKind, type ButtonSize, showPopup } from '@hcengineering/ui'
  import love from '../plugin'
  import { updateRoomOwners } from '../roomAccess'

  export let object: Room | undefined = undefined
  export let label: IntlString = core.string.Owners
  export let readonly: boolean = false
  export let kind: ButtonKind = 'link'
  export let size: ButtonSize = 'large'
  export let width: string | undefined = '100%'
  export let justify: 'left' | 'center' = 'left'

  const me = getCurrentEmployee()
  const isMaintainer = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  $: canEdit = object !== undefined && !readonly && canManageRoomOwners(object, me, isMaintainer)
  $: owners = object !== undefined ? (getRoomOwners(object) as Array<Ref<Employee>>) : []

  // Removing the last owner opens a closed room, or takes away control a non-maintainer cannot get back.
  // A maintainer removing the last owner of an open room changes nothing that cannot be undone.
  function needsConfirmation (room: Room): boolean {
    return isApprovalAccess(room.access) || isApprovalAccess(room.defaultAccess) || !isMaintainer
  }

  // Remounts the picker, which keeps the edited list internally, when removing the last owner is cancelled
  let resetKey = 0

  function changeOwners (value: Array<Ref<Employee>>): void {
    const room = object
    if (room === undefined) return
    if (value.length === 0 && getRoomOwners(room).length > 0 && needsConfirmation(room)) {
      showPopup(
        MessageBox,
        {
          label: love.string.RemoveLastRoomOwner,
          message: love.string.RemoveLastRoomOwnerMessage,
          action: async () => {
            await updateRoomOwners(room, value)
          }
        },
        'top',
        (result) => {
          if (result !== true) resetKey++
        }
      )
      return
    }
    void updateRoomOwners(room, value)
  }
</script>

{#if object !== undefined && !isOffice(object)}
  {#key resetKey}
    <EmployeeArrayEditor
      {label}
      value={owners}
      onChange={changeOwners}
      readonly={!canEdit}
      {kind}
      {size}
      {width}
      {justify}
    />
  {/key}
{/if}
