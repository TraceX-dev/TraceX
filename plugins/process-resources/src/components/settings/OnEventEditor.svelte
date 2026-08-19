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
  import { Process } from '@hcengineering/process'
  import { EditBox, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import plugin from '../../plugin'

  export let readonly: boolean
  export let process: Process
  export let params: Record<string, any>

  const dispatch = createEventDispatcher()
  let eventType = typeof params.eventType === 'string' ? params.eventType : ''

  function change(): void {
    if (readonly) return
    params = { ...params, eventType }
    dispatch('change', { params })
  }
</script>

<div class="editor-grid">
  <Label label={plugin.string.OnEvent} />
  <EditBox disabled={readonly} bind:value={eventType} on:change={change} />
</div>
