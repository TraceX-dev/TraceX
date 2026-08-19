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
  import core, { type Space } from '@hcengineering/core'
  import {
    CheckBox,
    Icon,
    IconChevronDown,
    InteractiveListView,
    type InteractiveListActionContext,
    type InteractiveListActionsProvider,
    Label,
    StateTag,
    StateType
  } from '@hcengineering/ui'
  import { getClient } from '@hcengineering/presentation'
  import type { SpaceApplicationResolver } from '@hcengineering/workbench'

  import setting from '../../plugin'
  import type { SpacesViewActionsProvider, SpacesViewColumn } from './spaces-view'

  const OTHER_APPLICATIONS = 'other'
  const hierarchy = getClient().getHierarchy()

  export let spaces: Space[]
  export let spaceApplicationResolver: SpaceApplicationResolver
  export let columns: SpacesViewColumn[]
  export let minWidth: string = '43rem'
  export let selectable: boolean = false
  export let selectedKeys: Set<string> = new Set<string>()
  export let getActions: SpacesViewActionsProvider | undefined = undefined
  export let emphasizedKeys: Set<string> | undefined = undefined
  export let handleError: (error: unknown) => void

  function toggleSpaceSelection(space: Space, selected: boolean): void {
    const next = new Set(selectedKeys)
    if (selected) next.add(space._id)
    else next.delete(space._id)
    selectedKeys = next
  }

  function toggleSpacesSelection(spacesToToggle: Space[], selected: boolean): void {
    const next = new Set(selectedKeys)
    for (const space of spacesToToggle) {
      if (selected) next.add(space._id)
      else next.delete(space._id)
    }
    selectedKeys = next
  }

  function areAllSpacesSelected(groupSpaces: Space[]): boolean {
    return groupSpaces.length > 0 && groupSpaces.every((space) => selectedKeys.has(space._id))
  }

  function areSomeSpacesSelected(groupSpaces: Space[]): boolean {
    return groupSpaces.some((space) => selectedKeys.has(space._id))
  }

  function createActionsProvider(groupSpaces: Space[]): InteractiveListActionsProvider | undefined {
    if (getActions === undefined) return undefined
    return (context: InteractiveListActionContext) => getActions?.(groupSpaces[context.index], context) ?? []
  }

  $: groups = spaceApplicationResolver.group(spaces)
  $: gridTemplateColumns = `${selectable ? '2rem ' : ''}${columns.map((column) => column.width).join(' ')}`
</script>

