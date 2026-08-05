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
  import { EmployeePresenter } from '@hcengineering/contact-resources'
  import core, {
    type AccountUuid,
    type Space,
    type WorkspaceMemberInfo,
    AccountRole,
    getCurrentAccount,
    hasAccountRole
  } from '@hcengineering/core'
  import presentation from '@hcengineering/presentation'
  import {
    type Action,
    type ActiveFilter,
    Button,
    FilterButton,
    type FilterCategory,
    type FilterOption,
    IconClose,
    Label,
    ListView,
    Loading,
    Scroller,
    SearchInput
  } from '@hcengineering/ui'
  import type { SpaceApplicationResolver } from '@hcengineering/workbench'
  import workbenchResources from '@hcengineering/workbench-resources/src/plugin'

  import {
    WORKSPACE_ROLES,
    canChangeWorkspaceRole,
    canRevokeSpaceAccess,
    getAvailableSpacesForMember,
    getAssignableWorkspaceRoles,
    getMemberSpaceAvailability,
    getWorkspaceMemberRole
  } from '../../accessPermissions'
  import setting from '../../plugin'
  import { isSpaceOperationPending } from '../../spaceAccessUtils'
  import SpacesView from './SpacesView.svelte'
  import type { SpacesViewColumn } from './spaces-view'
  import UserRoleSelect from '../UserRoleSelect.svelte'

  interface RevokedAccess {
    space: Space
    person: AccountUuid
    previousMembers: AccountUuid[]
    previousOwners: AccountUuid[] | undefined
  }

  const currentAccount = getCurrentAccount()
  const hasWorkspaceOwnerAccess = hasAccountRole(currentAccount, AccountRole.Owner)
  const ROLE_FILTER_LABELS: Partial<Record<AccountRole, FilterOption['label']>> = {
    [AccountRole.ReadOnlyGuest]: setting.string.ReadonlyGuest,
    [AccountRole.Guest]: setting.string.Guest,
    [AccountRole.User]: setting.string.User,
    [AccountRole.Maintainer]: setting.string.Maintainer,
    [AccountRole.Owner]: setting.string.Owner
  }
  const MEMBER_FILTER_CATEGORIES: FilterCategory[] = [
    {
      id: 'role',
      label: setting.string.Role,
      options: WORKSPACE_ROLES.map((role) => ({
        id: role,
        label: ROLE_FILTER_LABELS[role] ?? setting.string.User
      }))
    }
  ]
  const MEMBER_SPACE_COLUMNS: SpacesViewColumn[] = [
    { id: 'name', label: core.string.Name, width: 'minmax(10rem, 1fr)' },
    { id: 'visibility', label: setting.string.Visibility, width: '6rem' }
  ]

  export let spaces: Space[]
  export let spaceApplicationResolver: SpaceApplicationResolver
  export let employees: Employee[]
  export let workspaceMembers: WorkspaceMemberInfo[]
  export let employeesLoading: boolean
  export let membersLoading: boolean
  export let pendingSpaceOperations: Set<string>
  export let pendingRoleUpdates: Set<AccountUuid>
  export let changeRole: (personUuid: AccountUuid, role: AccountRole) => Promise<void>
  export let updateMembers: (space: Space, members: AccountUuid[], owners?: AccountUuid[]) => Promise<boolean>
  export let handleError: (error: unknown) => void

  let search = ''
  let memberFilters: ActiveFilter[] = []
  let memberSpaceSearch = ''
  let memberSpaceFilters: ActiveFilter[] = []
  let revokedAccess: RevokedAccess | undefined
  let selectedPerson: AccountUuid | undefined
  let selectedMemberSpaces = new Set<string>()

  function getActiveFilter (filters: ActiveFilter[], categoryId: string): string | undefined {
    return filters.find((filter) => filter.categoryId === categoryId)?.optionId
  }

  function updateMemberFilters (event: CustomEvent<ActiveFilter[]>): void {
    memberFilters = event.detail
  }

  function updateMemberSpaceFilters (event: CustomEvent<ActiveFilter[]>): void {
    memberSpaceFilters = event.detail
  }

  function selectUser (personUuid: AccountUuid): void {
    selectedPerson = selectedPerson === personUuid ? undefined : personUuid
    memberSpaceSearch = ''
    memberSpaceFilters = []
    selectedMemberSpaces = new Set<string>()
  }

  function handleMemberKeydown (event: KeyboardEvent, personUuid: AccountUuid): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectUser(personUuid)
  }

  async function revokeSpaceAccess (space: Space, person: AccountUuid): Promise<void> {
    if (!canRevokeSpaceAccess(space.owners, person, hasWorkspaceOwnerAccess)) return

    const previousMembers = [...space.members]
    const previousOwners = space.owners !== undefined ? [...space.owners] : undefined
    const updated = await updateMembers(
      space,
      previousMembers.filter((member) => member !== person),
      previousOwners?.filter((owner) => owner !== person)
    )
    if (updated) revokedAccess = { space, person, previousMembers, previousOwners }
  }

  async function undoRevokeSpaceAccess (): Promise<void> {
    if (revokedAccess === undefined) return
    const access = revokedAccess
    const updated = await updateMembers(access.space, access.previousMembers, access.previousOwners)
    if (updated) revokedAccess = undefined
  }

  function getMemberSpaceActions (space: Space): Action[] {
    if (selectedPerson === undefined) return []
    const role = getWorkspaceMemberRole(workspaceMembers, selectedPerson)
    if (getMemberSpaceAvailability(space, selectedPerson, role) !== 'member') return []
    if (!canRevokeSpaceAccess(space.owners, selectedPerson, hasWorkspaceOwnerAccess)) return []
    if (isSpaceOperationPending(pendingSpaceOperations, space, 'members')) return []

    const person = selectedPerson
    return [
      {
        label: setting.string.RemoveMemberFromSpace,
        icon: IconClose,
        action: () => revokeSpaceAccess(space, person).catch(handleError)
      }
    ]
  }

  $: selectedEmployee = employees.find((employee) => employee.personUuid === selectedPerson)
  $: selectedRole = selectedPerson !== undefined ? getWorkspaceMemberRole(workspaceMembers, selectedPerson) : undefined
  $: availableSelectedSpaces = getAvailableSpacesForMember(spaces, selectedPerson, selectedRole)
  $: availableSelectedSpaceGroups = spaceApplicationResolver.group(availableSelectedSpaces)
  $: memberSpaceFilterCategories = [
    {
      id: 'application',
      label: workbenchResources.string.Application,
      options: [
        ...availableSelectedSpaceGroups.flatMap((group) =>
          group.application !== undefined ? [{ id: group.application._id, label: group.application.label }] : []
        ),
        ...(availableSelectedSpaceGroups.find((group) => group.application === undefined) !== undefined
          ? [{ id: 'other', label: setting.string.OtherSpaces }]
          : [])
      ]
    }
  ] satisfies FilterCategory[]
  $: visibleSelectedSpaces = availableSelectedSpaces.filter((space) => {
    const matchesSearch = space.name.toLowerCase().includes(memberSpaceSearch.trim().toLowerCase())
    const applicationId = spaceApplicationResolver.resolve(space)?._id ?? 'other'
    const applicationFilter = getActiveFilter(memberSpaceFilters, 'application')
    return matchesSearch && (applicationFilter === undefined || applicationFilter === applicationId)
  })
  $: selectedMemberSpaceKeys = new Set(
    visibleSelectedSpaces
      .filter((space) => getMemberSpaceAvailability(space, selectedPerson, selectedRole) === 'member')
      .map((space) => space._id)
  )
  $: visibleEmployees = employees.filter(
    (employee) =>
      employee.active &&
      employee.personUuid !== undefined &&
      getWorkspaceMemberRole(workspaceMembers, employee.personUuid) !== undefined &&
      formatName(employee.name).toLowerCase().includes(search.toLowerCase()) &&
      (getActiveFilter(memberFilters, 'role') === undefined ||
        getWorkspaceMemberRole(workspaceMembers, employee.personUuid) === getActiveFilter(memberFilters, 'role'))
  )
  $: activeEmployeesCount = employees.filter(
    (employee) =>
      employee.active &&
      employee.personUuid !== undefined &&
      getWorkspaceMemberRole(workspaceMembers, employee.personUuid) !== undefined
  ).length
  $: selectedEmployeeIndex = visibleEmployees.findIndex((employee) => employee.personUuid === selectedPerson)
