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
  import {
    type AccountUuid,
    type Space,
    type WorkspaceMemberInfo,
    AccountRole,
    getCurrentAccount,
    hasAccountRole
  } from '@hcengineering/core'
  import presentation from '@hcengineering/presentation'
  import {
    Button,
    ButtonIcon,
    type DropdownIntlItem,
    DropdownLabelsIntl,
    IconClose,
    Label,
    ListViewItem,
    Loading,
    Scroller,
    SearchInput
  } from '@hcengineering/ui'

  import {
    WORKSPACE_ROLES,
    canChangeWorkspaceRole,
    canRevokeSpaceAccess,
    getAssignableWorkspaceRoles,
    getSpacesForMember,
    getWorkspaceMemberRole
  } from '../../accessPermissions'
  import setting from '../../plugin'
  import { getSpaceType, isSpaceOperationPending } from '../../spaceAccessUtils'
  import UserRoleSelect from '../UserRoleSelect.svelte'

  type MemberRoleFilter = 'all' | AccountRole

  interface RevokedAccess {
    space: Space
    person: AccountUuid
    previousMembers: AccountUuid[]
    previousOwners: AccountUuid[] | undefined
  }

  const currentAccount = getCurrentAccount()
  const hasWorkspaceOwnerAccess = hasAccountRole(currentAccount, AccountRole.Owner)
  const ROLE_FILTER_LABELS: Partial<Record<AccountRole, DropdownIntlItem['label']>> = {
    [AccountRole.ReadOnlyGuest]: setting.string.ReadonlyGuest,
    [AccountRole.Guest]: setting.string.Guest,
    [AccountRole.User]: setting.string.User,
    [AccountRole.Maintainer]: setting.string.Maintainer,
    [AccountRole.Owner]: setting.string.Owner
  }
  const MEMBER_ROLE_FILTER_ITEMS: DropdownIntlItem[] = [
    { id: 'all', label: setting.string.AllIntegrations },
    ...WORKSPACE_ROLES.map((role) => ({ id: role, label: ROLE_FILTER_LABELS[role] ?? setting.string.User }))
  ]

  export let spaces: Space[]
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
  let memberRoleFilter: MemberRoleFilter = 'all'
  let memberSpaceSearch = ''
  let revokedAccess: RevokedAccess | undefined
  let selectedPerson: AccountUuid | undefined

  function updateMemberRoleFilter (event: CustomEvent<DropdownIntlItem['id']>): void {
    memberRoleFilter = event.detail as MemberRoleFilter
  }

  function selectUser (personUuid: AccountUuid): void {
    selectedPerson = selectedPerson === personUuid ? undefined : personUuid
    memberSpaceSearch = ''
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

  $: selectedEmployee = employees.find((employee) => employee.personUuid === selectedPerson)
  $: selectedSpaces = getSpacesForMember(spaces, selectedPerson)
  $: visibleSelectedSpaces = selectedSpaces.filter((space) =>
    space.name.toLowerCase().includes(memberSpaceSearch.trim().toLowerCase())
  )
  $: visibleEmployees = employees.filter(
    (employee) =>
      employee.active &&
      employee.personUuid !== undefined &&
      getWorkspaceMemberRole(workspaceMembers, employee.personUuid) !== undefined &&
      formatName(employee.name).toLowerCase().includes(search.toLowerCase()) &&
      (memberRoleFilter === 'all' || getWorkspaceMemberRole(workspaceMembers, employee.personUuid) === memberRoleFilter)
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
    <h2><Label label={setting.string.Members} /></h2>
    <div class="memberToolbar">
      <SearchInput bind:value={search} placeholder={setting.string.SearchMembers} />
      <DropdownLabelsIntl
        label={setting.string.Role}
        kind={'no-border'}
        size={'small'}
        items={MEMBER_ROLE_FILTER_ITEMS}
        selected={memberRoleFilter}
        on:selected={updateMemberRoleFilter}
      />
      <span>
        {#if search.trim() !== '' || memberRoleFilter !== 'all'}{visibleEmployees.length} /
        {/if}
        {activeEmployeesCount}
      </span>
    </div>
    <Scroller padding={'var(--spacing-3)'}>
      {#if membersLoading || employeesLoading}
        <Loading />
      {:else if visibleEmployees.length === 0}
        <div class="emptyState"><Label label={presentation.string.NoResults} /></div>
      {:else}
        {#each visibleEmployees as employee (employee._id)}
          {@const personUuid = employee.personUuid}
          {@const role = personUuid !== undefined ? getWorkspaceMemberRole(workspaceMembers, personUuid) : undefined}
          {#if personUuid !== undefined && role !== undefined}
            <ListViewItem
              kind={'thin'}
              addClass={'memberListItem'}
              selected={selectedPerson === personUuid}
              on:click={() => {
                selectUser(personUuid)
              }}
            >
              <svelte:fragment slot="item">
                <div class="memberRow">
                  <EmployeePresenter value={employee} avatarSize={'small'} disabled showPopup={false} />
                  <div class="roleEditor" on:click|stopPropagation role="none">
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
              </svelte:fragment>
            </ListViewItem>
          {/if}
        {/each}
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
          <span>{selectedSpaces.length}</span>
        </div>
        <SearchInput bind:value={memberSpaceSearch} width={'100%'} placeholder={setting.string.SearchSpaces} />
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
        {#if selectedSpaces.length === 0}
          <p class="hint placeholder"><Label label={setting.string.NoSpaces} /></p>
        {:else if visibleSelectedSpaces.length === 0}
          <div class="emptyState"><Label label={presentation.string.NoResults} /></div>
        {:else}
          <Scroller padding={'var(--spacing-3)'}>
            <ul class="memberSpacesList">
              {#each visibleSelectedSpaces as space (space._id)}
                <li class="memberSpaceRow">
                  <div class="spaceName">
                    <strong>{space.name}</strong>
                    <span>{getSpaceType(space)}</span>
                  </div>
                  <div class="memberSpaceActions">
                    <ButtonIcon
                      icon={IconClose}
                      size={'min'}
                      kind={'tertiary'}
                      disabled={selectedPerson === undefined ||
                        !canRevokeSpaceAccess(space.owners, selectedPerson, hasWorkspaceOwnerAccess) ||
                        isSpaceOperationPending(pendingSpaceOperations, space, 'members')}
                      tooltip={{ label: setting.string.RemoveMemberFromSpace }}
                      on:click={() => {
                        if (selectedPerson !== undefined) {
                          revokeSpaceAccess(space, selectedPerson).catch(handleError)
                        }
                      }}
                    />
                  </div>
                </li>
              {/each}
            </ul>
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
  h2 {
    margin: 0 0 var(--spacing-1);
  }
  .memberToolbar {
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) auto auto;
    align-items: center;
    gap: var(--spacing-2);
    color: var(--theme-caption-color);
  }
  .memberRow {
    display: flex;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-2);
    padding: var(--spacing-2);
    cursor: pointer;
  }
  .roleEditor {
    flex: 0 0 auto;
  }
  .usersList :global(.memberListItem:hover:not(.selection)) {
    background: var(--theme-button-hovered);
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
  .memberSpacesList {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .memberSpaceRow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-2);
    min-height: 3.25rem;
    padding: var(--spacing-2) var(--spacing-3);
    border-radius: var(--border-radius-medium);
  }
  .memberSpaceRow + .memberSpaceRow {
    border-top: 1px solid var(--theme-divider-color);
    border-top-left-radius: 0;
    border-top-right-radius: 0;
  }
  .memberSpaceRow:hover,
  .memberSpaceRow:focus-within {
    background: var(--theme-button-hovered);
  }
  .memberSpaceActions {
    flex: 0 0 auto;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .memberSpaceRow:hover .memberSpaceActions,
  .memberSpaceRow:focus-within .memberSpaceActions {
    opacity: 1;
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