<div class="spacesViewGroups">
  {#each groups as group (group.application?._id ?? OTHER_APPLICATIONS)}
    <section class="spacesViewGroup" style:min-width={minWidth}>
      <InteractiveListView
        items={group.spaces}
        count={group.spaces.length}
        selection={-1}
        bind:selectedKeys
        getKey={(index) => group.spaces[index]._id}
        getActions={createActionsProvider(group.spaces)}
        updateOnMouse={false}
        noScroll
        kind={'full-size'}
        addClass={'spacesViewItem'}
        contentClass={'spacesViewTable'}
        collapsible
        on:error={(event) => {
          handleError(event.detail)
        }}
      >
        <svelte:fragment slot="groupHeader" let:collapsed let:toggleCollapsed>
          <div class="spacesViewGroupHeader">
            <button
              class="spacesViewTitle"
              type="button"
              aria-expanded={collapsed === false}
              on:click={toggleCollapsed}
            >
              <span class:collapsed class="collapseIcon"><IconChevronDown size={'small'} /></span>
              {#if group.application !== undefined}
                <Icon icon={group.application.icon} size={'small'} />
                <Label label={group.application.label} />
              {:else}
                <Label label={setting.string.OtherSpaces} />
              {/if}
              <span>{group.spaces.length}</span>
            </button>
          </div>
        </svelte:fragment>
        <svelte:fragment slot="header">
          <div class="spacesViewHeader" style:grid-template-columns={gridTemplateColumns} style:min-width={minWidth}>
            {#if selectable}
              <CheckBox
                checked={areAllSpacesSelected(group.spaces)}
                symbol={areSomeSpacesSelected(group.spaces) && !areAllSpacesSelected(group.spaces) ? 'minus' : 'check'}
                on:value={(event) => {
                  toggleSpacesSelection(group.spaces, event.detail)
                }}
              />
            {/if}
            {#each columns as column (column.id)}
              <span><Label label={column.label} /></span>
            {/each}
          </div>
        </svelte:fragment>
        <svelte:fragment slot="item" let:item={index}>
          {@const space = group.spaces[index]}
          <div class="spacesViewRow" style:grid-template-columns={gridTemplateColumns} style:min-width={minWidth}>
            {#if selectable}
              <CheckBox
                checked={selectedKeys.has(space._id)}
                on:value={(event) => {
                  toggleSpaceSelection(space, event.detail)
                }}
              />
            {/if}
            {#each columns as column (column.id)}
              {#if column.id === 'name'}
                <div class="spaceName">
                  <span
                    class:emphasized={emphasizedKeys === undefined || emphasizedKeys.has(space._id)}
                    class="spaceTitle"
                  >
                    {space.name}
                  </span>
                  <span class="spaceType"><Label label={hierarchy.getClass(space._class).label} /></span>
                </div>
              {:else if column.id === 'visibility'}
                <div class="visibilityCell">
                  <StateTag
                    type={space.private ? StateType.Ghost : StateType.Positive}
                    label={space.private ? core.string.Private : setting.string.Public}
                  />
                </div>
              {:else}
                <div class="customCell"><slot name="cell" {space} {column} /></div>
              {/if}
            {/each}
          </div>
        </svelte:fragment>
      </InteractiveListView>
    </section>
  {/each}
</div>

<style lang="scss">
  .spacesViewGroups {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-4);
  }
  .spacesViewGroupHeader {
    min-height: 2rem;
    padding: 0 var(--spacing-1) var(--spacing-2);
  }
  .spacesViewTitle {
    display: flex;
    align-items: center;
    min-width: 0;
    padding: 0;
    gap: var(--spacing-2);
    color: var(--theme-content-color);
    font: inherit;
    font-size: 0.875rem;
    font-weight: 600;
    text-align: left;
    background: transparent;
    border: 0;
    cursor: pointer;
  }
  .spacesViewTitle > span:not(.collapseIcon) {
    color: var(--theme-caption-color);
    font-size: 0.75rem;
    font-weight: 500;
  }
  .collapseIcon {
    display: flex;
    align-items: center;
    color: var(--theme-caption-color);
    transition: transform 0.15s var(--timing-main);
  }
  .collapseIcon.collapsed {
    transform: rotate(-90deg);
  }
  .spacesViewHeader,
  .spacesViewRow {
    display: grid;
    gap: var(--spacing-3);
    align-items: center;
  }
  .spacesViewHeader {
    min-height: 2.5rem;
    padding: var(--spacing-1) var(--spacing-3);
    color: var(--theme-caption-color);
    font-size: 0.6875rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    background: var(--theme-comp-header-color);
    border-bottom: 1px solid var(--theme-divider-color);
    border-radius: var(--medium-BorderRadius) var(--medium-BorderRadius) 0 0;
  }
  .spacesViewGroup :global(.spacesViewTable) {
    overflow: hidden;
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--medium-BorderRadius);
  }
  .spacesViewRow {
    min-height: 3.5rem;
    padding: var(--spacing-2) var(--spacing-3);
  }
  .spacesViewGroup :global(.spacesViewItem + .spacesViewItem) {
    border-top: 1px solid var(--theme-divider-color);
  }
  .spacesViewGroup :global(.spacesViewItem:hover) {
    background: var(--theme-button-hovered);
  }
  .spacesViewGroup :global(.spacesViewItem:last-child) {
    border-radius: 0 0 var(--medium-BorderRadius) var(--medium-BorderRadius);
  }
  .spaceName {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .spaceTitle,
  .spaceType {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spaceTitle.emphasized {
    font-weight: 600;
  }
  .spaceType {
    color: var(--theme-caption-color);
    font-size: 0.8125rem;
  }
  .visibilityCell,
  .customCell {
    display: flex;
    align-items: center;
    min-width: 0;
  }
</style>
