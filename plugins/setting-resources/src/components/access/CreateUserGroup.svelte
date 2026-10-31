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
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import core, { type AccountUuid } from '@hcengineering/core'
  import presentation, { getClient } from '@hcengineering/presentation'
  import { Button, EditBox, Icon, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import setting from '../../plugin'

  export let handleError: (error: unknown) => void

  const client = getClient()
  const dispatch = createEventDispatcher<{ close: void }>()
  let name = ''
  let members: AccountUuid[] = []
  let creating = false

  $: canCreate = name.trim() !== '' && !creating

  async function createGroup (): Promise<void> {
    const trimmedName = name.trim()
    if (trimmedName === '' || creating) return
    creating = true
    try {
      await client.createDoc(core.class.UserGroup, core.space.Workspace, { name: trimmedName, members })
      dispatch('close')
    } catch (error) {
      handleError(error)
    } finally {
      creating = false
    }
  }
</script>

<!-- Same layout as the Invite people dialog (login-resources InviteLink). -->
<div class="antiPopup popup" data-id="create-user-group">
  <div class="flex-between fs-title mb-2">
    <Label label={setting.string.CreateUserGroupTitle} />
    <Icon icon={setting.icon.Members} size={'large'} />
  </div>
  <span class="text-md content-dark-color mb-6"><Label label={setting.string.CreateUserGroupDescription} /></span>

  <div class="flex-col flex-gap-4">
    <div class="flex-between flex-gap-4">
      <span class="font-medium caption-color"><Label label={core.string.Name} /></span>
      <div class="control">
        <EditBox
          bind:value={name}
          placeholder={setting.string.NewUserGroup}
          kind={'default'}
          disabled={creating}
          autoFocus
          fullSize
          on:keydown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              createGroup().catch(handleError)
            }
          }}
        />
      </div>
    </div>
    <div class="flex-between flex-gap-4">
      <span class="font-medium caption-color"><Label label={core.string.Members} /></span>
      <div class="control">
        <AccountArrayEditor
          value={members}
          label={core.string.Members}
          allowGuests
          readonly={creating}
          kind={'regular'}
          size={'large'}
          width={'100%'}
          onChange={(refs) => {
            members = refs
          }}
        />
      </div>
    </div>
  </div>

  <div class="flex-row-center flex-gap-2 justify-end mt-9">
    <Button label={presentation.string.Cancel} size={'medium'} on:click={() => dispatch('close')} />
    <Button
      label={presentation.string.Create}
      size={'medium'}
      kind={'primary'}
      disabled={!canCreate}
      loading={creating}
      on:click={() => {
        createGroup().catch(handleError)
      }}
    />
  </div>
</div>

<style lang="scss">
  .popup {
    display: flex;
    flex-direction: column;
    padding: 1.75rem;
    width: 30rem;
    max-width: 40rem;
    background: var(--popup-bg-color);
    border-radius: 1.25rem;
    box-shadow: var(--popup-shadow);
  }

  .control {
    width: 14rem;
    flex-shrink: 0;
  }
</style>
