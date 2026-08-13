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
  import { type Ref } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { ObjectPopup } from '@hcengineering/presentation'
  import { type Product } from '@hcengineering/products'

  import products from '../../plugin'
  import ProductPresenter from './ProductPresenter.svelte'

  export let selected: Ref<Product> | undefined = undefined
  export let selectedObjects: Array<Ref<Product>> | undefined = undefined
  export let multiSelect: boolean = false
  export let allowDeselect: boolean = true
  export let titleDeselect: IntlString | undefined = undefined
  export let readonly: boolean = false
</script>

<ObjectPopup
  _class={products.class.Product}
  {selected}
  {selectedObjects}
  {multiSelect}
  {allowDeselect}
  {titleDeselect}
  searchField="name"
  type="object"
  groupBy="_class"
  forceShowSelected={false}
  on:update
  on:close
  on:changeContent
  {readonly}
>
  <svelte:fragment slot="item" let:item>
    <ProductPresenter value={item} disabled />
  </svelte:fragment>
</ObjectPopup>
