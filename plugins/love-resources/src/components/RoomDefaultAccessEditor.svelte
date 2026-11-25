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
  import { getCurrentEmployee } from '@hcengineering/contact'
  import { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import {
    canManageRoomDefaultAccess,
    getAvailableDefaultRoomAccess,
    getDefaultRoomAccess,
    getRoomOwners,
    isApprovalAccess,
    isOffice,
    type Room,
    RoomAccess,
    roomAccessLabel
  } from '@hcengineering/love'
  import {
    type ButtonKind,
    type ButtonSize,
    DropdownLabelsIntl,
    type DropdownIntlItem,
    showPopup
  } from '@hcengineering/ui'
  import { updateRoomDefaultAccess } from '../roomAccess'
  import RoomOwnersPopup from './RoomOwnersPopup.svelte'

  export let object: Room | undefined = undefined
  export let readonly: boolean = false
  export let kind: ButtonKind = 'link'
  export let size: ButtonSize = 'large'
  export let width: string | undefined = undefined
  export let justify: 'left' | 'center' = 'left'

  const me = getCurrentEmployee()
  const isMaintainer = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  $: canEdit = object !== undefined && !readonly && canManageRoomDefaultAccess(object, me, isMaintainer)
  $: selected = object !== undefined ? getDefaultRoomAccess(object) : undefined
  $: items =
    object !== undefined
      ? getAvailableDefaultRoomAccess(object).map((access): DropdownIntlItem<RoomAccess> => ({
          id: access,
          label: roomAccessLabel[access]
        }))
      : []

  // Remounts the dropdown, which keeps the picked value internally, when the choice is cancelled
  let resetKey = 0

  function changeAccess (access: RoomAccess): void {
    if (object === undefined || access === selected) return
    if (isApprovalAccess(access) && getRoomOwners(object).length === 0) {
      // A public room becomes private: choose its owners first, nothing changes on cancel
      showPopup(RoomOwnersPopup, { room: object, access }, 'top', (result) => {
        if (result !== true) resetKey++
      })
      return
    }
    void updateRoomDefaultAccess(object, access)
  }
</script>

{#if object !== undefined && !isOffice(object)}
  {#key resetKey}
    <DropdownLabelsIntl
      {items}
      {selected}
      disabled={!canEdit}
      {kind}
      {size}
      {width}
      {justify}
      on:selected={(e) => {
        changeAccess(e.detail)
      }}
    />
  {/key}
{/if}
