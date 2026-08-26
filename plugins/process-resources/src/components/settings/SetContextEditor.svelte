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
  import core, { type AnyAttribute, type Doc, generateId, type PropertyType, type Type } from '@hcengineering/core'
  import { getAttributePresenterClass, getClient } from '@hcengineering/presentation'
  import { type Process, type Step, type UserResult } from '@hcengineering/process'
  import { EditBox, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import plugin from '../../plugin'
  import { generateContextId, getContext } from '../../utils'
  import ProcessAttribute from '../ProcessAttribute.svelte'
  import ResultTypeEditor from './ResultTypeEditor.svelte'

  export let process: Process
  export let step: Step<Doc>

  const dispatch = createEventDispatcher()
  const client = getClient()
  const hierarchy = client.getHierarchy()
  const attributeId = generateId<AnyAttribute>()

  let result: UserResult | undefined = step.results?.[0]
  let name = result?.name ?? ''
  let type: Type<PropertyType> | null | undefined = result?.type
  let value = step.params.value
  let attribute: AnyAttribute | undefined

  function updateResult (): void {
    if (type == null) {
      step.results = []
      result = undefined
    } else {
      result = {
        _id: result?._id ?? generateContextId(),
        name: name.trim() !== '' ? name : 'Context',
        type
      }
      step.results = [result]
    }
    dispatch('change', step)
  }

  function updateValue (event: CustomEvent<unknown>): void {
    value = event.detail
    step.params = { ...step.params, value }
    dispatch('change', step)
  }

  $: attribute =
    type == null
      ? undefined
      : {
          attributeOf: process.masterTag,
          name: 'value',
          type,
          _id: attributeId,
          space: core.space.Model,
          modifiedOn: 0,
          modifiedBy: core.account.System,
          _class: core.class.Attribute,
          label: plugin.string.Value
        }

  $: presenterClass = attribute !== undefined ? getAttributePresenterClass(hierarchy, attribute.type) : undefined
  $: context =
    presenterClass !== undefined
      ? getContext(client, process, presenterClass.attrClass, presenterClass.category, undefined, true)
      : undefined
</script>

<div class="grid">
  <Label label={core.string.Description} />
  <EditBox bind:value={name} placeholder={core.string.Description} on:change={updateResult} />
  <ResultTypeEditor bind:type on:change={updateResult} />
  {#if attribute !== undefined && presenterClass !== undefined && context !== undefined}
    <ProcessAttribute
      {process}
      masterTag={process.masterTag}
      {context}
      {attribute}
      {presenterClass}
      editor={undefined}
      {value}
      on:change={updateValue}
    />
  {/if}
</div>

<style lang="scss">
  .grid {
    display: grid;
    grid-template-columns: 1fr 1.5fr;
    grid-auto-rows: minmax(2rem, max-content);
    justify-content: start;
    align-items: center;
    row-gap: 0.5rem;
    column-gap: 1rem;
    margin: 0.25rem 2rem 0;
    width: calc(100% - 4rem);
    height: min-content;
  }
</style>
