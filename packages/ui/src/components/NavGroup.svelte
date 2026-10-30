<!--
// Copyright © 2023 Hardcore Engineering Inc.
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
  import type { Doc, Ref } from '@hcengineering/core'
  import { createEventDispatcher } from 'svelte'
  import type { Asset, IntlString } from '@hcengineering/platform'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { getEventPositionElement } from '../popups'
  import type { AnyComponent, IconSize, AnySvelteComponent } from '..'
  import {
    ActionIcon,
    ButtonIcon,
    showPopup,
    Menu,
    Action,
    Label,
    Component,
    IconDown,
    IconMoreH,
    IconOpenedArrow,
    IconFolderCollapsed,
    IconFolderExpanded,
    Icon,
    getTreeCollapsed,
    setTreeCollapsed,
    tooltip
  } from '..'

  export let icon: Asset | AnySvelteComponent | undefined = undefined
  export let folderIcon: boolean = false
  export let iconProps: any | undefined = undefined
  export let iconSize: IconSize = 'small'
  export let label: IntlString | undefined = undefined
  export let title: string | undefined = undefined
  export let categoryName: string
  export let tools: AnyComponent | undefined = undefined
  export let isOpen: boolean = true
  export let isFold: boolean = false
  export let empty: boolean = false
  export let collapsedPrefix: string = ''
  export let visible: boolean = false
  export let highlighted: boolean = false
  export let selected: boolean = false
  export let type: 'default' | 'nested' | 'nested-selectable' | 'selectable-header' = 'default'
  export let noDivider: boolean = false
  export let showMenu: boolean = false
  export let shouldTooltip: boolean = false
  export let forciblyCollapsed: boolean = false
  export let draggable: boolean = false
  export let actions: Action[] | ((originalEvent?: MouseEvent) => Action[] | Promise<Action[]>) = []
  export let _id: Ref<Doc> | string | undefined = undefined

  const dispatch = createEventDispatcher()

  $: id = `navGroup-${categoryName}`
  let pressed: boolean = false
  let menuOpened: boolean = false
  let inlineActions: Action[] = []
  let menuActions: Action[] = []

  const handleClick = (e: MouseEvent): void => {
    if (type === 'selectable-header') dispatch('click')
    else if ((!selected || empty) && type === 'nested-selectable') dispatch('click')
    else if (!empty) {
      toggle(e)
    }
  }

  function toggle (e: MouseEvent): void {
    e.stopPropagation()
    e.preventDefault()
    if (!empty) {
      isOpen = !isOpen
      dispatch('toggle', isOpen)
    }
  }

  async function getActions (originalEvent?: MouseEvent): Promise<Action[]> {
    return typeof actions === 'function' ? await actions(originalEvent) : actions
  }

  async function refreshActions (): Promise<void> {
    const result = await getActions()
    inlineActions = result.filter((action) => action.inline === true)
    menuActions = result.filter((action) => action.inline !== true)
  }

  async function openMenu (
    ev: MouseEvent,
    target: HTMLElement | ReturnType<typeof getEventPositionElement>,
    fromMenuButton: boolean
  ): Promise<void> {
    ev.stopPropagation()
    menuActions = (await getActions(ev)).filter((action) => action.inline !== true)
    if (menuActions.length === 0) return
    menuOpened = true
    pressed = fromMenuButton
    showPopup(Menu, { actions: menuActions, ctx: _id }, target, () => {
      pressed = false
      menuOpened = false
    })
  }

  async function handleMenuClicked (ev: MouseEvent): Promise<void> {
    await openMenu(ev, ev.target as HTMLElement, true)
  }

  async function handleContextMenu (ev: MouseEvent): Promise<void> {
    ev.preventDefault()
    await openMenu(ev, getEventPositionElement(ev), false)
  }

  async function handleInlineActionClicked (ev: MouseEvent, action: Action): Promise<void> {
    ev.stopPropagation()
    await action.action(_id, ev)
  }

  $: if (actions !== undefined) void refreshActions()
  $: isOpen = !getTreeCollapsed(_id, collapsedPrefix)
  $: setTreeCollapsed(_id, !isOpen, collapsedPrefix)
  $: visibleIcon = folderIcon ? (isOpen && !empty ? IconFolderExpanded : IconFolderCollapsed) : icon
</script>

<div
  class="hulyNavGroup-container"
  class:nested={type === 'nested' || type === 'nested-selectable'}
  class:selectable={type === 'nested-selectable' || type === 'selectable-header'}
  class:selectableHeader={type === 'selectable-header'}
  class:noIcon={!icon}
  class:noDivider
>
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="hulyNavGroup-header"
    class:isOpen={(isOpen || visible) && !empty}
    class:highlighted
    class:selected
    class:showMenu={showMenu || menuOpened}
    on:contextmenu={handleContextMenu}
    {draggable}
    on:dragstart
    on:dragover
    on:dragend
    on:drop
  >
    <button class="hulyNavGroup-header__toggle" on:click={handleClick}>
      {#if isFold && !empty}
        <span class="hulyNavGroup-header__chevron" class:collapsed={!isOpen}>
          <IconDown size={'small'} />
        </span>
      {/if}
      <span class="hulyNavGroup-header__label font-medium-12">
        {#if visibleIcon}
          <span class="hulyNavGroup-header__icon" class:folder={folderIcon}>
            <Icon icon={visibleIcon} size={iconSize} {iconProps} />
          </span>
        {/if}
        <span
          use:tooltip={shouldTooltip ? { label: label ?? getEmbeddedLabel(title ?? ''), direction: 'top' } : undefined}
          class="overflow-label"
        >
          {#if label}<Label {label} />{/if}
          {#if title}{title}{/if}
        </span>
      </span>
    </button>
    {#if $$slots.extra}<div><slot name="extra" /></div>{/if}
    {#if tools !== undefined || $$slots.tools}
      <div class="hulyNavGroup-header__tools">
        {#if tools}
          <Component
            is={tools}
            props={{
              kind: 'tools',
              categoryName
            }}
          />
        {/if}
        <slot name="tools" />
      </div>
    {/if}
    {#if inlineActions.length > 0 || menuActions.length > 0}
      <div class="hulyNavGroup-header__actions">
        {#each inlineActions as action}
          <ButtonIcon
            icon={action.icon ?? ActionIcon}
            kind="tertiary"
            size="extra-small"
            tooltip={{ label: action.label, direction: 'top' }}
            noFocus
            on:click={(ev) => handleInlineActionClicked(ev, action)}
          />
        {/each}
        {#if menuActions.length === 1 && menuActions[0].icon}
          <ButtonIcon
            id={_id}
            icon={menuActions[0].icon}
            kind="tertiary"
            size="extra-small"
            tooltip={{ label: menuActions[0].label, direction: 'top' }}
            noFocus
            on:click={(ev) => handleInlineActionClicked(ev, menuActions[0])}
          />
        {:else if menuActions.length > 0}
          <ButtonIcon
            icon={IconMoreH}
            kind="tertiary"
            size="extra-small"
            noFocus
            {pressed}
            on:click={handleMenuClicked}
          />
        {/if}
      </div>
    {/if}
    {#if selected && type === 'nested-selectable'}
      <div class="hulyNavGroup-header__arrow"><IconOpenedArrow size={'small'} /></div>
    {/if}
  </div>
  {#if !empty}
    <div {id} class="hulyNavGroup-content">
      {#if (!isOpen && visible) || forciblyCollapsed}
        <slot name="visible" {isOpen} />
      {:else}
        <slot />
      {/if}
    </div>
  {/if}
</div>
