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
-->
<!--
  Class-level configuration of change-control card relations for product versions.

  Each row is a platform Association `ProductVersion → <card MasterTag>` marked with the
  `card.mixin.CardRelation` extension (purpose = 'changeControl', optional eligibility filter).
  Configuration is class-level: it applies to every product's versions, not just the product
  whose panel this is shown on. The actual card links live as `Relation` docs, attached on the
  version panel via the generic relations editor.
-->
<script lang="ts">
  import card, { type MasterTag } from '@hcengineering/card'
  import core, { type Association, type Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { Button, IconAdd, IconClose, Label, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import { type Filter } from '@hcengineering/view'
  import { TypeSelector } from '@hcengineering/card-resources'
  import FilterTypePopup from '@hcengineering/view-resources/src/components/filter/FilterTypePopup.svelte'
  import { type Product } from '@hcengineering/products'

  import products from '../../plugin'

  export let object: Product | undefined = undefined
  export let readonly: boolean = false

  const PURPOSE = 'changeControl'

  const client = getClient()
  const hierarchy = client.getHierarchy()

  // Bumped after every mutation to recompute the (synchronously-read) model associations.
  let revision = 0

  $: rows = collectRows(revision)

  function collectRows (_rev: number): Association[] {
    return client
      .getModel()
      .findAllSync(core.class.Association, { classA: products.class.ProductVersion })
      .filter(
        (a) =>
          hierarchy.hasMixin(a, card.mixin.CardRelation) && hierarchy.as(a, card.mixin.CardRelation).purpose === PURPOSE
      )
  }

  function typeLabel (a: Association) {
    try {
      return hierarchy.getClass(a.classB).label
    } catch {
      return products.string.CardType
    }
  }

  function parseFilters (a: Association): Filter[] {
    const filter = hierarchy.as(a, card.mixin.CardRelation).filter
    if (filter == null || filter === '') return []
    try {
      return JSON.parse(filter) as Filter[]
    } catch {
      return []
    }
  }

  function serializeFilters (filters: Filter[]): string | undefined {
    if (filters.length === 0) return undefined
    return JSON.stringify(filters, (k, v) => (k === 'onRemove' ? undefined : v))
  }

  async function addType (type: Ref<MasterTag> | null): Promise<void> {
    if (type == null) return
    const _id = await client.createDoc(core.class.Association, core.space.Model, {
      classA: products.class.ProductVersion,
      classB: type,
      type: '1:N',
      nameA: 'Product version',
      nameB: 'Change control'
    })
    await client.createMixin(_id, core.class.Association, core.space.Model, card.mixin.CardRelation, {
      purpose: PURPOSE,
      requireLatest: true
    })
    newType = null
    revision++
  }

  async function removeRow (a: Association): Promise<void> {
    await client.removeDoc(core.class.Association, core.space.Model, a._id)
    revision++
  }

  async function setFilters (a: Association, filters: Filter[]): Promise<void> {
    await client.updateMixin(a._id, core.class.Association, core.space.Model, card.mixin.CardRelation, {
      filter: serializeFilters(filters)
    })
    revision++
  }

  function addFilter (a: Association, e: MouseEvent): void {
    const target = eventToHTMLElement(e)
    const existing = parseFilters(a)
    showPopup(
      FilterTypePopup,
      {
        _class: a.classB,
        target,
        index: existing.length + 1,
        onChange: (f: Filter) => {
          void setFilters(a, [...existing, f])
        }
      },
      target
    )
  }

  function removeFilter (a: Association, fi: number): void {
    void setFilters(
      a,
      parseFilters(a).filter((_, idx) => idx !== fi)
    )
  }

  let newType: Ref<MasterTag> | null = null
</script>

<div class="flex-col flex-gap-2">
  {#if rows.length === 0}
    <span class="content-dark-color text-sm">
      <Label label={products.string.NoChangeControlCardTypes} />
    </span>
  {/if}

  {#each rows as a (a._id)}
    <div class="flex-row-center flex-gap-2 flex-wrap">
      <span class="fs-title">
        <Label label={typeLabel(a)} />
      </span>

      {#each parseFilters(a) as f, fi (fi)}
        <div class="flex-row-center flex-gap-1 filter-chip">
          <Label label={f.key?.label ?? products.string.CardFilter} />
          {#if !readonly}
            <Button
              icon={IconClose}
              kind={'ghost'}
              size={'small'}
              on:click={() => {
                removeFilter(a, fi)
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
          on:click={(e) => {
            addFilter(a, e)
          }}
        />
        <Button
          icon={IconClose}
          kind={'ghost'}
          size={'small'}
          on:click={() => {
            void removeRow(a)
          }}
        />
      {/if}
    </div>
  {/each}

  {#if !readonly}
    {#key rows.length}
      <div class="flex-row-center flex-gap-2">
        <TypeSelector
          bind:value={newType}
          kind={'regular'}
          size={'small'}
          on:change={(e) => {
            void addType(e.detail)
          }}
        />
        <span class="content-dark-color text-sm">
          <Label label={products.string.AddCardType} />
        </span>
      </div>
    {/key}
  {/if}
</div>

<style lang="scss">
  .filter-chip {
    padding: 0 0.25rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
  }
</style>
