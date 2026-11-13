<!--
//
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
//

-->
<script lang="ts">
  import { type Class, type Doc, type Ref } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import { Button, IconAdd, Label, eventToHTMLElement, showPopup } from '@hcengineering/ui'
  import { type Filter, type KeyFilterPreset } from '@hcengineering/view'
  import { createEventDispatcher, onMount } from 'svelte'
  import { parseReferenceFilters, referenceFilterQuery, serializeReferenceFilters } from '../../reference-filters'
  import view from '../../plugin'
  import FilterSection from './FilterSection.svelte'
  import FilterTypePopup from './FilterTypePopup.svelte'

  export let _class: Ref<Class<Doc>>
  export let value: string | undefined = undefined
  export let disabled = false

  const dispatch = createEventDispatcher<{ change: { value: string | undefined, valid: boolean } }>()
  const hierarchy = getClient().getHierarchy()
  let filters: Filter[] = []
  let invalid = false
  let revision = 0
  // Modes such as "is not set" are complete without selected values.
  const valuelessModes = new Set(
    getClient()
      .getModel()
      .findAllSync(view.class.FilterMode, { disableValueSelector: true })
      .map((mode) => mode._id)
  )

  function isComplete (filter: Filter): boolean {
    return filter.value.length > 0 || valuelessModes.has(filter.mode)
  }

  async function validate (source: string | undefined, hydrate = false): Promise<void> {
    const current = ++revision
    invalid = false
    dispatch('change', { value: source, valid: source === undefined })
    try {
      const next = source === undefined ? [] : parseReferenceFilters(_class, source)
      if (source !== undefined) await referenceFilterQuery(_class, source)
      if (current !== revision) return
      // Keep the edited chips (including empty ones) on screen; only the stored value is reloaded.
      if (hydrate) filters = next
      dispatch('change', { value: source, valid: true })
    } catch {
      if (current !== revision) return
      invalid = true
      dispatch('change', { value: source, valid: false })
    }
  }

  onMount(() => {
    void validate(value, true)
  })

  function changed (): void {
    // A condition with nothing selected yet is not stored, so it cannot make the attribute invalid.
    value = serializeReferenceFilters(filters.filter(isComplete))
    void validate(value)
  }

  function add (event: MouseEvent): void {
    const preset: KeyFilterPreset = {
      _class,
      key: '_class',
      label: hierarchy.getAttribute(_class, '_class').label,
      component: view.component.ClassFilter,
      showNested: false
    }
    showPopup(
      FilterTypePopup,
      {
        _class,
        target: eventToHTMLElement(event),
        index: filters.length,
        allowAllFields: true,
        allowNested: false,
        additionalFilters: [preset],
        excludedKeys: filters.map((filter) => filter.key._class + '.' + filter.key.key),
        onChange: (filter: Filter): void => {
          // Multi-select popups report every toggle; update the same condition instead of appending a duplicate.
          const identity = filter.key._class + '.' + filter.key.key
          const existing = filters.findIndex(
            (item) => item === filter || item.key._class + '.' + item.key.key === identity
          )
          filters = existing === -1 ? [...filters, filter] : filters.map((item, i) => (i === existing ? filter : item))
          changed()
        }
      },
      eventToHTMLElement(event)
    )
  }
</script>

<div class="flex-col flex-gap-2">
  {#if invalid}
    <Label label={view.string.InvalidReferenceFilter} />
    <Button
      label={view.string.ClearFilters}
      kind="ghost"
      {disabled}
      on:click={() => {
        filters = []
        value = undefined
        void validate(value)
      }}
    />
  {:else}
    <div class="flex-row-center flex-wrap flex-gap-1">
      {#each filters as filter, i (filter.key._class + '.' + filter.key.key)}
        <FilterSection
          bind:filter={filters[i]}
          space={undefined}
          readonly={disabled}
          on:change={changed}
          on:remove={() => {
            filters = filters.filter((_, index) => index !== i)
            changed()
          }}
        />
      {/each}
      {#if !disabled}
        <Button
          icon={IconAdd}
          label={filters.length === 0 ? view.string.Filter : undefined}
          kind="ghost"
          size="small"
          showTooltip={filters.length > 0 ? { label: view.string.Filter } : undefined}
          on:click={add}
        />
      {/if}
    </div>
  {/if}
</div>
