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
  import type { Ref } from '@hcengineering/core'
  import type { ProductVersion } from '@hcengineering/products'
  import { DropdownLabelsPopup } from '@hcengineering/ui'

  export let versions: ProductVersion[]
  export let selectedObjects: Ref<ProductVersion>[] = []
  export let onChange: (value: Ref<ProductVersion>[]) => void

  let selected = [...selectedObjects]

  function updateSelection (event: CustomEvent<Ref<ProductVersion>[]>): void {
    selected = [...event.detail]
    onChange(selected)
  }

  $: items = versions.map((version) => ({
    id: version._id,
    label: `${version.major}.${version.minor}.${version.patch}${version.codename ? ` ${version.codename}` : ''}`
  }))
</script>

<DropdownLabelsPopup {items} {selected} multiselect on:update={updateSelection} on:close on:changeContent />
