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
  import { type ProductVersion } from '@hcengineering/products'
  import { type AnyAttribute, type DocumentQuery, type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Button, type ButtonKind, type ButtonSize, eventToHTMLElement, Label, showPopup } from '@hcengineering/ui'
  import { ObjectsTooltipWrapper } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import products from '../../plugin'
  import ProductVersionSelectPopup from './ProductVersionSelectPopup.svelte'
  import ProductVersionPresenter from './ProductVersionPresenter.svelte'

  export let value: Array<Ref<ProductVersion>> | Ref<ProductVersion> | undefined
  export let readonly: boolean = false
  export let label: IntlString | undefined = undefined
  export let onChange: ((value: Array<Ref<ProductVersion>>) => void) | undefined = undefined
  export let attribute: AnyAttribute | undefined = undefined
  export let focusIndex: number | undefined = undefined
  export let kind: ButtonKind = 'ghost'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = 'min-content'

  export let docQuery: DocumentQuery<ProductVersion> | undefined = undefined

  const client = getClient()
  const dispatch = createEventDispatcher()
  const icon = client.getHierarchy().getClass(products.class.ProductVersion).icon

  function toArray (value: Array<Ref<ProductVersion>> | Ref<ProductVersion> | undefined): Array<Ref<ProductVersion>> {
    return value === undefined ? [] : Array.isArray(value) ? value : [value]
  }

  function openPopup (event: MouseEvent): void {
    if (readonly || attribute?.readonly) return
    event.stopPropagation()

    showPopup(
      ProductVersionSelectPopup,
      { selectedObjects: [...toArray(value)], multiSelect: true, docQuery },
      eventToHTMLElement(event),
      undefined,
      (result: Ref<ProductVersion>[]) => {
        value = [...result]
        onChange?.(value)
        dispatch('change', result)
      }
    )
  }

  let productsList: ProductVersion[] = []
  const query = createQuery()
  $: query.query(products.class.ProductVersion, { _id: { $in: toArray(value) } }, (result) => {
    productsList = result
  })

  $: emptyLabel = label ?? attribute?.label ?? products.string.ProductVersion
</script>

<ObjectsTooltipWrapper
  selectedCount={toArray(value).length}
  objects={productsList}
  objectIds={toArray(value)}
  label={emptyLabel}
  {readonly}
  {width}
>
  <Button
    {justify}
    {focusIndex}
    width={'100%'}
    {size}
    {icon}
    {kind}
    disabled={readonly || attribute?.readonly}
    on:click={openPopup}
  >
    <div slot="content" class="overflow-label">
      {#if productsList.length === 1}
        <ProductVersionPresenter value={productsList[0]} disabled />
      {:else if productsList.length > 1}
        <div class="lower">{productsList.length} <Label label={products.string.ProductVersions} /></div>
      {:else}
        <Label label={emptyLabel} />
      {/if}
    </div>
  </Button>
</ObjectsTooltipWrapper>