</script>

<div class="usersLayout">
  <div class="usersList">
    <div class="memberToolbar">
      <SearchInput bind:value={search} placeholder={setting.string.SearchMembers} />
      <FilterButton
        categories={MEMBER_FILTER_CATEGORIES}
        activeFilters={memberFilters}
        size={'small'}
        kind={'regular'}
        on:change={updateMemberFilters}
      />
      {#if search.trim() !== '' || memberFilters.length > 0}
        <span>{visibleEmployees.length} / {activeEmployeesCount}</span>
      {/if}
    </div>
    <Scroller padding={'0'}>
      {#if membersLoading || employeesLoading}
        <Loading />
      {:else if visibleEmployees.length === 0}
        <div class="emptyState"><Label label={presentation.string.NoResults} /></div>
      {:else}
        <div class="memberList">
          <ListView
            items={visibleEmployees}
            count={visibleEmployees.length}
            selection={selectedEmployeeIndex}
            getKey={(index) => visibleEmployees[index]._id}
            updateOnMouse={false}
            noScroll
            kind={'full-size'}
            addClass={'memberListItem'}
          >
            <svelte:fragment slot="item" let:item={index}>
              {@const employee = visibleEmployees[index]}
              {@const personUuid = employee.personUuid}
              {@const role =
                personUuid !== undefined ? getWorkspaceMemberRole(workspaceMembers, personUuid) : undefined}
              {#if personUuid !== undefined && role !== undefined}
                <div
                  class="memberListRow"
                  role="button"
                  tabindex="0"
                  aria-pressed={selectedPerson === personUuid}
                  on:click={() => {
                    selectUser(personUuid)
                  }}
                  on:keydown={(event) => {
                    handleMemberKeydown(event, personUuid)
                  }}
                >
                  <div class="memberCell">
                    <EmployeePresenter value={employee} avatarSize={'x-small'} disabled showPopup={false} />
                  </div>
                  <div class="roleEditor" on:click|stopPropagation on:keydown|stopPropagation role="none">
                    <UserRoleSelect
                      disabled={!canChangeWorkspaceRole(currentAccount, personUuid, role, workspaceMembers) ||
                        pendingRoleUpdates.has(personUuid)}
                      kind={'no-border'}
                      size={'small'}
                      minWidth={'7rem'}
                      roles={getAssignableWorkspaceRoles(currentAccount, role)}
                      securityFilter={false}
                      selected={role}
                      on:selected={(event) => {
                        changeRole(personUuid, event.detail).catch(handleError)
                      }}
                    />
                  </div>
                </div>
              {/if}
            </svelte:fragment>
          </ListView>
        </div>
      {/if}
    </Scroller>
  </div>
  <aside class="userSpaces">
    {#if selectedEmployee !== undefined}
      <div class="userSpacesSummary">
        <div class="userSpacesTitle">
          <strong>
            <Label label={setting.string.MemberSpacesTitle} params={{ name: formatName(selectedEmployee.name) }} />
          </strong>
          <span>{availableSelectedSpaces.length}</span>
        </div>
        <div class="memberSpacesToolbar">
          <SearchInput bind:value={memberSpaceSearch} width={'100%'} placeholder={setting.string.SearchSpaces} />
          <FilterButton
            categories={memberSpaceFilterCategories}
            activeFilters={memberSpaceFilters}
            size={'small'}
            kind={'regular'}
            showLabel={false}
            on:change={updateMemberSpaceFilters}
          />
        </div>
        {#if revokedAccess !== undefined && revokedAccess.person === selectedPerson}
          <div class="undoBanner">
            <Label label={setting.string.Saved} />
            <Button
              label={presentation.string.Undo}
              kind={'link'}
              size={'small'}
              disabled={isSpaceOperationPending(pendingSpaceOperations, revokedAccess.space, 'members')}
              on:click={() => {
                undoRevokeSpaceAccess().catch(handleError)
              }}
            />
          </div>
        {/if}
      </div>
      <div class="userSpacesContent">
        {#if availableSelectedSpaces.length === 0}
          <p class="hint placeholder"><Label label={setting.string.NoSpaces} /></p>
        {:else if visibleSelectedSpaces.length === 0}
          <div class="emptyState"><Label label={presentation.string.NoResults} /></div>
        {:else}
          <Scroller padding={'var(--spacing-3)'}>
            <SpacesView
              spaces={visibleSelectedSpaces}
              {spaceApplicationResolver}
              columns={MEMBER_SPACE_COLUMNS}
              minWidth={'18rem'}
              bind:selectedKeys={selectedMemberSpaces}
              emphasizedKeys={selectedMemberSpaceKeys}
              getActions={getMemberSpaceActions}
              {handleError}
            />
          </Scroller>
        {/if}
      </div>
    {:else}
      <div class="userSpacesPlaceholder">
        <p class="hint"><Label label={setting.string.SelectMemberToViewSpaces} /></p>
      </div>
    {/if}
  </aside>
</div>

<style lang="scss">
  .usersLayout {
    display: flex;
    flex: 1;
    height: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .usersList {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--spacing-3);
    min-width: 24rem;
    min-height: 0;
    padding: var(--spacing-3);
    overflow: hidden;
  }
  .memberToolbar {
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) auto auto;
    align-items: center;
    gap: var(--spacing-2);
    color: var(--theme-caption-color);
  }
  .memberListRow {
    display: grid;
    grid-template-columns: minmax(12rem, 1fr) minmax(7rem, 9rem);
    gap: var(--spacing-3);
    align-items: center;
    min-width: 22rem;
  }
  .memberList {
    min-width: 22rem;
    overflow: hidden;
  }
  .memberListRow {
    min-height: 3rem;
    padding: var(--spacing-2) var(--spacing-3);
    cursor: pointer;
  }
  .memberList :global(.memberListItem:hover:not(.selection)) {
    background: var(--theme-button-hovered);
  }
  .memberCell {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .roleEditor {
    flex: 0 0 auto;
  }
  .emptyState {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 8rem;
    color: var(--theme-caption-color);
  }
  .hint {
    margin: 0 0 var(--spacing-4);
    color: var(--theme-caption-color);
  }
  .hint.placeholder {
    margin-top: var(--spacing-4);
  }
  .userSpaces {
    display: flex;
    flex: 0 0 24rem;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--theme-divider-color);
    background: var(--theme-bg-accent-color);
    overflow: hidden;
  }
  .userSpacesSummary {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    gap: var(--spacing-3);
    padding: var(--spacing-4);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .userSpacesTitle {
    display: flex;
    align-items: center;
    gap: var(--spacing-2);
  }
  .userSpacesTitle > span {
    color: var(--theme-caption-color);
    font-size: 0.8125rem;
    font-weight: 500;
  }
  .memberSpacesToolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--spacing-2);
  }
  .userSpacesContent {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  .userSpacesPlaceholder {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    padding: var(--spacing-5);
    text-align: center;
  }
  .userSpacesPlaceholder .hint {
    margin: 0;
  }
  .undoBanner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--spacing-2);
    padding: var(--spacing-1) var(--spacing-2);
    border-radius: var(--border-radius-medium);
    background: var(--theme-button-hovered);
    color: var(--theme-caption-color);
  }
  @container (max-width: 54rem) {
    .usersLayout {
      flex-direction: column;
    }
    .usersList {
      flex-basis: 50%;
      width: 100%;
      min-width: 0;
    }
    .userSpaces {
      flex: 0 0 50%;
      width: 100%;
      height: 50%;
      border-top: 1px solid var(--theme-divider-color);
      border-left: 0;
    }
    .userSpacesSummary {
      padding: var(--spacing-3);
    }
  }
</style>
