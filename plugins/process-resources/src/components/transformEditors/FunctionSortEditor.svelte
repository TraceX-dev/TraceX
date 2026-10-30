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
  import {
    type AnyAttribute,
    type Class,
    type Doc,
    type Ref,
    SortingOrder,
    type SortingQuery
  } from '@hcengineering/core'
  import presentation, { getClient } from '@hcengineering/presentation'
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
      (attr) => attr.name !== '_class' && attr.hidden !== true
    )
  }

  const orders: DropdownIntlItem[] = [
    { id: SortingOrder.Ascending, label: process.string.Ascending },
    { id: SortingOrder.Descending, label: process.string.Descending }
  ]

  $: attributes = getAttributes()
  $: items = attributes.map((attr) => ({ id: attr.name, label: attr.label }))
  $: fields = sort == null ? [] : Object.keys(sort)
  $: availableItems = items.filter((item) => !fields.includes(item.id))

  function update (previous: string | undefined, field: string | number): void {
    if (typeof field !== 'string') return
    if (previous === undefined) {
      sort = { ...sort, [field]: SortingOrder.Ascending }
    } else {
      sort = Object.fromEntries(
        Object.entries(sort ?? {}).map(([key, order]) => [key === previous ? field : key, order])
      )
    }
    dispatch('change', sort)
  }

  function updateOrder (field: string, value: string | number): void {
    if (typeof value !== 'number') return
    const order = value === SortingOrder.Descending ? SortingOrder.Descending : SortingOrder.Ascending
    sort = { ...sort, [field]: order }
    dispatch('change', sort)
  }

  function remove (field: string): void {
    const entries = Object.entries(sort ?? {}).filter(([key]) => key !== field)
    sort = entries.length === 0 ? undefined : Object.fromEntries(entries)
    dispatch('change', sort)
  }
</script>

<div class="flex-col flex-gap-2">
  {#each fields as field}
    {@const value = sort?.[field]}
    <div class="flex-row-center flex-gap-2">
      <DropdownLabelsIntl
        label={view.string.Ordering}
        items={items.filter((item) => item.id === field || !fields.includes(item.id))}
        selected={field}
        shouldUpdateUndefined={false}
        width={'100%'}
        justify={'left'}
        on:selected={(event) => update(field, event.detail)}
      />
      <DropdownLabelsIntl
        items={orders}
        selected={typeof value === 'number' ? value : SortingOrder.Ascending}
        on:selected={(event) => updateOrder(field, event.detail)}
      />
      <Button
        icon={IconClose}
        kind={'ghost'}
        showTooltip={{ label: presentation.string.Remove }}
        on:click={() => remove(field)}
      />
    </div>
  {/each}
  {#if availableItems.length > 0}
    <DropdownLabelsIntl
      label={fields.length === 0 ? view.string.Ordering : presentation.string.Add}
      items={availableItems}
      shouldUpdateUndefined={false}
      width={'100%'}
      justify={'left'}
      on:selected={(event) => update(undefined, event.detail)}
    />
  {/if}
</div>
