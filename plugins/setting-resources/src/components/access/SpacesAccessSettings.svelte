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
  import { type Employee, formatName } from '@hcengineering/contact'
  import { AccountArrayEditor } from '@hcengineering/contact-resources'
  import contactResources from '@hcengineering/contact-resources/src/plugin'
  import core, { AccountRole, type AccountUuid, type Space } from '@hcengineering/core'
  import presentation from '@hcengineering/presentation'
  import {
    type ActiveFilter,
    Button,
    ButtonIcon,
    CheckBox,
    FilterButton,
    type FilterCategory,
    Icon,
    IconClose,
    Label,
    ListView,
    Loading,
    Scroller,
    SearchInput,
    StateTag,
    StateType,
    Toggle
  } from '@hcengineering/ui'
  import type { SpaceApplicationResolver } from '@hcengineering/workbench'
  import workbenchResources from '@hcengineering/workbench-resources/src/plugin'

  import setting from '../../plugin'
  import { getSpaceType, isSpaceOperationPending } from '../../spaceAccessUtils'

  const OTHER_APPLICATIONS = 'other'

  export let spaces: Space[]
  export let spaceApplicationResolver: SpaceApplicationResolver
  export let employees: Employee[]
  export let spacesLoading: boolean
  export let employeesLoading: boolean
  export let pendingSpaceOperations: Set<string>
  export let updateMembers: (space: Space, members: AccountUuid[]) => Promise<boolean>
  export let setAutoJoin: (space: Space, value: boolean) => Promise<void>
  export let setGuestAutoJoin: (space: Space, value: boolean) => Promise<void>
  export let handleError: (error: unknown) => void

  let search = ''
  let activeFilters: ActiveFilter[] = []
  let selectedSpaces = new Set<string>()

  function getOwnerEmployees (space: Space): Employee[] {
    return employees.filter(
      (employee) => employee.personUuid !== undefined && space.owners?.includes(employee.personUuid) === true
    )
  }

  function getOwnerName (space: Space): string {
    return getOwnerEmployees(space)
      .map((owner) => formatName(owner.name))
      .join(' ')
  }

  function getApplicationId (space: Space): string {
    return spaceApplicationResolver.resolve(space)?._id ?? OTHER_APPLICATIONS
  }

  function matchesOwnerFilter (space: Space, owner: string | undefined): boolean {
    if (owner === undefined) return true
    if (owner === 'unassigned') return getOwnerEmployees(space).length === 0
    return space.owners?.includes(owner as AccountUuid) === true
  }

  function getActiveFilter (filters: ActiveFilter[], categoryId: string): string | undefined {
    return filters.find((filter) => filter.categoryId === categoryId)?.optionId
  }

  function matchesBooleanFilter (filter: string | undefined, value: boolean): boolean {
    return filter === undefined || (filter === 'enabled' ? value : !value)
  }

  function handleFilterChange (event: CustomEvent<ActiveFilter[]>): void {
    activeFilters = event.detail
  }

  function toggleSpaceSelection (space: Space, selected: boolean): void {
    const next = new Set(selectedSpaces)
    if (selected) next.add(space._id)
    else next.delete(space._id)
    selectedSpaces = next
  }

  function toggleSpacesSelection (spacesToToggle: Space[], selected: boolean): void {
    const next = new Set(selectedSpaces)
    for (const space of spacesToToggle) {
      if (selected) next.add(space._id)
      else next.delete(space._id)
    }
    selectedSpaces = next
  }

  function areAllSpacesSelected (groupSpaces: Space[]): boolean {
    return groupSpaces.length > 0 && groupSpaces.every((space) => selectedSpaces.has(space._id))
  }

  function areSomeSpacesSelected (groupSpaces: Space[]): boolean {
    return groupSpaces.some((space) => selectedSpaces.has(space._id))
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

  $: allSpaceGroups = spaceApplicationResolver.group(spaces)
  $: filterCategories = [
    {
      id: 'application',
      label: workbenchResources.string.Application,
      options: [
        ...allSpaceGroups.flatMap((group) =>
          group.application !== undefined ? [{ id: group.application._id, label: group.application.label }] : []
        ),
        ...(allSpaceGroups.find((group) => group.application === undefined) !== undefined
          ? [{ id: OTHER_APPLICATIONS, label: setting.string.OtherSpaces }]
          : [])
      ]
    },
    {
      id: 'owner',
      label: setting.string.Owner,
      options: [
        ...employees
          .filter(
            (employee) =>
              employee.personUuid != null &&
              spaces.some((space) => space.owners?.includes(employee.personUuid as AccountUuid) === true)
          )
          .map((employee) => ({
            id: employee.personUuid ?? '',
            label: setting.string.Owner,
            text: formatName(employee.name)
          }))
          .sort((left, right) => left.text.localeCompare(right.text)),
        ...(spaces.some((space) => getOwnerEmployees(space).length === 0)
          ? [{ id: 'unassigned', label: contactResources.string.Unassigned }]
          : [])
      ]
    },
    {
      id: 'visibility',
      label: setting.string.Visibility,
      options: [
        { id: 'public', label: setting.string.Public },
        { id: 'private', label: core.string.Private }
      ]
    },
    {
      id: 'autojoin',
      label: core.string.AutoJoin,
      options: [
        { id: 'enabled', label: setting.string.ConfigurationEnabled },
        { id: 'disabled', label: setting.string.ConfigurationDisabled }
      ]
    },
    {
      id: 'guest-autojoin',
      label: core.string.AutoJoinGuests,
      options: [
        { id: 'enabled', label: setting.string.ConfigurationEnabled },
        { id: 'disabled', label: setting.string.ConfigurationDisabled }
      ]
    }
  ] satisfies FilterCategory[]
  $: visibleSpaces = spaces
    .filter((space) => {
      const query = search.trim().toLowerCase()
      const matchesSearch =
        query === '' || space.name.toLowerCase().includes(query) || getOwnerName(space).toLowerCase().includes(query)
      const applicationFilter = getActiveFilter(activeFilters, 'application')
      const ownerFilter = getActiveFilter(activeFilters, 'owner')
      const visibilityFilter = getActiveFilter(activeFilters, 'visibility')
      const autojoinFilter = getActiveFilter(activeFilters, 'autojoin')
      const guestAutojoinFilter = getActiveFilter(activeFilters, 'guest-autojoin')
      const matchesApplication = applicationFilter === undefined || getApplicationId(space) === applicationFilter
      const isPrivate = space.private ?? false
      const matchesVisibility =
        visibilityFilter === undefined || (visibilityFilter === 'private' ? isPrivate : !isPrivate)
      const matchesAutojoin = matchesBooleanFilter(autojoinFilter, space.autoJoin ?? false)
      const matchesGuestAutojoin = matchesBooleanFilter(
        guestAutojoinFilter,
        (space.autoJoinForRoles ?? []).includes(AccountRole.Guest)
      )
      return (
        matchesSearch &&
        matchesApplication &&
        matchesOwnerFilter(space, ownerFilter) &&
        matchesVisibility &&
        matchesAutojoin &&
        matchesGuestAutojoin
      )
    })
    .sort((left, right) => left.name.localeCompare(right.name))
  $: visibleSpaceGroups = spaceApplicationResolver.group(visibleSpaces)
  $: selectedSpacesPending = spaces.some(
    (space) => selectedSpaces.has(space._id) && isSpaceOperationPending(pendingSpaceOperations, space)
  )
</script>

<Scroller align={'center'} padding={'var(--spacing-4)'}>
  <div class="spacesContent">
    <h2><Label label={setting.string.Spaces} /></h2>
    <p class="hint"><Label label={setting.string.AccessControlSpacesHint} /></p>
    <div class="tableToolbar">
      <SearchInput bind:value={search} width={'18rem'} placeholder={setting.string.SearchSpaces} />
      <FilterButton
        categories={filterCategories}
        {activeFilters}
        size={'small'}
        kind={'regular'}
        on:change={handleFilterChange}
      />
      <span class="tableCount">
        {#if search.trim() !== '' || activeFilters.length > 0}
          {visibleSpaces.length} /
        {/if}{spaces.length}
        <Label label={setting.string.Spaces} />
      </span>
    </div>
    {#if selectedSpaces.size > 0}
      <div class="bulkActions">
        <strong>{selectedSpaces.size} <Label label={setting.string.Spaces} /></strong>
        <div class="bulkActionGroup">
          <span><Label label={setting.string.User} /></span>
          <Button
            label={setting.string.ConfigurationEnabled}
            kind={'ghost'}
            size={'small'}
            disabled={selectedSpacesPending}
            on:click={() => updateSelectedSpaces('users', true).catch(handleError)}
          />
          <Button
            label={setting.string.ConfigurationDisabled}
            kind={'ghost'}
            size={'small'}
            disabled={selectedSpacesPending}
            on:click={() => updateSelectedSpaces('users', false).catch(handleError)}
          />
        </div>
        <div class="bulkActionGroup">
          <span><Label label={setting.string.Guest} /></span>
          <Button
            label={setting.string.ConfigurationEnabled}
            kind={'ghost'}
            size={'small'}
            disabled={selectedSpacesPending}
            on:click={() => updateSelectedSpaces('guests', true).catch(handleError)}
          />
          <Button
            label={setting.string.ConfigurationDisabled}
            kind={'ghost'}
            size={'small'}
            disabled={selectedSpacesPending}
            on:click={() => updateSelectedSpaces('guests', false).catch(handleError)}
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
    {#if spacesLoading || employeesLoading}
      <Loading />
    {:else if visibleSpaces.length === 0}
      <div class="emptyState"><Label label={presentation.string.NoResults} /></div>
    {:else}
      <div class="applicationGroups">
        <div class="spaceListHeader">
          <span />
          <span><Label label={core.string.Name} /></span>
          <span><Label label={core.string.Members} /></span>
          <span><Label label={setting.string.User} /></span>
          <span><Label label={setting.string.Guest} /></span>
        </div>
        {#each visibleSpaceGroups as group (group.application?._id ?? OTHER_APPLICATIONS)}
          <section class="applicationGroup">
            <h3>
              <span class="applicationTitle">
                {#if group.application !== undefined}
                  <Icon icon={group.application.icon} size={'small'} />
                  <Label label={group.application.label} />
                {:else}
                  <Label label={setting.string.OtherSpaces} />
                {/if}
                <span>{group.spaces.length}</span>
              </span>
              <CheckBox
                checked={areAllSpacesSelected(group.spaces)}
                symbol={areSomeSpacesSelected(group.spaces) && !areAllSpacesSelected(group.spaces) ? 'minus' : 'check'}
                on:value={(event) => {
                  toggleSpacesSelection(group.spaces, event.detail)
                }}
              />
            </h3>
            <div class="spaceList">
              <ListView
                items={group.spaces}
                count={group.spaces.length}
                selection={-1}
                getKey={(index) => group.spaces[index]._id}
                updateOnMouse={false}
                noScroll
                kind={'full-size'}
                addClass={'spaceListItem'}
              >
                <svelte:fragment slot="item" let:item={index}>
                  {@const space = group.spaces[index]}
                  <div class="spaceListRow">
                    <CheckBox
                      checked={selectedSpaces.has(space._id)}
                      on:value={(event) => {
                        toggleSpaceSelection(space, event.detail)
                      }}
                    />
                    <div class="spaceName">
                      <strong>{space.name}</strong>
                      <div class="spaceMeta">
                        <span>{getSpaceType(space)}</span>
                        <StateTag
                          type={space.private === true ? StateType.Ghost : StateType.Positive}
                          label={space.private === true ? core.string.Private : setting.string.Public}
                        />
                      </div>
                    </div>
                    <div class="interactiveCell" on:click|stopPropagation role="none">
                      <AccountArrayEditor
                        value={space.members}
                        label={core.string.Members}
                        kind={'link'}
                        size={'small'}
                        readonly={isSpaceOperationPending(pendingSpaceOperations, space, 'members')}
                        onChange={(refs) => {
                          updateMembers(space, refs).catch(handleError)
                        }}
                      />
                    </div>
                    <div class="toggleCell" on:click|stopPropagation role="none">
                      <Toggle
                        size={'small'}
                        showTooltip={{ label: core.string.AutoJoin }}
                        on={space.autoJoin ?? false}
                        disabled={isSpaceOperationPending(pendingSpaceOperations, space, 'autojoin')}
                        on:change={(event) => setAutoJoin(space, event.detail).catch(handleError)}
                      />
                    </div>
                    <div class="toggleCell" on:click|stopPropagation role="none">
                      <Toggle
                        size={'small'}
                        showTooltip={{ label: core.string.AutoJoinGuests }}
                        on={(space.autoJoinForRoles ?? []).includes(AccountRole.Guest)}
                        disabled={isSpaceOperationPending(pendingSpaceOperations, space, 'guest-autojoin')}
                        on:change={(event) => setGuestAutoJoin(space, event.detail).catch(handleError)}
                      />
                    </div>
                  </div>
                </svelte:fragment>
              </ListView>
            </div>
          </section>
        {/each}
      </div>
    {/if}
  </div>
</Scroller>

<style lang="scss">
  .spacesContent {
    width: min(100%, 76rem);
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
  .bulkActionGroup {
    display: flex;
    align-items: center;
    gap: var(--spacing-1);
  }
  .bulkActionGroup > span {
    font-size: 0.75rem;
    white-space: nowrap;
  }
  .emptyState {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 8rem;
    color: var(--theme-caption-color);
  }
  .applicationGroups {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-4);
  }
  .spaceListHeader,
  .spaceListRow {
    display: grid;
    grid-template-columns: 2rem minmax(13rem, 1.6fr) 10rem 4rem 4rem;
    gap: var(--spacing-3);
    align-items: center;
    min-width: 37rem;
  }
  .spaceListHeader {
    padding: var(--spacing-2) var(--spacing-3);
    color: var(--theme-caption-color);
    font-size: 0.6875rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .spaceList {
    min-width: 37rem;
    overflow: hidden;
    border-top: 1px solid var(--theme-divider-color);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .spaceListRow {
    min-height: 3.5rem;
    padding: var(--spacing-2) var(--spacing-3);
  }
  .spaceList :global(.spaceListItem + .spaceListItem) {
    border-top: 1px solid var(--theme-divider-color);
  }
  .spaceList :global(.spaceListItem:hover) {
    background: var(--theme-button-hovered);
  }
  .applicationGroup h3 {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-2);
    margin: 0 0 var(--spacing-2);
    font-size: 0.875rem;
  }
  .applicationTitle {
    display: flex;
    align-items: center;
    gap: var(--spacing-2);
  }
  .applicationTitle > span:last-child {
    color: var(--theme-caption-color);
    font-size: 0.75rem;
    font-weight: 500;
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
  .spaceMeta {
    display: flex;
    align-items: center;
    gap: var(--spacing-2);
    min-width: 0;
    color: var(--theme-caption-color);
    font-size: 0.8125rem;
  }
  .spaceMeta > span:first-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .interactiveCell {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .toggleCell {
    display: flex;
    justify-content: flex-start;
    align-items: center;
  }
</style>
