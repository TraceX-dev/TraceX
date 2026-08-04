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
  import core, { AccountRole, type Space } from '@hcengineering/core'
  import presentation from '@hcengineering/presentation'
  import {
    Button,
    ButtonIcon,
    CheckBox,
    DataTable,
    type DropdownIntlItem,
    DropdownLabelsIntl,
    IconClose,
    Label,
    Loading,
    Scroller,
    SearchInput,
    Toggle
  } from '@hcengineering/ui'

  import setting from '../../plugin'
  import { getSpaceType, isSpaceOperationPending } from '../../spaceAccessUtils'

  type BooleanFilter = 'all' | 'enabled' | 'disabled'

  const BOOLEAN_FILTER_ITEMS: DropdownIntlItem[] = [
    { id: 'all', label: setting.string.AllIntegrations },
    { id: 'enabled', label: setting.string.ConfigurationEnabled },
    { id: 'disabled', label: setting.string.ConfigurationDisabled }
  ]

  export let spaces: Space[]
  export let spacesLoading: boolean
  export let pendingSpaceOperations: Set<string>
  export let setAutoJoin: (space: Space, value: boolean) => Promise<void>
  export let setGuestAutoJoin: (space: Space, value: boolean) => Promise<void>
  export let handleError: (error: unknown) => void

  let search = ''
  let autojoinFilter: BooleanFilter = 'all'
  let guestAutojoinFilter: BooleanFilter = 'all'
  let selectedSpaces = new Set<string>()

  function matchesBooleanFilter (filter: BooleanFilter, value: boolean): boolean {
    return filter === 'all' || (filter === 'enabled' ? value : !value)
  }

  function updateAutojoinFilter (event: CustomEvent<DropdownIntlItem['id']>): void {
    autojoinFilter = event.detail as BooleanFilter
  }

  function updateGuestAutojoinFilter (event: CustomEvent<DropdownIntlItem['id']>): void {
    guestAutojoinFilter = event.detail as BooleanFilter
  }

  function toggleSpaceSelection (space: Space, selected: boolean): void {
    const next = new Set(selectedSpaces)
    if (selected) next.add(space._id)
    else next.delete(space._id)
    selectedSpaces = next
  }

  function toggleAllVisibleSpaces (visibleSpaces: Space[], selected: boolean): void {
    const next = new Set(selectedSpaces)
    for (const space of visibleSpaces) {
      if (selected) next.add(space._id)
      else next.delete(space._id)
    }
    selectedSpaces = next
  }

  async function updateSelectedSpaces (target: 'users' | 'guests', value: boolean): Promise<void> {
    const spacesToUpdate = spaces.filter((space) => selectedSpaces.has(space._id))
    await Promise.all(
      spacesToUpdate.map(async (space) => {
        if (target === 'users') await setAutoJoin(space, value)
        else await setGuestAutoJoin(space, value)
      })
    )
  }

  $: visibleSpaces = spaces.filter((space) => {
    const query = search.trim().toLowerCase()
    return (
      (query === '' || space.name.toLowerCase().includes(query)) &&
      matchesBooleanFilter(autojoinFilter, space.autoJoin ?? false) &&
      matchesBooleanFilter(guestAutojoinFilter, (space.autoJoinForRoles ?? []).includes(AccountRole.Guest))
    )
  })
  $: allVisibleSpacesSelected =
    visibleSpaces.length > 0 && visibleSpaces.every((space) => selectedSpaces.has(space._id))
  $: someVisibleSpacesSelected = visibleSpaces.some((space) => selectedSpaces.has(space._id))
  $: selectedSpacesPending = spaces.some(
    (space) => selectedSpaces.has(space._id) && isSpaceOperationPending(pendingSpaceOperations, space)
  )
</script>

