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
  import { Analytics } from '@hcengineering/analytics'
  import contact, { type Employee, formatName } from '@hcengineering/contact'
  import core, {
    type AccountUuid,
    type Ref,
    type Space,
    type WorkspaceMemberInfo,
    AccountRole,
    isGuestRole,
    setWorkspaceGuestAutoJoinRoles
  } from '@hcengineering/core'
  import { getMetadata } from '@hcengineering/platform'
  import presentation, { createQuery, getClient } from '@hcengineering/presentation'
  import {
    Breadcrumb,
    ButtonIcon,
    Header,
    IconClose,
    Label,
    NavItem,
    Scroller,
    Separator,
    defineSeparators,
    twoPanelsSeparators
  } from '@hcengineering/ui'
  import workbench, {
    type Application,
    type ApplicationNavModel,
    createSpaceApplicationResolver
  } from '@hcengineering/workbench'

  import setting from '../plugin'
  import { getSpaceOperationKey, type SpaceOperation } from '../spaceAccessUtils'
  import { getAccountClient } from '../utils'
  import MembersAccessSettings from './access/MembersAccessSettings.svelte'
  import SpacesAccessSettings from './access/SpacesAccessSettings.svelte'
  import GuestPermissionsSettings from './GuestPermissionsSettings.svelte'
  import SpaceRolesSettings from './Spaces.svelte'

  type Tab = 'spaces' | 'spaceRoles' | 'users' | 'guests' | 'anonymous'

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const accountClient = getAccountClient()
  const excludedSpaceClasses = new Set<string>([
    'board:class:Board',
    'chunter:class:DirectMessage',
    'lead:class:Funnel',
    'templates:class:TemplateCategory'
  ])
  const excludedSpaceIds = new Set<Ref<Space>>([core.space.Space])
  const excludedApplicationIds = getMetadata(workbench.metadata.ExcludedApplications) ?? []
  const applicationNavModels = client
    .getModel()
    .findAllSync<ApplicationNavModel>(workbench.class.ApplicationNavModel, {})

  let activeTab: Tab = 'users'
  let spaces: Space[] = []
  let spacesLoading = true
  let employees: Employee[] = []
  let employeesLoading = true
  let workspaceMembers: WorkspaceMemberInfo[] = []
  let membersLoading = true
  let operationError = false
  let pendingSpaceOperations = new Set<string>()
  let pendingRoleUpdates = new Set<AccountUuid>()
  let hiddenApplicationIds: Array<Ref<Application>> = []

  const hiddenAppsQuery = createQuery()
  hiddenAppsQuery.query(workbench.class.HiddenApplication, { space: core.space.Workspace }, (result) => {
    hiddenApplicationIds = result.map((preference) => preference.attachedTo)
  })

  $: workspaceApplications = client
    .getModel()
    .findAllSync<Application>(workbench.class.Application, {
    hidden: false,
    _id: { $nin: excludedApplicationIds }
  })
    .filter((application) => !hiddenApplicationIds.includes(application._id))
  $: spaceApplicationResolver = createSpaceApplicationResolver(hierarchy, workspaceApplications, applicationNavModels)

  const spacesQuery = createQuery()
  spacesQuery.query(core.class.Space, { archived: false }, (result) => {
    spacesLoading = false
    spaces = [...result]
      .filter(
        (space) =>
          !hierarchy.isDerived(space._class, core.class.SystemSpace) &&
          !hierarchy.isDerived(space._class, contact.class.PersonSpace) &&
          !excludedSpaceClasses.has(space._class) &&
          !excludedSpaceIds.has(space._id)
      )
      .sort((left, right) => left.name.localeCompare(right.name))
  })

  const employeesQuery = createQuery()
  employeesQuery.query(contact.mixin.Employee, {}, (result) => {
    employeesLoading = false
    employees = [...result]
      .filter((employee) => employee.personUuid != null)
      .sort((left, right) => formatName(left.name).localeCompare(formatName(right.name)))
  })

  loadWorkspaceMembers().catch(handleOperationError)

  async function loadWorkspaceMembers (): Promise<void> {
    try {
      workspaceMembers = await accountClient.getWorkspaceMembers()
    } finally {
      membersLoading = false
    }
  }

  function handleOperationError (error: unknown): void {
    operationError = true
    Analytics.handleError(error as Error)
  }

  async function runSpaceOperation (
    space: Space,
    operation: SpaceOperation,
    update: () => Promise<void>
  ): Promise<boolean> {
    const key = getSpaceOperationKey(space, operation)
    if (pendingSpaceOperations.has(key)) return false

    operationError = false
    pendingSpaceOperations = new Set(pendingSpaceOperations).add(key)
    try {
      await update()
      return true
    } catch (error) {
      handleOperationError(error)
      spaces = [...spaces]
      return false
    } finally {
      pendingSpaceOperations = new Set([...pendingSpaceOperations].filter((candidate) => candidate !== key))
    }
  }

  async function changeRole (personUuid: AccountUuid, value: AccountRole): Promise<void> {
    if (pendingRoleUpdates.has(personUuid)) return

    operationError = false
    pendingRoleUpdates = new Set(pendingRoleUpdates).add(personUuid)
    try {
      await accountClient.updateWorkspaceRole(personUuid, value)
      workspaceMembers = workspaceMembers.map((member) =>
        member.person === personUuid ? { ...member, role: value } : member
      )

      const employee = employees.find((candidate) => candidate.personUuid === personUuid)
      if (employee !== undefined) {
        await client.update(employee, { role: isGuestRole(value) ? 'GUEST' : 'USER' })
      }
    } catch (error) {
      handleOperationError(error)
    } finally {
      pendingRoleUpdates = new Set([...pendingRoleUpdates].filter((candidate) => candidate !== personUuid))
    }
  }

  async function updateMembers (space: Space, members: AccountUuid[], owners?: AccountUuid[]): Promise<boolean> {
    return await runSpaceOperation(space, 'members', async () => {
      await client.updateDoc(space._class, space.space, space._id, {
        members,
        ...(owners !== undefined ? { owners } : {})
      })
    })
  }

  async function setAutoJoin (space: Space, value: boolean): Promise<void> {
    await runSpaceOperation(space, 'autojoin', async () => {
      await client.updateDoc(space._class, space.space, space._id, { autoJoin: value })
    })
  }

  async function setGuestAutoJoin (space: Space, value: boolean): Promise<void> {
    await runSpaceOperation(space, 'guest-autojoin', async () => {
      await client.updateDoc(space._class, space.space, space._id, {
        autoJoinForRoles: setWorkspaceGuestAutoJoinRoles(space.autoJoinForRoles, value)
      })
    })
  }

  defineSeparators('spaceAccessSettings', twoPanelsSeparators)
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={setting.icon.Members} label={setting.string.AccessControl} size={'large'} isCurrent />
  </Header>
  <div class="hulyComponent-content__container columns">
    <div class="hulyComponent-content__column navigation py-2">
      <Scroller shrink>
        <NavItem
          icon={setting.icon.Members}
          label={setting.string.Members}
          selected={activeTab === 'users'}
          on:click={() => {
            activeTab = 'users'
          }}
        />
        <NavItem
          icon={setting.icon.Views}
          label={setting.string.Spaces}
          selected={activeTab === 'spaces'}
          on:click={() => {
            activeTab = 'spaces'
          }}
        />
        <NavItem
          icon={setting.icon.Privacy}
          label={setting.string.SpaceRoles}
          selected={activeTab === 'spaceRoles'}
          on:click={() => {
            activeTab = 'spaceRoles'
          }}
        />
        <NavItem
          icon={contact.icon.Person}
          label={setting.string.GuestPermissionsTabGuest}
          selected={activeTab === 'guests'}
          on:click={() => {
            activeTab = 'guests'
          }}
        />
        <NavItem
          icon={contact.icon.Persona}
          label={setting.string.GuestPermissionsTabAnonymousGuest}
          selected={activeTab === 'anonymous'}
          on:click={() => {
            activeTab = 'anonymous'
          }}
        />
      </Scroller>
    </div>

    <Separator name={'spaceAccessSettings'} index={0} color={'var(--theme-divider-color)'} />

    <div class="hulyComponent-content__column content">
      {#if operationError}
        <div class="operationError" role="alert">
          <span><Label label={setting.string.IntegrationError} /></span>
          <ButtonIcon
            icon={IconClose}
            size={'min'}
            kind={'tertiary'}
            tooltip={{ label: presentation.string.Close }}
            on:click={() => {
              operationError = false
            }}
          />
        </div>
      {/if}
      {#if activeTab === 'users'}
        <MembersAccessSettings
          {employees}
          {workspaceMembers}
          {employeesLoading}
          {membersLoading}
          {pendingRoleUpdates}
          {changeRole}
          handleError={handleOperationError}
        />
      {:else if activeTab === 'spaces'}
        <SpacesAccessSettings
          {spaces}
          {spaceApplicationResolver}
          {employees}
          {spacesLoading}
          {employeesLoading}
          {pendingSpaceOperations}
          {updateMembers}
          {setAutoJoin}
          {setGuestAutoJoin}
          handleError={handleOperationError}
        />
      {:else if activeTab === 'spaceRoles'}
        <div class="spaceRolesPanel">
          <SpaceRolesSettings embedded />
        </div>
      {:else}
        <div class="guestPermissionsPanel">
          <GuestPermissionsSettings embedded initialTab={activeTab === 'guests' ? 'guest' : 'anonymous'} />
        </div>
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  .operationError {
    display: flex;
    flex: 0 0 auto;
    align-items: center;
    justify-content: space-between;
    gap: var(--spacing-3);
    margin: var(--spacing-3) var(--spacing-4) 0;
    padding: var(--spacing-2) var(--spacing-3);
    border: 1px solid var(--theme-state-negative-color);
    border-radius: var(--border-radius-medium);
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
  }
  .guestPermissionsPanel {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .spaceRolesPanel {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .spaceRolesPanel :global(.hulyComponent),
  .guestPermissionsPanel :global(.hulyComponent) {
    height: 100%;
  }
</style>
