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
  import card from '@hcengineering/card'
  import core, { Type } from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import { getAttributePresenterClass, getClient } from '@hcengineering/presentation'
  import { Process, UserResult } from '@hcengineering/process'
  import { Button, EditBox, IconClose, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { generateContextId } from '../../utils'
  import ResultTypeSelector from './ResultTypeSelector.svelte'
  import SelectionSpaceEditor from './SelectionSpaceEditor.svelte'

  export let result: UserResult | null
  export let process: Process

  let type: Type<any> | undefined | null = result?.type
  let name: string = result?.name ?? ''
  let key: string | undefined = result?.key
  let selectionSpace = result?.selectionSpace

  const dispatch = createEventDispatcher()

  const client = getClient()
  const hierarchy = client.getHierarchy()

  $: presenterClass = type != null ? getAttributePresenterClass(hierarchy, type) : undefined
  $: canLimitSelection =
    presenterClass !== undefined &&
    ['object', 'array'].includes(presenterClass.category) &&
    hierarchy.isDerived(presenterClass.attrClass, card.class.Card)

  async function update (): Promise<void> {
    if (type == null) {
      result = null
    } else {
      const target = getAttributePresenterClass(hierarchy, type)
      if (!['object', 'array'].includes(target.category) || !hierarchy.isDerived(target.attrClass, card.class.Card)) {
        selectionSpace = undefined
      }
      result = {
        _id: result?._id ?? generateContextId(),
        name,
        key,
        type,
        selectionSpace
      }
      if (key !== undefined) {
        const attr = client.getModel().findAllSync(core.class.Attribute, { name: key })[0]
        if (attr?.label !== undefined && result != null) {
          name = await translate(attr.label, {})
          result.name = name
        }
      }
    }
    dispatch('change', result)
  }

  function handleNameChange (): void {
    if (result != null) {
      result.name = name
      dispatch('change', result)
    }
  }

  function changeSelectionSpace (event: CustomEvent<string | undefined>): void {
    selectionSpace = event.detail
    if (result != null) {
      result.selectionSpace = selectionSpace
      dispatch('change', result)
    }
  }
</script>

<div class="editor-grid">
  <span class="label">
    <Label label={core.string.Description} />
  </span>
  <div class="flex-row-center flex-gap-2">
    <EditBox bind:value={name} placeholder={core.string.Description} on:change={handleNameChange} kind={'default'} />
    <Button
      icon={IconClose}
      kind="ghost"
      on:click={() => {
        dispatch('remove')
      }}
    />
  </div>
  <ResultTypeSelector {process} bind:key bind:type on:change={update} />
  {#if canLimitSelection}
    <SelectionSpaceEditor {process} value={selectionSpace} on:change={changeSelectionSpace} />
  {/if}
</div>
