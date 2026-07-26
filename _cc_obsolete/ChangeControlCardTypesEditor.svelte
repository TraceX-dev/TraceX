<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import { type MasterTag } from '@hcengineering/card'
  import { type Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { Button, IconAdd, IconClose, Label, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import { type Filter } from '@hcengineering/view'
  import { TypeSelector } from '@hcengineering/card-resources'
  import FilterTypePopup from '@hcengineering/view-resources/src/components/filter/FilterTypePopup.svelte'
  import { type ChangeControlCardType, type Product } from '@hcengineering/products'
  import { createEventDispatcher } from 'svelte'

  import products from '../../plugin'

  export let value: ChangeControlCardType[] | undefined = undefined
  export let object: Product | undefined = undefined
  export let readonly: boolean = false

  const client = getClient()
  const dispatch = createEventDispatcher()

  let items: ChangeControlCardType[] = []
  $: items = (value ?? object?.changeControlCardTypes ?? []).map((it) => ({ ...it }))

  function persist (next: ChangeControlCardType[]): void {
    items = next
    value = next
    if (object !== undefined) {
      void client.updateDoc(object._class, object.space, object._id, { changeControlCardTypes: next })
    }
    dispatch('change', next)
  }

  function addRow (): void {
    persist([...items, { type: undefined as unknown as Ref<MasterTag> }])
  }

  function removeRow (i: number): void {
    persist(items.filter((_, idx) => idx !== i))
  }

  function setType (i: number, type: Ref<MasterTag> | null): void {
    persist(items.map((it, idx) => (idx === i ? { ...it, type: (type ?? undefined) as unknown as Ref<MasterTag> } : it)))
  }

  function parseFilters (row: ChangeControlCardType): Filter[] {
    if (row.filter == null || row.filter === '') return []
    try {
      return JSON.parse(row.filter) as Filter[]
    } catch {
      return []
    }
  }

  function serializeFilters (filters: Filter[]): string | undefined {
    if (filters.length === 0) return undefined
    return JSON.stringify(filters, (k, v) => (k === 'onRemove' ? undefined : v))
  }

  function setFilters (i: number, filters: Filter[]): void {
    persist(items.map((it, idx) => (idx === i ? { ...it, filter: serializeFilters(filters) } : it)))
  }

  function addFilter (i: number, e: MouseEvent): void {
    const row = items[i]
    if (row?.type === undefined) return
    const target = eventToHTMLElement(e)
    const existing = parseFilters(row)
    showPopup(
      FilterTypePopup,
      {
        _class: row.type,
        target,
        index: existing.length + 1,
        onChange: (f: Filter) => {
          setFilters(i, [...existing, f])
        }
      },
      target
    )
  }

  function removeFilter (i: number, fi: number): void {
    setFilters(
      i,
      parseFilters(items[i]).filter((_, idx) => idx !== fi)
    )
  }
</script>

<div class="flex-col flex-gap-2">
  {#if items.length === 0}
    <span class="content-dark-color text-sm">
      <Label label={products.string.NoChangeControlCardTypes} />
    </span>
  {/if}

  {#each items as row, i (i)}
    <div class="flex-row-center flex-gap-2 flex-wrap">
      <TypeSelector
        value={row.type ?? null}
        kind={'regular'}
        size={'small'}
        on:change={(e) => {
          setType(i, e.detail)
        }}
      />

      {#each parseFilters(row) as f, fi (fi)}
        <div class="flex-row-center flex-gap-1 filter-chip">
          <Label label={f.key?.label ?? products.string.CardFilter} />
          {#if !readonly}
            <Button
              icon={IconClose}
              kind={'ghost'}
              size={'small'}
              on:click={() => {
                removeFilter(i, fi)
              }}
            />
          {/if}
        </div>
      {/each}

      {#if !readonly}
        <Button
          icon={IconAdd}
          label={products.string.AddFilter}
          kind={'ghost'}
          size={'small'}
          disabled={row.type === undefined}
          on:click={(e) => {
            addFilter(i, e)
          }}
        />
        <Button
          icon={IconClose}
          kind={'ghost'}
          size={'small'}
          on:click={() => {
            removeRow(i)
          }}
        />
      {/if}
    </div>
  {/each}

  {#if !readonly}
    <div>
      <Button icon={IconAdd} label={products.string.AddCardType} kind={'ghost'} size={'small'} on:click={addRow} />
    </div>
  {/if}
</div>

<style lang="scss">
  .filter-chip {
    padding: 0 0.25rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
  }
</style>
