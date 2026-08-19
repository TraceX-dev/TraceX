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
  import { type AccountUuid, type WorkspaceMemberInfo, AccountRole, getCurrentAccount } from '@hcengineering/core'
  import presentation from '@hcengineering/presentation'
  import {
    type ActiveFilter,
    FilterButton,
    type FilterCategory,
    type FilterOption,
    Label,
    ListView,
    Loading,
    Scroller,
    SearchInput
  } from '@hcengineering/ui'

  import {
    WORKSPACE_ROLES,
    canChangeWorkspaceRole,
    getAssignableWorkspaceRoles,
    getWorkspaceMemberRole
  } from '../../accessPermissions'
  import setting from '../../plugin'
  import UserRoleSelect from '../UserRoleSelect.svelte'

  const currentAccount = getCurrentAccount()
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

  export let employees: Employee[]
  export let workspaceMembers: WorkspaceMemberInfo[]
  export let employeesLoading: boolean
  export let membersLoading: boolean
  export let pendingRoleUpdates: Set<AccountUuid>
  export let changeRole: (personUuid: AccountUuid, role: AccountRole) => Promise<void>
  export let handleError: (error: unknown) => void

  let search = ''
  let memberFilters: ActiveFilter[] = []

  function getActiveFilter(filters: ActiveFilter[], categoryId: string): string | undefined {
    return filters.find((filter) => filter.categoryId === categoryId)?.optionId
  }

  function updateMemberFilters(event: CustomEvent<ActiveFilter[]>): void {
    memberFilters = event.detail
  }

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
</script>

<div class="usersLayout">
  <div class="usersList">
    <div class="memberToolbar">
      <SearchInput bind:value={search} width={'22rem'} placeholder={setting.string.SearchMembers} />
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
    <div class="membersScroller">
      <Scroller padding={'0'} noStretch>
        {#if membersLoading || employeesLoading}
          <Loading />
        {:else if visibleEmployees.length === 0}
          <div class="emptyState"><Label label={presentation.string.NoResults} /></div>
        {:else}
          <div class="memberList">
            <ListView
              items={visibleEmployees}
              count={visibleEmployees.length}
              selection={-1}
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
                  <div class="memberListRow">
                    <div class="memberCell">
                      <EmployeePresenter value={employee} avatarSize={'x-small'} />
                    </div>
                    <div class="roleEditor">
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
  </div>
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
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--spacing-2);
    color: var(--theme-caption-color);
  }
  .membersScroller {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .memberListRow {
    display: grid;
    grid-template-columns: minmax(12rem, 20rem) minmax(7rem, 9rem);
    gap: var(--spacing-4);
    align-items: center;
    min-width: 22rem;
    min-height: 3rem;
    padding: var(--spacing-2) var(--spacing-3);
  }
  .memberList {
    min-width: 22rem;
    overflow: hidden;
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
</style>
