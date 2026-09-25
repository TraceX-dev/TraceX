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
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { Class, Doc, Ref } from '@hcengineering/core'
  import { Button, IconAdd, IconClose, Label, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import { type Filter } from '@hcengineering/view'
  import {
    FilterTypePopup,
    getApplicableRefFilters,
    parseRefAttributeFilters,
    serializeRefAttributeFilters
  } from '@hcengineering/view-resources'
  import { getClient } from '@hcengineering/presentation'
  import { createEventDispatcher } from 'svelte'
  import setting from '../../plugin'

  // Class of the documents the filters are applied to
  export let _class: Ref<Class<Doc>>
  // Serialized filters
  export let value: string | undefined
  export let editable: boolean = true

  const dispatch = createEventDispatcher<{ change: string }>()
  const hierarchy = getClient().getHierarchy()

  $: filters = getApplicableRefFilters(hierarchy, _class, parseRefAttributeFilters(value))

  function change (filters: Filter[]): void {
    dispatch('change', serializeRefAttributeFilters(filters))
  }

  function add (e: MouseEvent): void {
    const target = eventToHTMLElement(e)
    const existing = filters
    showPopup(
      FilterTypePopup,
      {
        _class,
        target,
        index: existing.length + 1,
        onChange: (f: Filter) => {
          change([...existing, f])
        }
      },
      target
    )
  }

  function remove (i: number): void {
    change(filters.filter((_, idx) => idx !== i))
  }
</script>

<div class="flex-row-center flex-gap-1 flex-wrap">
  {#each filters as f, i (i)}
    <div class="flex-row-center filter-chip">
      <Label label={f.key?.label ?? setting.string.RelationFilter} />
      {#if Array.isArray(f.value) && f.value.length > 0}
        <span class="content-dark-color ml-1">({f.value.length})</span>
      {/if}
      {#if editable}
        <Button
          icon={IconClose}
          kind={'ghost'}
          size={'small'}
          on:click={() => {
            remove(i)
          }}
        />
      {/if}
    </div>
  {/each}
  {#if editable}
    <Button icon={IconAdd} label={setting.string.AddRelationFilter} kind={'ghost'} size={'small'} on:click={add} />
  {/if}
</div>

<style lang="scss">
  .filter-chip {
    padding: 0 0.25rem;
    min-height: 1.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;
  }
</style>
