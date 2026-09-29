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
  import { SortingOrder } from '@hcengineering/core'
  import type { DocumentQuery, Ref } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { createQuery } from '@hcengineering/presentation'
  import type { Product, ProductVersion } from '@hcengineering/products'
  import { Label, Menu, SearchEdit, SelectPopup } from '@hcengineering/ui'
  import type { Action } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import products from '../../plugin'

  export let selected: Ref<ProductVersion> | undefined = undefined
  export let docQuery: DocumentQuery<ProductVersion> | undefined = undefined

  const dispatch = createEventDispatcher<{ close: Ref<ProductVersion> | undefined }>()
  const productQuery = createQuery()
  const versionQuery = createQuery()
  let productList: Product[] = []
  let versions: ProductVersion[] = []
  let search = ''

  productQuery.query(
    products.class.Product,
    {},
    (result) => {
      productList = result
    },
    { sort: { name: SortingOrder.Ascending } }
  )

  $: versionQuery.query(
    products.class.ProductVersion,
    docQuery ?? {},
    (result) => {
      versions = result
    },
    { sort: { major: SortingOrder.Descending, minor: SortingOrder.Descending, patch: SortingOrder.Descending } }
  )

  $: versionsByProduct = versions.reduce((result, version) => {
    const items = result.get(version.space) ?? []
    items.push(version)
    result.set(version.space, items)
    return result
  }, new Map<Ref<Product>, ProductVersion[]>())

  $: actions = productList
    .filter(
      (product) => versionsByProduct.has(product._id) && product.name.toLowerCase().includes(search.toLowerCase())
    )
    .map((product): Action => ({
      id: product._id,
      label: getEmbeddedLabel(product.name),
      icon: products.icon.Product,
      action: async () => {},
      component: SelectPopup,
      props: {
        searchable: true,
        value: (versionsByProduct.get(product._id) ?? []).map((version) => ({
          id: version._id,
          text: `${version.major}.${version.minor}.${version.patch}${version.codename ? ` ${version.codename}` : ''}`,
          isSelected: version._id === selected
        })),
        onSelect: (value: Ref<ProductVersion>) => dispatch('close', value)
      }
    }))
</script>

<div class="selectPopup">
  <div class="p-2"><SearchEdit bind:value={search} kind="ghost" /></div>
  {#if actions.length > 0}
    <Menu {actions} on:close on:changeContent />
  {:else}
    <div class="p-4 caption-color"><Label label={products.string.NoProductVersions} /></div>
  {/if}
</div>