<Scroller align={'center'} padding={'var(--spacing-4)'}>
  <div class="spacesContent">
    <h2><Label label={setting.string.Autojoin} /></h2>
    <p class="hint"><Label label={setting.string.AutojoinHint} /></p>
    <div class="tableToolbar">
      <SearchInput bind:value={search} width={'18rem'} placeholder={setting.string.SearchSpaces} />
      <div class="filterControl">
        <span><Label label={core.string.AutoJoin} /></span>
        <DropdownLabelsIntl
          label={core.string.AutoJoin}
          kind={'no-border'}
          size={'small'}
          items={BOOLEAN_FILTER_ITEMS}
          selected={autojoinFilter}
          on:selected={updateAutojoinFilter}
        />
      </div>
      <div class="filterControl">
        <span><Label label={core.string.AutoJoinGuests} /></span>
        <DropdownLabelsIntl
          label={core.string.AutoJoinGuests}
          kind={'no-border'}
          size={'small'}
          items={BOOLEAN_FILTER_ITEMS}
          selected={guestAutojoinFilter}
          on:selected={updateGuestAutojoinFilter}
        />
      </div>
      <span class="tableCount">
        {#if search.trim() !== '' || autojoinFilter !== 'all' || guestAutojoinFilter !== 'all'}
          {visibleSpaces.length} /
        {/if}
        {spaces.length}
        <Label label={setting.string.Spaces} />
      </span>
    </div>
    {#if selectedSpaces.size > 0}
      <div class="bulkActions">
        <strong>{selectedSpaces.size} <Label label={setting.string.Spaces} /></strong>
        <div class="bulkActionGroup">
          <span><Label label={core.string.AutoJoin} /></span>
          <Button
            label={setting.string.ConfigurationEnabled}
            kind={'ghost'}
            size={'small'}
            disabled={selectedSpacesPending}
            on:click={() => {
              updateSelectedSpaces('users', true).catch(handleError)
            }}
          />
          <Button
            label={setting.string.ConfigurationDisabled}
            kind={'ghost'}
            size={'small'}
            disabled={selectedSpacesPending}
            on:click={() => {
              updateSelectedSpaces('users', false).catch(handleError)
            }}
          />
        </div>
        <div class="bulkActionGroup">
          <span><Label label={core.string.AutoJoinGuests} /></span>
          <Button
            label={setting.string.ConfigurationEnabled}
            kind={'ghost'}
            size={'small'}
            disabled={selectedSpacesPending}
            on:click={() => {
              updateSelectedSpaces('guests', true).catch(handleError)
            }}
          />
          <Button
            label={setting.string.ConfigurationDisabled}
            kind={'ghost'}
            size={'small'}
            disabled={selectedSpacesPending}
            on:click={() => {
              updateSelectedSpaces('guests', false).catch(handleError)
            }}
          />
        </div>
        <ButtonIcon
          icon={IconClose}
          size={'min'}
          kind={'tertiary'}
          tooltip={{ label: presentation.string.Close }}
          disabled={selectedSpacesPending}
          on:click={() => {
            selectedSpaces = new Set()
          }}
        />
      </div>
    {/if}
    {#if spacesLoading}
      <Loading />
    {:else if visibleSpaces.length === 0}
      <div class="emptyState"><Label label={presentation.string.NoResults} /></div>
    {:else}
      <DataTable columns="2rem minmax(15rem, 1.6fr) 10rem 10rem" minWidth="40rem">
        <svelte:fragment slot="header">
          <CheckBox
            checked={allVisibleSpacesSelected}
            symbol={someVisibleSpacesSelected && !allVisibleSpacesSelected ? 'minus' : 'check'}
            on:value={(event) => {
              toggleAllVisibleSpaces(visibleSpaces, event.detail)
            }}
          />
          <span><Label label={core.string.Name} /></span>
          <span><Label label={core.string.AutoJoin} /></span>
          <span><Label label={core.string.AutoJoinGuests} /></span>
        </svelte:fragment>
        {#each visibleSpaces as space (space._id)}
          <div class="uiDataTable-row">
            <CheckBox
              checked={selectedSpaces.has(space._id)}
              on:value={(event) => {
                toggleSpaceSelection(space, event.detail)
              }}
            />
            <div class="spaceName">
              <strong>{space.name}</strong>
              <span>{getSpaceType(space)}</span>
            </div>
            <div class="interactiveCell" on:click|stopPropagation role="none">
              <Toggle
                on={space.autoJoin ?? false}
                disabled={isSpaceOperationPending(pendingSpaceOperations, space, 'autojoin')}
                on:change={(event) => {
                  setAutoJoin(space, event.detail).catch(handleError)
                }}
              />
            </div>
            <div class="interactiveCell" on:click|stopPropagation role="none">
              <Toggle
                on={(space.autoJoinForRoles ?? []).includes(AccountRole.Guest)}
                disabled={isSpaceOperationPending(pendingSpaceOperations, space, 'guest-autojoin')}
                on:change={(event) => {
                  setGuestAutoJoin(space, event.detail).catch(handleError)
                }}
              />
            </div>
          </div>
        {/each}
      </DataTable>
    {/if}
  </div>
</Scroller>

<style lang="scss">
  .spacesContent {
    width: min(100%, 72rem);
  }
  h2 {
    margin: 0 0 var(--spacing-1);
  }
  .hint {
    margin: 0 0 var(--spacing-4);
    color: var(--theme-caption-color);
  }
  .tableToolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--spacing-3);
    margin-bottom: var(--spacing-3);
    color: var(--theme-caption-color);
  }
  .tableCount {
    margin-left: auto;
    white-space: nowrap;
  }
  .filterControl,
  .bulkActionGroup {
    display: flex;
    align-items: center;
    gap: var(--spacing-1);
  }
  .filterControl > span,
  .bulkActionGroup > span {
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .bulkActions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--spacing-3);
    margin-bottom: var(--spacing-3);
    padding: var(--spacing-2) var(--spacing-3);
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--border-radius-medium);
    background: var(--theme-button-hovered);
  }
  .bulkActions > strong {
    margin-right: auto;
    white-space: nowrap;
  }
  .emptyState {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 8rem;
    color: var(--theme-caption-color);
  }
  .spaceName {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .spaceName strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spaceName span {
    color: var(--theme-caption-color);
    font-size: 0.8125rem;
  }
  .interactiveCell {
    display: flex;
    align-items: center;
    min-width: 0;
  }
</style>
