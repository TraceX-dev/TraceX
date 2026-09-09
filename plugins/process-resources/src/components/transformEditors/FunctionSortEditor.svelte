<!--
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
  import {
    type AnyAttribute,
    type Class,
    type Doc,
    type Ref,
    SortingOrder,
    type SortingQuery
  } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import process from '../../plugin'
  import { Button, type DropdownIntlItem, DropdownLabelsIntl, IconClose } from '@hcengineering/ui'
  import view from '@hcengineering/view-resources/src/plugin'
  import { createEventDispatcher } from 'svelte'

  export let _class: Ref<Class<Doc>>
  export let sort: SortingQuery<Doc> | undefined

  const dispatch = createEventDispatcher()
  const hierarchy = getClient().getHierarchy()

  function getAttributes (): AnyAttribute[] {
    return Array.from(hierarchy.getAllAttributes(_class).values()).filter(
      (attr) => attr.name !== '_id' && attr.name !== '_class' && attr.hidden !== true
    )
  }

  const orders: DropdownIntlItem[] = [
    { id: SortingOrder.Ascending, label: process.string.Ascending },
    { id: SortingOrder.Descending, label: process.string.Descending }
  ]

  $: attributes = getAttributes()
  $: items = attributes.map((attr) => ({ id: attr.name, label: attr.label }))
  $: selected = sort == null ? undefined : Object.keys(sort)[0]
  $: sortOrder = selected == null ? undefined : sort?.[selected]
  $: order = typeof sortOrder === 'number' ? sortOrder : SortingOrder.Ascending

  function update (field: string | number): void {
    if (typeof field !== 'string') return
    sort = { [field]: order }
    dispatch('change', sort)
  }

  function updateOrder (value: string | number): void {
    if (selected == null || typeof value !== 'number') return
    const selectedOrder = value === SortingOrder.Descending ? SortingOrder.Descending : SortingOrder.Ascending
    sort = { [selected]: selectedOrder }
    dispatch('change', sort)
  }

  function clear (): void {
    sort = undefined
    dispatch('change', sort)
  }
</script>

{#if items.length > 0}
  <div class="flex-row-center flex-gap-2">
    <DropdownLabelsIntl
      label={view.string.Ordering}
      {items}
      {selected}
      shouldUpdateUndefined={false}
      width={'100%'}
      justify={'left'}
      on:selected={(event) => {
        update(event.detail)
      }}
    />
    {#if selected != null}
      <DropdownLabelsIntl
        items={orders}
        selected={order}
        on:selected={(event) => {
          updateOrder(event.detail)
        }}
      />
      <Button icon={IconClose} kind={'ghost'} on:click={clear} />
    {/if}
  </div>
{/if}
