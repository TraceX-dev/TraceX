<!--
//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import presentation from '@hcengineering/presentation'
  import { EditBox, Label, Modal } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import settings from '../plugin'

  const dispatch = createEventDispatcher()
  let title = ''

  function create(): void {
    dispatch('close', title.trim())
  }
</script>

<Modal
  label={settings.string.GenerateApiToken}
  type={'type-popup'}
  okLabel={presentation.string.Create}
  okAction={create}
  on:close
  onCancel={() => dispatch('close', undefined)}
  canSave={title.trim().length > 0 && title.trim().length <= 128}
>
  <div class="antiGrid">
    <div class="antiGrid-row">
      <div class="antiGrid-row__header withDesciption">
        <Label label={settings.string.ApiKeyTitle} />
      </div>
      <div class="padding">
        <EditBox bind:value={title} placeholder={settings.string.ApiKeyTitle} autoFocus />
      </div>
    </div>
  </div>
</Modal>
