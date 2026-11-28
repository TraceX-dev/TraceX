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
  import { getCurrentEmployee, type Person } from '@hcengineering/contact'
  import { UserBoxList } from '@hcengineering/contact-resources'
  import core, { type Ref } from '@hcengineering/core'
  import { type Room, type RoomAccess } from '@hcengineering/love'
  import { Label, Modal } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import love from '../plugin'
  import { updateRoomOwnersAndDefaultAccess } from '../roomAccess'

  export let room: Room
  export let access: RoomAccess

  const dispatch = createEventDispatcher()

  let owners: Array<Ref<Person>> = [getCurrentEmployee()]
  let saving = false

  async function save (): Promise<void> {
    saving = true
    try {
      await updateRoomOwnersAndDefaultAccess(room, owners, access)
      dispatch('close', true)
    } finally {
      saving = false
    }
  }
</script>

<Modal
  label={love.string.ChooseRoomOwners}
  type="type-popup"
  width="small"
  okAction={save}
  okLoading={saving}
  canSave={owners.length > 0}
  onCancel={() => {
    dispatch('close')
  }}
  on:close
>
  <div class="flex-col flex-gap-4">
    <span class="secondary-textColor"><Label label={love.string.ChooseRoomOwnersDescription} /></span>
    <!-- Same picker as the Owners field of the room panel, without its debounce so Ok always sees the latest value -->
    <UserBoxList
      items={owners}
      label={core.string.Owners}
      kind={'regular'}
      size={'large'}
      justify={'left'}
      width={'100%'}
      on:update={(e) => {
        owners = e.detail
      }}
    />
  </div>
</Modal>
