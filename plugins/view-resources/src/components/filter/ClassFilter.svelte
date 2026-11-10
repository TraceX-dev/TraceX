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
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import { Button, DropdownLabelsIntl, type DropdownIntlItem } from '@hcengineering/ui'
  import type { Filter } from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'
  import view from '../../plugin'

  export let filter: Filter
  export let onChange: (filter: Filter) => void
  const dispatch = createEventDispatcher<{ close: void }>()
  const hierarchy = getClient().getHierarchy()
  let selected: Ref<Class<Doc>>[] = [...filter.value]
  const ids = new Set([...hierarchy.getDescendants(filter.key._class), ...selected])
  const items: Array<DropdownIntlItem<Ref<Class<Doc>>>> = []
  for (const id of ids) {
    const clazz = hierarchy.findClass(id)
    if ((clazz as (Class<Doc> & { removed?: boolean }) | undefined)?.removed === true && !selected.includes(id))
      continue
    const item: DropdownIntlItem<Ref<Class<Doc>>> = { id, label: clazz?.label ?? getEmbeddedLabel(id) }
    items.push(item)
  }
  filter.modes = [view.filter.FilterObjectIn, view.filter.FilterObjectNin]
  filter.mode = filter.mode ?? filter.modes[0]
</script>

<div class="selectPopup flex-col p-2 flex-gap-2">
  <DropdownLabelsIntl
    {items}
    multiselect
    bind:selected
    withSearch
    shouldUpdateUndefined={false}
    label={filter.key.label}
  />
  <Button
    label={view.string.Apply}
    kind="primary"
    on:click={() => {
      filter.value = selected
      onChange(filter)
      dispatch('close')
    }}
  />
</div>
