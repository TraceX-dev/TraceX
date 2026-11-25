<script lang="ts">
  import { canManageRoomAccess, Room, RoomAccess, roomAccessIcon } from '@hcengineering/love'
  import { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import love from '../../../plugin'
  import { ButtonBaseSize, eventToHTMLElement, ModernButton, showPopup } from '@hcengineering/ui'
  import RoomAccessPopup from '../../RoomAccessPopup.svelte'
  import { getCurrentEmployee } from '@hcengineering/contact'

  export let room: Room
  export let size: ButtonBaseSize = 'large'
  export let kind: 'primary' | 'secondary' | 'tertiary' | 'negative' = 'secondary'

  const me = getCurrentEmployee()
  const isMaintainer = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)

  $: canManage = canManageRoomAccess(room, me, isMaintainer)

  function setAccess (e: MouseEvent): void {
    if (!canManage) return
    showPopup(RoomAccessPopup, { room }, eventToHTMLElement(e))
  }
</script>

<ModernButton
  icon={roomAccessIcon[room.access]}
  iconProps={{
    fill:
      room.access === RoomAccess.Open
        ? 'var(--bg-positive-default)'
        : room.access === RoomAccess.DND
          ? 'var(--bg-negative-default)'
          : 'currentColor'
  }}
  tooltip={{ label: love.string.ChangeAccess }}
  {kind}
  {size}
  disabled={!canManage}
  on:click={setAccess}
/>
