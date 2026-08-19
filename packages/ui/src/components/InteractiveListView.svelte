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
  import { createEventDispatcher } from 'svelte'

  import { getEventPositionElement, showPopup } from '../popups'
  import type { InteractiveListActionContext, InteractiveListActionsProvider } from '../types'
  import ListView from './ListView.svelte'
  import Menu from './Menu.svelte'

  interface ContextMenuDetail {
    event: MouseEvent
    row: number
  }

  export let items: unknown[] = []
  export let count: number = items.length
  export let selection: number = -1
  export let selectedKeys: Set<string> = new Set<string>()
  export let getKey: (index: number) => string = (index) => index.toString()
  export let getActions: InteractiveListActionsProvider | undefined = undefined
  export let addClass: string | undefined = undefined
  export let noScroll: boolean = false
  export let kind: 'default' | 'thin' | 'full-size' = 'default'
  export let colorsSchema: 'default' | 'lumia' = 'default'
  export let updateOnMouse: boolean = true
  export let lazy: boolean = false
  export let minHeight: string | null = null
  export let highlightIndex: number | undefined = undefined
  export let collapsible: boolean = false
  export let collapsed: boolean = false
  export let contentClass: string = ''

  const dispatch = createEventDispatcher<{
    error: unknown
  }>()

  export async function openActions(event: MouseEvent, index: number): Promise<void> {
    if (getActions === undefined) return

    event.preventDefault()
    event.stopPropagation()

    const key = getKey(index)
    const actionSelectedKeys = selectedKeys.has(key) ? [...selectedKeys] : [key]

    const context: InteractiveListActionContext = {
      key,
      index,
      selectedKeys: actionSelectedKeys
    }

    try {
      const actions = await getActions(context)
      if (actions.length === 0) return
      selection = index
      // Context-clicking outside the current selection starts a new desktop-style selection.
      if (!selectedKeys.has(key)) selectedKeys = new Set([key])
      showPopup(Menu, { actions, ctx: context }, getEventPositionElement(event))
    } catch (error) {
      dispatch('error', error)
    }
  }

  function handleContextMenu(event: CustomEvent<ContextMenuDetail>): void {
    openActions(event.detail.event, event.detail.row).catch((error) => {
      dispatch('error', error)
    })
  }

  function toggleCollapsed(): void {
    if (!collapsible) return
    collapsed = !collapsed
  }
</script>

<slot name="groupHeader" {selectedKeys} {collapsed} {toggleCollapsed} />
{#if !collapsible || !collapsed}
  <div class={contentClass}>
    <slot name="header" {selectedKeys} />
    <ListView
      {items}
      {count}
      bind:selection
      {getKey}
      {addClass}
      {noScroll}
      {kind}
      {colorsSchema}
      {updateOnMouse}
      {lazy}
      {minHeight}
      {highlightIndex}
      isSelected={(index) => selectedKeys.has(getKey(index))}
      on:click
      on:on-select
      on:changeContent
      on:contextmenu={handleContextMenu}
    >
      <svelte:fragment slot="category" let:item={index} let:value>
        <slot name="category" item={index} {value} selected={selectedKeys.has(getKey(index))} />
      </svelte:fragment>
      <svelte:fragment slot="item" let:item={index} let:value>
        <slot name="item" item={index} {value} selected={selectedKeys.has(getKey(index))} />
      </svelte:fragment>
    </ListView>
  </div>
{/if}
