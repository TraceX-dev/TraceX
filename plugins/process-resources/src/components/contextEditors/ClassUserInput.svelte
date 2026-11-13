<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  import { TypeSelector } from '@hcengineering/card-resources'
  import { Class, Doc, Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { isRequiredValueFilled } from '../../required-value'

  export let _class: Ref<Class<Doc>>
  export let value: any | undefined = undefined

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const attribute = hierarchy.findAttribute(_class, '_class')

  const dispatch = createEventDispatcher()
  function onChange (val: any | undefined): void {
    value = val
    dispatch('change', val)
  }
</script>

{#if attribute}
  <div class:required-empty={!isRequiredValueFilled(value, attribute.type)}>
    <Label label={attribute.label} />:
    <span class="required-asterisk">*</span>
  </div>
{/if}
<div class="w-full">
  <TypeSelector
    value={value ?? _class}
    parent={_class}
    kind={'ghost'}
    width={'100%'}
    excludeBaseTypes
    on:change={(e) => {
      if (e.detail !== undefined) {
        onChange(e.detail)
      }
    }}
  />
</div>

<style lang="scss">
  .required-empty,
  .required-asterisk {
    color: var(--theme-error-color);
  }
</style>
