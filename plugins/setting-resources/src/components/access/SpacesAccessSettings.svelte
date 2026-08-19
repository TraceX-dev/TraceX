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
    type Action,
    type ActiveFilter,
    FilterButton,
    type FilterCategory,
    IconCheck,
    IconClose,
    type InteractiveListActionContext,
    Label,
    Loading,
    Menu,
    Scroller,
    SearchInput,
    Toggle
  } from '@hcengineering/ui'
  import type { SpaceApplicationResolver } from '@hcengineering/workbench'
  import workbenchResources from '@hcengineering/workbench-resources/src/plugin'

  import setting from '../../plugin'
  import { isSpaceOperationPending } from '../../spaceAccessUtils'
  import SpacesView from './SpacesView.svelte'
  import type { SpacesViewColumn } from './spaces-view'

  const OTHER_APPLICATIONS = 'other'
  const SPACE_COLUMNS: SpacesViewColumn[] = [
    { id: 'name', label: core.string.Name, width: 'minmax(13rem, 1.6fr)' },
    { id: 'members', label: core.string.Members, width: '10rem' },
    { id: 'visibility', label: setting.string.Visibility, width: '6rem' },
    { id: 'user-autojoin', label: setting.string.User, width: '4rem' },
    { id: 'guest-autojoin', label: setting.string.Guest, width: '4rem' }
  ]

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

  function getOwnerEmployees(space: Space): Employee[] {
    return employees.filter(
      (employee) => employee.personUuid !== undefined && space.owners?.includes(employee.personUuid) === true
    )
  }

  function getOwnerName(space: Space): string {
    return getOwnerEmployees(space)
      .map((owner) => formatName(owner.name))
      .join(' ')
  }

  function getApplicationId(space: Space): string {
    return spaceApplicationResolver.resolve(space)?._id ?? OTHER_APPLICATIONS
  }

  function matchesOwnerFilter(space: Space, owner: string | undefined): boolean {
    if (owner === undefined) return true
    if (owner === 'unassigned') return getOwnerEmployees(space).length === 0
    return space.owners?.includes(owner as AccountUuid) === true
  }

  function matchesMemberFilter(space: Space, member: string | undefined): boolean {
    if (member === undefined) return true
    return space.members.includes(member as AccountUuid)
  }

  function getActiveFilter(filters: ActiveFilter[], categoryId: string): string | undefined {
    return filters.find((filter) => filter.categoryId === categoryId)?.optionId
  }

  function matchesBooleanFilter(filter: string | undefined, value: boolean): boolean {
    return filter === undefined || (filter === 'enabled' ? value : !value)
  }

  function handleFilterChange(event: CustomEvent<ActiveFilter[]>): void {
    activeFilters = event.detail
  }

  async function updateSelectedSpaces(
    selectedKeys: string[],
    target: 'users' | 'guests',
    value: boolean
  ): Promise<void> {
    const selectedKeysSet = new Set(selectedKeys)
    const spacesToUpdate = spaces.filter((space) => selectedKeysSet.has(space._id))
    await Promise.all(
      spacesToUpdate.map(async (space) => {
        if (target === 'users') await setAutoJoin(space, value)
        else await setGuestAutoJoin(space, value)
      })
    )
  }

  function createAutojoinActions(selectedKeys: string[], target: 'users' | 'guests'): Action[] {
    return [
      {
        label: setting.string.ConfigurationEnabled,
        icon: IconCheck,
        action: () => updateSelectedSpaces(selectedKeys, target, true).catch(handleError)
      },
      {
        label: setting.string.ConfigurationDisabled,
        icon: IconClose,
        action: () => updateSelectedSpaces(selectedKeys, target, false).catch(handleError)
      }
    ]
  }

  function getSpaceActions(_space: Space, context: InteractiveListActionContext): Action[] {
    return [
      {
        label: core.string.AutoJoin,
        component: Menu,
        props: { actions: createAutojoinActions(context.selectedKeys, 'users') },
        action: () => Promise.resolve()
      },
      {
        label: core.string.AutoJoinGuests,
        component: Menu,
        props: { actions: createAutojoinActions(context.selectedKeys, 'guests') },
        action: () => Promise.resolve()
      }
    ]
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
      id: 'member',
      label: setting.string.Member,
      options: employees
        .filter(
          (employee) =>
            employee.personUuid != null &&
            spaces.some((space) => space.members.includes(employee.personUuid as AccountUuid))
        )
        .map((employee) => ({
          id: employee.personUuid ?? '',
          label: setting.string.Member,
          text: formatName(employee.name)
        }))
        .sort((left, right) => left.text.localeCompare(right.text))
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
      const memberFilter = getActiveFilter(activeFilters, 'member')
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
        matchesMemberFilter(space, memberFilter) &&
        matchesVisibility &&
        matchesAutojoin &&
        matchesGuestAutojoin
      )
    })
    .sort((left, right) => left.name.localeCompare(right.name))
</script>

<Scroller align={'center'} padding={'var(--spacing-4)'}>
  <div class="spacesContent">
    <h2><Label label={setting.string.Spaces} /></h2>
    <p class="hint"><Label label={setting.string.AccessControlSpacesHint} /></p>
    <div class="tableToolbar">
      <SearchInput bind:value={search} width={'22rem'} placeholder={setting.string.SearchSpaces} />
      <FilterButton
        categories={filterCategories}
        {activeFilters}
        size={'small'}
        kind={'regular'}
        on:change={handleFilterChange}
      />
      {#if search.trim() !== '' || activeFilters.length > 0}
        <span class="tableCount">
          {visibleSpaces.length} / {spaces.length}
          <Label label={setting.string.Spaces} />
        </span>
      {/if}
    </div>
    {#if spacesLoading || employeesLoading}
      <Loading />
    {:else if visibleSpaces.length === 0}
      <div class="emptyState"><Label label={presentation.string.NoResults} /></div>
    {:else}
      <SpacesView
        spaces={visibleSpaces}
        {spaceApplicationResolver}
        columns={SPACE_COLUMNS}
        selectable
        bind:selectedKeys={selectedSpaces}
        getActions={getSpaceActions}
        {handleError}
      >
        <svelte:fragment slot="cell" let:space let:column>
          {#if column.id === 'members'}
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
          {:else if column.id === 'user-autojoin'}
            <div class="toggleCell" on:click|stopPropagation role="none">
              <Toggle
                size={'small'}
                showTooltip={{ label: core.string.AutoJoin }}
                on={space.autoJoin ?? false}
                disabled={isSpaceOperationPending(pendingSpaceOperations, space, 'autojoin')}
                on:change={(event) => setAutoJoin(space, event.detail).catch(handleError)}
              />
            </div>
          {:else if column.id === 'guest-autojoin'}
            <div class="toggleCell" on:click|stopPropagation role="none">
              <Toggle
                size={'small'}
                showTooltip={{ label: core.string.AutoJoinGuests }}
                on={(space.autoJoinForRoles ?? []).includes(AccountRole.Guest)}
                disabled={isSpaceOperationPending(pendingSpaceOperations, space, 'guest-autojoin')}
                on:change={(event) => setGuestAutoJoin(space, event.detail).catch(handleError)}
              />
            </div>
          {/if}
        </svelte:fragment>
      </SpacesView>
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
    gap: var(--spacing-2);
    margin-bottom: var(--spacing-4);
    color: var(--theme-caption-color);
  }
  .tableCount {
    white-space: nowrap;
    font-size: 0.75rem;
  }
  .emptyState {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 8rem;
    color: var(--theme-caption-color);
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
