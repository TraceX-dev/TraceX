<script lang="ts">
  import { getClient } from '@hcengineering/presentation'
  import { RadioGroup, RadioItem } from '@hcengineering/ui'
  import { Room, RoomAccess, getAvailableRoomAccess, roomAccessLabel } from '@hcengineering/love'
  import { createEventDispatcher } from 'svelte'

  export let room: Room

  const client = getClient()
  const dispatch = createEventDispatcher()

  async function setAccess (access: RoomAccess): Promise<void> {
    await client.update(room, { access })
    dispatch('close', access)
  }

  $: items = getAvailableRoomAccess(room).map(
    (access): RadioItem => ({
      value: access,
      labelIntl: roomAccessLabel[access],
      action: async () => {
        await setAccess(access)
      }
    })
  )
</script>

<div class="antiPopup p-4">
  <RadioGroup {items} gap={'large'} selected={room.access} />
</div>
