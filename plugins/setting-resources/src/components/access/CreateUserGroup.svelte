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
  import core from '@hcengineering/core'
  import presentation, { getClient } from '@hcengineering/presentation'
  import { EditBox, Modal } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import setting from '../../plugin'

  export let handleError: (error: unknown) => void

  const client = getClient()
  const dispatch = createEventDispatcher<{ close: void }>()
  let name = ''
  let creating = false

  async function createGroup (): Promise<void> {
    const trimmedName = name.trim()
    if (trimmedName === '' || creating) return
    creating = true
    try {
      await client.createDoc(core.class.UserGroup, core.space.Workspace, { name: trimmedName, members: [] })
      dispatch('close')
    } catch (error) {
      handleError(error)
    } finally {
      creating = false
    }
  }
</script>

<Modal
  label={core.string.UserGroup}
  type={'type-popup'}
  width={'small'}
  okLabel={presentation.string.Create}
  okAction={createGroup}
  okLoading={creating}
  canSave={name.trim() !== '' && !creating}
  onCancel={() => dispatch('close')}
  on:close
>
  <EditBox
    bind:value={name}
    label={core.string.Name}
    placeholder={setting.string.NewUserGroup}
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
</Modal>
