<!--
//
// Copyright © 2024 Hardcore Engineering Inc.
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
  import { type Product } from '@hcengineering/products'
  import { AnyAttribute, type Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { Button, ButtonKind, ButtonSize, Label, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  import products from '../../plugin'
  import ProductPresenter from './ProductPresenter.svelte'
  import ProductsPopup from './ProductsPopup.svelte'
  import { IntlString } from '@hcengineering/platform'

  export let value: Ref<Product> | undefined
  export let readonly: boolean = false
  export let label: IntlString = products.string.Product
  export let onChange: (value: any) => void
  export let attribute: AnyAttribute | undefined = undefined

  export let focusIndex: number | undefined = undefined
  export let kind: ButtonKind = 'no-border'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = 'min-content'

  const dispatch = createEventDispatcher()
  const query = createQuery()
  let product: Product | undefined

  $: query.query(products.class.Product, { _id: value }, (result) => {
    ;[product] = result
  })

  function openPopup (event: MouseEvent): void {
    event.stopPropagation()
    if (readonly) return

    showPopup(ProductsPopup, { selected: value }, eventToHTMLElement(event), (result: Product | undefined) => {
      if (result === undefined || value === result?._id) return

      value = result?._id ?? null
      dispatch('change', value)
      dispatch('value', result)
      onChange(value)
    })
  }
</script>

{#if readonly || attribute?.readonly}
  <ProductPresenter value={product} />
{:else}
  <Button
    {justify}
    {focusIndex}
    showTooltip={{ label }}
    width={width ?? 'min-content'}
    {size}
    {kind}
    disabled={readonly}
    on:click={openPopup}
  >
    <div slot="content" class="overflow-label">
      {#if product}
        <ProductPresenter value={product} disabled />
      {:else}
        <Label label={products.string.Product} />
      {/if}
    </div>
  </Button>
{/if}
