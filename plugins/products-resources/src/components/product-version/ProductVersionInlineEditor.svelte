<!--
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
  import type { DocumentQuery, Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { Button, Label, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import type { ButtonKind, ButtonSize } from '@hcengineering/ui'
  import type { ProductVersion } from '@hcengineering/products'
  import { createEventDispatcher } from 'svelte'

  import products from '../../plugin'
  import ProductVersionPresenter from './ProductVersionPresenter.svelte'
  import ProductVersionSelectPopup from './ProductVersionSelectPopup.svelte'

  export let value: Ref<ProductVersion> | undefined
  export let onChange: ((value: Ref<ProductVersion> | undefined) => void) | undefined = undefined
  export let readonly: boolean = false
  export let kind: ButtonKind = 'no-border'
  export let size: ButtonSize = 'small'
  export let justify: 'left' | 'center' = 'left'
  export let width: string | undefined = undefined
  export let docQuery: DocumentQuery<ProductVersion> | undefined = undefined

  const dispatch = createEventDispatcher<{ change: Ref<ProductVersion> }>()
  const query = createQuery()
  let selected: ProductVersion | undefined

  $: if (value !== undefined) {
    query.query(products.class.ProductVersion, { _id: value }, (result) => {
      selected = result[0]
    })
  } else {
    query.unsubscribe()
    selected = undefined
  }

  function openPopup (event: MouseEvent): void {
    if (readonly) return

    showPopup(
      ProductVersionSelectPopup,
      { selected: value, docQuery },
      eventToHTMLElement(event),
      (result: Ref<ProductVersion> | undefined) => {
        if (result === undefined || result === value) return
        value = result
        dispatch('change', value)
        onChange?.(value)
      }
    )
  }
</script>

<Button disabled={readonly} {kind} {size} {justify} width={width ?? 'min-content'} on:click={openPopup}>
  <div slot="content" class="overflow-label flex-grow">
    {#if selected}
      <ProductVersionPresenter value={selected} disabled />
    {:else}
      <Label label={products.string.ProductVersion} />
    {/if}
  </div>
</Button>
