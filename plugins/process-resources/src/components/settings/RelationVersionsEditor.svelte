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
  import type { SelectionRelation } from '@hcengineering/process'
  import { Label, RadioButton } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import plugin from '../../plugin'

  export let value: SelectionRelation['versions'] = 'all'

  const dispatch = createEventDispatcher<{ change: SelectionRelation['versions'] }>()
  const options = [
    { value: 'effective', label: plugin.string.OnlyEffectiveVersions },
    { value: 'latest', label: plugin.string.OnlyLatestVersions },
    { value: 'all', label: plugin.string.AllVersions }
  ] as const

  function select (next: SelectionRelation['versions']): void {
    value = next
    dispatch('change', value)
  }
</script>

<Label label={plugin.string.SelectionVersions} />
<div class="flex-col flex-gap-2">
  {#each options as option}
    <RadioButton
      group={value ?? 'all'}
      value={option.value}
      labelIntl={option.label}
      action={() => select(option.value)}
    />
  {/each}
</div>
