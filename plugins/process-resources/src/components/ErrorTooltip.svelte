<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { Analytics } from '@hcengineering/analytics'
  import { translate } from '@hcengineering/platform'
  import { ExecutionError } from '@hcengineering/process'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import plugin from '../plugin'

  export let value: ExecutionError[]
  const model = getClient().getModel()

  async function fillProps (value: ExecutionError[]): Promise<ExecutionError[]> {
    for (const val of value) {
      for (const key in val.intlProps) {
        try {
          val.props[key] = await translate(val.intlProps[key], {})
        } catch (err: any) {
          Analytics.handleError(err)
        }
      }
    }
    return value
  }
</script>

<div class="p-2 flex-col-center flex-gap-2">
  {#await fillProps(value) then res}
    {#each res as error, index (index)}
      <div class="flex-col flex-gap-2">
        {#if error.method !== undefined}
          {@const method = model.findObject(error.method)}
          {@const transition = error.transition === undefined ? undefined : model.findObject(error.transition)}
          {@const index = transition?.actions.findIndex((action) => action._id === error.step) ?? -1}
          <div>
            <Label label={plugin.string.DiagnosticStep} />:
            {#if index >= 0}{index + 1}.{/if}
            {#if method}<Label label={method.label} />{/if}
          </div>
        {/if}
        {#if error.parameter !== undefined}
          <div><Label label={plugin.string.DiagnosticParameter} />: {error.parameter}</div>
        {/if}
        <div><Label label={error.error} params={error.props} /></div>
      </div>
    {/each}
  {/await}
</div>
