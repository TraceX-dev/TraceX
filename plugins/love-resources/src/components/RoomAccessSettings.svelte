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
  import core, { AccountRole, type DocumentUpdate, getCurrentAccount, hasAccountRole, type Ref } from '@hcengineering/core'
  import {
    type Room,
    RoomAccess,
    canManageRoomDefaultAccess,
    canManageRoomOwners,
    getAvailableRoomAccess,
    getDefaultRoomAccess,
    getRoomOwners,
    isApprovalAccess,
    roomAccessLabel
  } from '@hcengineering/love'
  import { getClient } from '@hcengineering/presentation'
  import { DropdownLabelsIntl, type DropdownIntlItem, Label } from '@hcengineering/ui'
  import love from '../plugin'
  import { infos } from '../stores'

  export let room: Room

  const client = getClient()
  const me = getCurrentEmployee()
  const isMaintainer = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  $: canEditOwners = canManageRoomOwners(room, me, isMaintainer)
  $: canEditDefaultAccess = canManageRoomDefaultAccess(room, me, isMaintainer)
  $: owners = getRoomOwners(room) as Array<Ref<Employee>>
  $: defaultAccess = getDefaultRoomAccess(room)
  // Agents have no session and do not keep a room occupied on the server either
  $: isEmpty = !$infos.some((it) => it.room === room._id && it.kind !== 'agent')
  $: accessItems = getAvailableRoomAccess(room).map(
    (access): DropdownIntlItem<RoomAccess> => ({ id: access, label: roomAccessLabel[access] })
  )

  async function changeOwners (value: Array<Ref<Employee>>): Promise<void> {
    const update: DocumentUpdate<Room> = { owners: value }
    if (value.length === 0) {
      // A room without owners is public, approval access is not available for it
      if (isApprovalAccess(room.defaultAccess)) update.defaultAccess = RoomAccess.Open
      if (isApprovalAccess(room.access)) update.access = RoomAccess.Open
    }
    await client.diffUpdate(room, update)
  }

  async function changeDefaultAccess (access: RoomAccess): Promise<void> {
    const update: DocumentUpdate<Room> = { defaultAccess: access }
    // The default access applies right away while nobody is in the room
    if (isEmpty) update.access = access
    await client.diffUpdate(room, update)
  }
</script>

<div class="antiGrid">
  <div class="antiGrid-row">
    <div class="antiGrid-row__header withDesciption">
      <Label label={core.string.Owners} />
      <span><Label label={love.string.RoomOwnersDescription} /></span>
    </div>
    <EmployeeArrayEditor
      label={core.string.Owners}
      value={owners}
      onChange={changeOwners}
      readonly={!canEditOwners}
      kind={'regular'}
      size={'large'}
    />
  </div>
  <div class="antiGrid-row">
    <div class="antiGrid-row__header withDesciption">
      <Label label={love.string.DefaultAccess} />
      <span><Label label={love.string.DefaultAccessDescription} /></span>
    </div>
    <DropdownLabelsIntl
      items={accessItems}
      selected={defaultAccess}
      disabled={!canEditDefaultAccess}
      kind={'regular'}
      size={'large'}
      on:selected={(e) => {
        void changeDefaultAccess(e.detail)
      }}
    />
  </div>
</div>
