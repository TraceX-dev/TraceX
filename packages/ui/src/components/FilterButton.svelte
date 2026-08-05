<!--
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
<script context="module" lang="ts">
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import Button from './Button.svelte'
  import IconFilter from './icons/Filter.svelte'
  import { eventToHTMLElement, showPopup } from '../popups'
  import FilterCategoryPopup from './FilterCategoryPopup.svelte'
  import type { ButtonKind, ActiveFilter, FilterCategory } from '../types'
  import ui from '../plugin'

  export let categories: FilterCategory[] = []
  export let activeFilters: ActiveFilter[] = []
  export let disabled: boolean = false
  export let size: 'x-small' | 'small' | 'medium' | 'large' = 'medium'
  export let kind: ButtonKind = 'regular'
  export let showLabel: boolean = true

  const dispatch = createEventDispatcher<{
    change: ActiveFilter[]
  }>()

  function clearFilters (): void {
    dispatch('change', [])
  }

  function addFilter (filter: ActiveFilter): void {
    // Remove any existing filter for the same category and add the new one
    const filtered = activeFilters.filter((f) => f.categoryId !== filter.categoryId)
    dispatch('change', [...filtered, filter])
  }

  function removeFilter (categoryId: string): void {
    dispatch(
      'change',
      activeFilters.filter((f) => f.categoryId !== categoryId)
    )
  }

  function showFilterPopup (e: MouseEvent): void {
    const target = eventToHTMLElement(e)
    showPopup(
      FilterCategoryPopup,
      {
        categories,
        activeFilters,
        onFilterChange: addFilter,
        onFilterRemove: removeFilter,
        onFiltersClear: clearFilters
      },
      target
    )
  }

  $: hasFilters = activeFilters.length > 0
</script>

{#if hasFilters}
  <Button
    icon={IconFilter}
    label={showLabel ? ui.string.Filter : undefined}
    {kind}
    {size}
    pressed
    {disabled}
    on:click={showFilterPopup}
  >
    <svelte:fragment slot="content">
      <span class="filterCount">{activeFilters.length}</span>
    </svelte:fragment>
  </Button>
{:else}
  <Button
    icon={IconFilter}
    label={showLabel ? ui.string.Filter : undefined}
    {kind}
    {size}
    {disabled}
    on:click={showFilterPopup}
  />
{/if}

<style lang="scss">
  .filterCount {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1rem;
    height: 1rem;
    margin-left: var(--spacing-1);
    padding: 0 0.25rem;
    border-radius: 0.5rem;
    background: var(--theme-primary-bg-color);
    color: var(--theme-primary-color);
    font-size: 0.6875rem;
    line-height: 1;
  }
</style>
