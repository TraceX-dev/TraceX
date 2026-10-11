<!--
//
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
  import { type Product } from '@hcengineering/products'
  import { type AnyAttribute, type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Button, type ButtonKind, type ButtonSize, eventToHTMLElement, Label, showPopup } from '@hcengineering/ui'
  import { ObjectsTooltipWrapper } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import products from '../../plugin'
  import ProductsPopup from './ProductsPopup.svelte'

  export let value: Array<Ref<Product>> | Ref<Product> | undefined
  export let readonly: boolean = false
  export let label: IntlString | undefined = undefined
  export let onChange: ((value: Array<Ref<Product>>) => void) | undefined = undefined
  export let attribute: AnyAttribute | undefined = undefined
  export let focusIndex: number | undefined = undefined
  export let kind: ButtonKind = 'ghost'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = 'min-content'

  const client = getClient()
  const dispatch = createEventDispatcher()
  const icon = client.getHierarchy().getClass(products.class.Product).icon

  function toArray (value: Array<Ref<Product>> | Ref<Product> | undefined): Array<Ref<Product>> {
    return value === undefined ? [] : Array.isArray(value) ? value : [value]
  }

  function openPopup (event: MouseEvent): void {
    if (onChange === undefined || readonly) return
    event.stopPropagation()

    showPopup(
      ProductsPopup,
      { selectedObjects: toArray(value), multiSelect: true },
      eventToHTMLElement(event),
      undefined,
      (result: Ref<Product>[]) => {
        onChange?.(result)
        dispatch('change', result)
      }
    )
  }

  let productsList: Product[] = []
  const query = createQuery()
  $: query.query(products.class.Product, { _id: { $in: toArray(value) } }, (result) => {
    productsList = result
  })

  $: emptyLabel = label ?? attribute?.label ?? products.string.Product
</script>

<ObjectsTooltipWrapper
  selectedCount={toArray(value).length}
  objects={productsList}
  objectIds={toArray(value)}
  label={emptyLabel}
  {readonly}
  {width}
>
  <Button {justify} {focusIndex} width={'100%'} {size} {icon} {kind} disabled={readonly} on:click={openPopup}>
    <div slot="content" class="overflow-label">
      {#if productsList.length === 1}
        {productsList[0].name}
      {:else if productsList.length > 1}
        <div class="lower">{productsList.length} <Label label={products.string.Products} /></div>
      {:else}
        <Label label={emptyLabel} />
      {/if}
    </div>
  </Button>
</ObjectsTooltipWrapper>
