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
  import card, { type Card } from '@hcengineering/card'
  import { type DocumentQuery, type Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { type ButtonKind, type ButtonSize, Button, IconClose, Label } from '@hcengineering/ui'
  import { ObjectBox } from '@hcengineering/view-resources'
  import { type ChangeControlCardType, type Product, type ProductVersion } from '@hcengineering/products'
  import { createEventDispatcher } from 'svelte'

  import products from '../../plugin'
  import { buildCardChangeControlQuery } from '../../utils'

  export let value: Ref<Card>[] | undefined = undefined
  export let object: ProductVersion | undefined = undefined
  export let space: Ref<Product> | undefined = undefined
  export let readonly: boolean = false
  export let kind: ButtonKind = 'regular'
  export let size: ButtonSize = 'small'

  const dispatch = createEventDispatcher()
  const productQuery = createQuery()

  $: productSpace = space ?? object?.space

  let configs: ChangeControlCardType[] | undefined
  $: if (productSpace !== undefined) {
    productQuery.query(products.class.Product, { _id: productSpace }, (res) => {
      configs = res[0]?.changeControlCardTypes
    })
  } else {
    productQuery.unsubscribe()
    configs = undefined
  }

  let docQuery: DocumentQuery<Card> | undefined
  $: void buildCardChangeControlQuery(configs).then((q) => {
    docQuery = q
  })

  $: selected = value ?? []

  let addValue: Ref<Card> | undefined = undefined
  $: if (addValue !== undefined) {
    addCard(addValue)
    addValue = undefined
  }

  function addCard (v: Ref<Card>): void {
    if (selected.includes(v)) return
    value = [...selected, v]
    dispatch('change', value)
  }

  function removeCard (v: Ref<Card>): void {
    value = selected.filter((p) => p !== v)
    dispatch('change', value)
  }
</script>

<div class="flex-row-center flex-gap-2 flex-wrap">
  {#each selected as c (c)}
    <div class="flex-row-center flex-gap-1">
      <ObjectBox
        value={c}
        _class={card.class.Card}
        readonly
        {kind}
        {size}
        showNavigate={false}
      />
      {#if !readonly}
        <Button icon={IconClose} kind={'ghost'} size={'small'} on:click={() => { removeCard(c) }} />
      {/if}
    </div>
  {/each}

  {#if !readonly}
    {#if docQuery !== undefined}
      <ObjectBox
        bind:value={addValue}
        _class={card.class.Card}
        {docQuery}
        excluded={selected}
        searchField={'title'}
        label={products.string.AddCard}
        {kind}
        {size}
        showNavigate={false}
      />
    {:else if selected.length === 0}
      <span class="content-dark-color text-sm">
        <Label label={products.string.NoChangeControlCardTypes} />
      </span>
    {/if}
  {:else if selected.length === 0}
    <span class="content-dark-color text-sm">
      <Label label={products.string.NoChangeControlCards} />
    </span>
  {/if}
</div>
