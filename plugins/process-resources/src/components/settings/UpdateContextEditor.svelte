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
  import core from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { getAttributePresenterClass, getClient } from '@hcengineering/presentation'
  import type { ContextId, Process, Step } from '@hcengineering/process'
  import type { Doc } from '@hcengineering/core'
  import { DropdownLabelsIntl, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import plugin from '../../plugin'
  import { getContext, getMockAttribute } from '../../utils'
  import ProcessAttribute from '../ProcessAttribute.svelte'

  export let process: Process
  export let step: Step<Doc>

  const dispatch = createEventDispatcher()
  const client = getClient()

  $: contextId = step.params.contextId as ContextId | undefined
  $: items = Object.entries(process.context)
    .filter(([, context]) => context.isResult === true && context.type !== undefined)
    .map(([id, context]) => ({ id, label: getEmbeddedLabel(context.name || String(context.index)) }))
  $: selectedContext = contextId !== undefined ? process.context[contextId] : undefined
  $: attribute =
    selectedContext?.type !== undefined
      ? getMockAttribute(process.masterTag, plugin.string.Value, selectedContext.type)
      : undefined
  $: presenterClass =
    attribute !== undefined ? getAttributePresenterClass(client.getHierarchy(), attribute.type) : undefined
  $: context =
    presenterClass !== undefined
      ? getContext(client, process, presenterClass.attrClass, presenterClass.category, undefined, true)
      : undefined

  function selectContext (event: CustomEvent<ContextId>): void {
    if (event.detail === contextId) return
    step.params = { contextId: event.detail }
    dispatch('change', step)
  }

  function updateValue (event: CustomEvent<unknown>): void {
    step.params = { ...step.params, value: event.detail }
    dispatch('change', step)
  }
</script>

<div class="grid">
  <Label label={plugin.string.Data} />
  <DropdownLabelsIntl {items} selected={contextId} width={'100%'} on:selected={selectContext} />
  {#if attribute !== undefined && presenterClass !== undefined && context !== undefined}
    {#key contextId}
      <ProcessAttribute
        {process}
        masterTag={process.masterTag}
        {context}
        {attribute}
        {presenterClass}
        editor={undefined}
        value={step.params.value}
        allowArray={attribute.type._class === core.class.ArrOf}
        on:change={updateValue}
      />
    {/key}
  {/if}
</div>

<style lang="scss">
  .grid {
    display: grid;
    grid-template-columns: 1fr 1.5fr;
    align-items: center;
    gap: 0.5rem 1rem;
    margin: 0.25rem 2rem 0;
    width: calc(100% - 4rem);
  }
</style>
