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
  import { getEmbeddedLabel, translate, type IntlString } from '@hcengineering/platform'
  import presentation, { getClient } from '@hcengineering/presentation'
  import {
    EditWithIcon,
    Icon,
    IconCheck,
    IconSearch,
    Label,
    deviceOptionsStore,
    resizeObserver,
    themeStore
  } from '@hcengineering/ui'
  import type { Filter } from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'
  import { FILTER_DEBOUNCE_MS } from '../../filter'
  import view from '../../plugin'

  export let filter: Filter
  export let onChange: (filter: Filter) => void

  interface Item {
    id: Ref<Class<Doc>>
    label: IntlString
  }

  const dispatch = createEventDispatcher<{ changeContent: void }>()
  const hierarchy = getClient().getHierarchy()

  filter.modes = [view.filter.FilterObjectIn, view.filter.FilterObjectNin]
  filter.mode = filter.mode ?? filter.modes[0]

  let selected = new Set<Ref<Class<Doc>>>(filter.value)
  const items: Item[] = []
  for (const id of new Set([...hierarchy.getDescendants(filter.key._class), ...selected])) {
    const clazz = hierarchy.findClass(id) as (Class<Doc> & { removed?: boolean }) | undefined
    if (clazz?.removed === true && !selected.has(id)) continue
    items.push({ id, label: clazz?.label ?? getEmbeddedLabel(id) })
  }

  let labels = new Map<Ref<Class<Doc>>, string>()
  async function translateLabels (lang: string): Promise<void> {
    const res = new Map<Ref<Class<Doc>>, string>()
    for (const item of items) res.set(item.id, await translate(item.label, {}, lang))
    labels = res
  }
  $: void translateLabels($themeStore.language)

  let search = ''
  $: sorted = [...items].sort((a, b) => (labels.get(a.id) ?? '').localeCompare(labels.get(b.id) ?? ''))
  $: visible =
    search.trim() === ''
      ? sorted
      : sorted.filter((it) => (labels.get(it.id) ?? '').toLowerCase().includes(search.trim().toLowerCase()))

  let timeout: any
  function toggle (id: Ref<Class<Doc>>): void {
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    selected = selected
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      filter.value = [...selected]
      onChange(filter)
    }, FILTER_DEBOUNCE_MS)
  }
</script>

<div class="selectPopup" use:resizeObserver={() => dispatch('changeContent')}>
  {#if items.length > 7}
    <div class="header">
      <EditWithIcon
        icon={IconSearch}
        size="large"
        width="100%"
        autoFocus={!$deviceOptionsStore.isMobile}
        bind:value={search}
        placeholder={presentation.string.Search}
      />
    </div>
  {:else}
    <div class="menu-space" />
  {/if}
  <div class="scroll">
    <div class="box">
      {#each visible as item (item.id)}
        <button
          class="menu-item no-focus content-pointer-events-none"
          on:click={() => {
            toggle(item.id)
          }}
        >
          <span class="overflow-label flex-grow"><Label label={item.label} /></span>
          <div class="check pointer-events-none">
            {#if selected.has(item.id)}
              <Icon icon={IconCheck} size="small" />
            {/if}
          </div>
        </button>
      {/each}
    </div>
  </div>
  <div class="menu-space" />
</div>
