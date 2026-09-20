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
  import type { MasterTag, Tag } from '@hcengineering/card'
  import core from '@hcengineering/core'
  import type { AnyAttribute, Ref } from '@hcengineering/core'
  import { getResource } from '@hcengineering/platform'
  import { Card, getClient } from '@hcengineering/presentation'
  import type { Process } from '@hcengineering/process'
  import ui, { DropdownLabelsIntl } from '@hcengineering/ui'
  import type { AnySvelteComponent, DropdownIntlItem } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'
  import processPlugin from '../../plugin'
  import { getContext } from '../../utils'
  import ProcessAttribute from '../ProcessAttribute.svelte'

  export let process: Process
  export let masterTag: Ref<MasterTag | Tag>
  export let attribute: AnyAttribute
  export let props: { offset?: number | string, offsetType?: string, direction?: string } = {}

  const client = getClient()
  $: offsetAttribute = {
    ...attribute,
    label: processPlugin.string.Offset,
    type: { _class: core.class.TypeNumber, label: core.string.Number }
  }
  $: offsetContext = getContext(client, process, core.class.TypeNumber, 'attribute', undefined, true)

  let offset = props?.offset ?? 0
  let editor: AnySvelteComponent | undefined

  async function loadEditor (): Promise<void> {
    try {
      const hierarchy = client.getHierarchy()
      const inlineEditor = hierarchy.as(hierarchy.getClass(core.class.TypeNumber), view.mixin.AttributeEditor).inlineEditor
      editor = await getResource(inlineEditor)
    } catch (error) {
      Analytics.handleError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  void loadEditor()

  let offsetType = props?.offsetType ?? 'days'
  let direction = props?.direction ?? 'after'

  const items: DropdownIntlItem[] = [
    { id: 'days', label: ui.string.DaysWOValue },
    { id: 'weeks', label: ui.string.WeeksWOValue },
    { id: 'months', label: ui.string.MonthsWOValue }
  ]

  const directions: DropdownIntlItem[] = [
    { id: 'after', label: ui.string.After },
    { id: 'before', label: ui.string.Before }
  ]

  const dispatch = createEventDispatcher()

  function save (): void {
    dispatch('close', {
      offset,
      offsetType,
      direction
    })
  }
</script>

<Card on:close width={'small'} label={processPlugin.string.Offset} canSave okAction={save}>
  <div class="flex-col flex-gap-2">
    <div class="flex-row-center flex-gap-2">
      <DropdownLabelsIntl items={directions} bind:selected={direction} />
      <DropdownLabelsIntl {items} bind:selected={offsetType} />
    </div>
    <ProcessAttribute
      {process}
      {masterTag}
      context={offsetContext}
      attribute={offsetAttribute}
      presenterClass={{ attrClass: core.class.TypeNumber, category: 'attribute' }}
      value={offset}
      {editor}
      on:change={(event) => {
        offset = event.detail
      }}
    />
  </div>
</Card>
