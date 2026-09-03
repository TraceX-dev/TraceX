<!--
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import contact, { ensureEmployeeForPerson } from '@hcengineering/contact'
  import { getAccountClient } from '@hcengineering/contact-resources'
  import core, {
    type Account,
    AccountRole,
    AccountUuid,
    type ClassPermission,
    GuestActivityScope,
    type GuestActivitySettings,
    GuestSecurityProfile,
    ModulePermissionGroup,
    getCurrentAccount,
    hasAccountRole,
    pickPrimarySocialId,
    readOnlyGuestAccountUuid,
    type Doc,
    type Permission,
    type Ref
  } from '@hcengineering/core'
  import { getEmbeddedLabel, getMetadata, type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient, uiContext } from '@hcengineering/presentation'
  import workbench, { type Application } from '@hcengineering/workbench'
  import {
    Breadcrumb,
    defineSeparators,
    Header,
    Icon,
    Label,
    Loading,
    NavItem,
    Scroller,
    Separator,
    Toggle,
    twoPanelsSeparators
  } from '@hcengineering/ui'
  import setting from '@hcengineering/setting'
  import { onMount } from 'svelte'
  import AnonymousGuestSpaceInput from './AnonymousGuestSpaceInput.svelte'
  import AvailableSpacesInput from './AvailableSpacesInput.svelte'
  import settingsRes from '../plugin'
  import {
    getDisabledPermissionsForProfile,
    resolveSecurityProfile,
    type SecurityProfile
  } from '../guestSecurityProfiles'

  export let embedded = false
  export let initialTab: 'guest' | 'document' | 'anonymous' = 'guest'

  type GuestPermissionsTab = 'guest' | 'document' | 'anonymous'

  const SECURITY_PROFILES: Array<Exclude<SecurityProfile, GuestSecurityProfile.Custom>> = [
    GuestSecurityProfile.Viewer,
    GuestSecurityProfile.Participant,
    GuestSecurityProfile.Advanced
  ]
  const ACTIVITY_SCOPES = [GuestActivityScope.Own, GuestActivityScope.Collaborator, GuestActivityScope.Any]

  let loadingSettings = true
  let loadingPermissions = true
  let workspaceAppsReady = false
  let loadingWorkspaceGuest = true

  let allowReadOnlyGuests = false
  let allowGuestSignUp = false

  const accountClient = getAccountClient()

  let moduleGroups: ModulePermissionGroup[] = []
  let permissionsMap: Map<Ref<Permission>, Permission> = new Map<Ref<Permission>, Permission>()
  let activitySettings: GuestActivitySettings[] = []
  let hiddenApplicationIds: Array<Ref<Application>> = []
  let savingProfile = false
  let savingActivityScope = false
  let operationError = false

  const excludedApplicationIds = getMetadata(workbench.metadata.ExcludedApplications) ?? []

  let guestPermissionsTab: GuestPermissionsTab = 'guest'
  const canManageAnonymousAccess = hasAccountRole(getCurrentAccount(), AccountRole.Owner)

  const client = getClient()
  const moduleGroupsQuery = createQuery()
  const permissionsQuery = createQuery()
  const hiddenAppsQuery = createQuery()
  const activitySettingsQuery = createQuery()

  onMount(() => {
    void (async (): Promise<void> => {
      try {
        const res = await accountClient.getWorkspaceInfo()
        allowReadOnlyGuests = res.allowReadOnlyGuest ?? false
        allowGuestSignUp = res.allowGuestSignUp ?? false
      } finally {
        loadingWorkspaceGuest = false
      }
    })()
  })

  $: moduleGroupsQuery.query(core.class.ModulePermissionGroup, {}, (res) => {
    moduleGroups = res as unknown as ModulePermissionGroup[]
    loadingSettings = false
  })

  $: permissionsQuery.query(core.class.Permission, {}, (res) => {
    permissionsMap = new Map((res as Permission[]).map((permission) => [permission._id, permission]))
    loadingPermissions = false
  })

  $: hiddenAppsQuery.query(workbench.class.HiddenApplication, { space: core.space.Workspace }, (res) => {
    hiddenApplicationIds = res.map((r) => r.attachedTo)
    workspaceAppsReady = true
  })

  $: activitySettingsQuery.query(core.class.GuestActivitySettings, {}, (res) => {
    activitySettings = res as GuestActivitySettings[]
  })

  $: workspaceApplications = client
    .getModel()
    .findAllSync<Application>(workbench.class.Application, {
    hidden: false,
    _id: { $nin: excludedApplicationIds }
  })
    .filter((app) => !hiddenApplicationIds.includes(app._id))

  $: applicationsMap = new Map<Ref<Doc>, Application>(
    workspaceApplications.map((application) => [application._id as Ref<Doc>, application])
  )

  $: loading = loadingSettings || loadingPermissions || !workspaceAppsReady || loadingWorkspaceGuest

  $: selectedRole =
    guestPermissionsTab === 'guest'
      ? AccountRole.Guest
      : guestPermissionsTab === 'document'
        ? AccountRole.DocGuest
        : AccountRole.ReadOnlyGuest

  // Document guests intentionally inherit the regular guest application policy.
  $: modulePermissionsRole = selectedRole === AccountRole.DocGuest ? AccountRole.Guest : selectedRole

  $: visibleModuleGroups = moduleGroups.filter(
    (group) => applicationsMap.has(group.application) && group.role === modulePermissionsRole
  )

  $: sortedVisibleModuleGroups = [...visibleModuleGroups].sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))

  $: anonymousModulePermissionsReadOnly =
    guestPermissionsTab === 'anonymous' && (!allowReadOnlyGuests || !canManageAnonymousAccess)

  $: roleSettingsReadOnly = guestPermissionsTab === 'document' || anonymousModulePermissionsReadOnly
  $: currentProfile =
    guestPermissionsTab === 'guest'
      ? resolveSecurityProfile(sortedVisibleModuleGroups, permissionsMap)
      : GuestSecurityProfile.Viewer
  $: currentActivityScope =
    activitySettings.find((setting) => setting.role === selectedRole)?.activityScope ?? GuestActivityScope.Own

  $: if (embedded && guestPermissionsTab !== initialTab) {
    guestPermissionsTab = initialTab
  }

  function getApplicationLabel (applicationId: Ref<Doc>): IntlString {
    return applicationsMap.get(applicationId)?.label ?? getEmbeddedLabel(applicationId)
  }

  function getApplication (applicationId: Ref<Doc>): Application | undefined {
    return applicationsMap.get(applicationId)
  }

  function getDisabledPermissions (group: ModulePermissionGroup): Set<Ref<Permission>> {
    return new Set(group.disabledPermissions ?? [])
  }

  function isPermissionActive (group: ModulePermissionGroup, permissionId: Ref<Permission>): boolean {
    return !getDisabledPermissions(group).has(permissionId)
  }

  async function togglePermission (
    group: ModulePermissionGroup,
    permissionId: Ref<Permission>,
    enabled: boolean
  ): Promise<void> {
    if (roleSettingsReadOnly) return
    if (!isModuleEnabled(group)) return
    const disabled = getDisabledPermissions(group)
    if (enabled) {
      disabled.delete(permissionId)
    } else {
      disabled.add(permissionId)
    }
    operationError = false
    try {
      await client.updateDoc(core.class.ModulePermissionGroup, core.space.Model, group._id, {
        disabledPermissions: Array.from(disabled)
      } as any)
      await updateSecurityProfileSetting(GuestSecurityProfile.Custom)
    } catch {
      operationError = true
    }
  }

  async function toggleModule (group: ModulePermissionGroup, enabled: boolean): Promise<void> {
    if (roleSettingsReadOnly) return
    operationError = false
    try {
      await client.updateDoc(core.class.ModulePermissionGroup, core.space.Model, group._id, {
        enabled
      } as any)
      await updateSecurityProfileSetting(GuestSecurityProfile.Custom)
    } catch {
      operationError = true
    }
  }

  function isModuleEnabled (group: ModulePermissionGroup): boolean {
    return group.enabled ?? true
  }

  function getPermissionLabel (permissionId: Ref<Permission>): IntlString {
    return permissionsMap.get(permissionId)?.label ?? getEmbeddedLabel(permissionId)
  }

  async function applySecurityProfile (
    profile: Exclude<SecurityProfile, GuestSecurityProfile.Custom>
  ): Promise<void> {
    if (guestPermissionsTab !== 'guest' || savingProfile) return
    savingProfile = true
    operationError = false
    try {
      await Promise.all(
        sortedVisibleModuleGroups.map(async (group) => {
          const disabledPermissions = getDisabledPermissionsForProfile(group, profile, permissionsMap)
          await client.updateDoc(core.class.ModulePermissionGroup, core.space.Model, group._id, {
            enabled: true,
            disabledPermissions
          })
        })
      )
      await updateSecurityProfileSetting(profile)
    } catch {
      operationError = true
    } finally {
      savingProfile = false
    }
  }

  async function updateActivityScope (scope: GuestActivityScope): Promise<void> {
    if (roleSettingsReadOnly || savingActivityScope) return
    const settingDoc = activitySettings.find((setting) => setting.role === selectedRole)
    savingActivityScope = true
    operationError = false
    try {
      if (settingDoc === undefined) {
        await client.createDoc(core.class.GuestActivitySettings, core.space.Model, {
          role: selectedRole,
          activityScope: scope
        })
      } else {
        await client.updateDoc(core.class.GuestActivitySettings, core.space.Model, settingDoc._id, {
          activityScope: scope
        })
      }
    } catch {
      operationError = true
    } finally {
      savingActivityScope = false
    }
  }

  async function updateSecurityProfileSetting (profile: GuestSecurityProfile): Promise<void> {
    if (selectedRole !== AccountRole.Guest) return
    const settingDoc = activitySettings.find((setting) => setting.role === selectedRole)
    if (settingDoc === undefined) {
      await client.createDoc(core.class.GuestActivitySettings, core.space.Model, {
        role: selectedRole,
        securityProfile: profile,
        activityScope: GuestActivityScope.Own
      })
    } else {
      await client.updateDoc(core.class.GuestActivitySettings, core.space.Model, settingDoc._id, {
        securityProfile: profile
      })
    }
  }

  function getActivePermissions (group: ModulePermissionGroup): Array<Ref<Permission>> {
    if (!isModuleEnabled(group) || guestPermissionsTab === 'document') return []
    return (group.permissions ?? []).filter((permissionId) => isPermissionActive(group, permissionId))
  }

  function getScopeKind (permissionId: Ref<Permission>): string {
    const permission = permissionsMap.get(permissionId) as ClassPermission | undefined
    if (permission?.targetClass === undefined) return 'spaceMember'
    const visibility = client.getHierarchy().classHierarchyMixin(permission.targetClass, core.mixin.RowVisibility)
    return visibility?.writePolicy?.kind ?? visibility?.policy.kind ?? 'spaceMember'
  }

  function getProfileLabel (profile: SecurityProfile): IntlString {
    switch (profile) {
      case GuestSecurityProfile.Viewer:
        return settingsRes.string.GuestSecurityProfileViewer
      case GuestSecurityProfile.Participant:
        return settingsRes.string.GuestSecurityProfileParticipant
      case GuestSecurityProfile.Advanced:
        return settingsRes.string.GuestSecurityProfileAdvanced
      case GuestSecurityProfile.Custom:
        return settingsRes.string.GuestSecurityProfileCustom
    }
  }

  function getProfileDescription (profile: Exclude<SecurityProfile, GuestSecurityProfile.Custom>): IntlString {
    switch (profile) {
      case GuestSecurityProfile.Viewer:
        return settingsRes.string.GuestSecurityProfileViewerDescription
      case GuestSecurityProfile.Participant:
        return settingsRes.string.GuestSecurityProfileParticipantDescription
      case GuestSecurityProfile.Advanced:
        return settingsRes.string.GuestSecurityProfileAdvancedDescription
    }
  }

  function getActivityScopeLabel (scope: GuestActivityScope): IntlString {
    switch (scope) {
      case GuestActivityScope.Own:
        return settingsRes.string.GuestActivityOwn
      case GuestActivityScope.Collaborator:
        return settingsRes.string.GuestActivityCollaborator
      case GuestActivityScope.Any:
        return settingsRes.string.GuestActivityAny
      default:
        return settingsRes.string.GuestActivityOwn
    }
  }

  function getScopeLabel (kind: string): IntlString {
    switch (kind) {
      case 'ownerField':
        return settingsRes.string.GuestOwnRecords
      case 'linkedViaRecord':
        return settingsRes.string.GuestLinkedRecords
      case 'denyAll':
        return settingsRes.string.GuestDenied
      default:
        return settingsRes.string.GuestSpaceMembership
    }
  }

  function onAccessToggle (group: ModulePermissionGroup, ev: Event): void {
    const e = ev as CustomEvent<boolean>
    void toggleModule(group, e.detail)
  }

  function onPermissionToggle (group: ModulePermissionGroup, permissionId: Ref<Permission>, ev: Event): void {
    const e = ev as CustomEvent<boolean>
    void togglePermission(group, permissionId, e.detail)
  }

  function handleAccessToggle (group: ModulePermissionGroup): (ev: Event) => void {
    return (ev: Event) => {
      onAccessToggle(group, ev)
    }
  }

  function handlePermissionToggle (group: ModulePermissionGroup, permissionId: Ref<Permission>): (ev: Event) => void {
    return (ev: Event) => {
      onPermissionToggle(group, permissionId, ev)
    }
  }

  async function handleToggleReadonlyAccess (e: CustomEvent<boolean>): Promise<void> {
    const enabled = e.detail
    const guestUserInfo = await accountClient.updateAllowReadOnlyGuests(enabled)
    allowReadOnlyGuests = enabled
    if (guestUserInfo !== undefined) {
      const guestAccount: Account = {
        uuid: guestUserInfo.guestPerson.uuid as AccountUuid,
        role: AccountRole.ReadOnlyGuest,
        primarySocialId: pickPrimarySocialId(guestUserInfo.guestSocialIds)._id,
        socialIds: guestUserInfo.guestSocialIds.map((si) => si._id),
        fullSocialIds: guestUserInfo.guestSocialIds
      }
      const myAccount = getCurrentAccount()
      const ctx = uiContext.newChild('connect', {})
      await ensureEmployeeForPerson(
        ctx,
        myAccount,
        guestAccount,
        client,
        guestUserInfo.guestSocialIds,
        guestUserInfo.guestPerson
      )
    } else {
      const readonlyEmployee = await client.findOne(contact.mixin.Employee, { personUuid: readOnlyGuestAccountUuid })
      if (readonlyEmployee !== undefined) {
        await client.update(readonlyEmployee, { active: false })
      }
    }
  }

  async function handleToggleGuestSignUp (e: CustomEvent<boolean>): Promise<void> {
    await accountClient.updateAllowGuestSignUp(e.detail)
    allowGuestSignUp = e.detail
  }

  function onReadonlyGuestsToggle (e: CustomEvent<boolean>): void {
    void handleToggleReadonlyAccess(e)
  }

  function onGuestSignUpToggle (e: CustomEvent<boolean>): void {
    void handleToggleGuestSignUp(e)
  }

  defineSeparators('guestPermissionsSettings', twoPanelsSeparators)
</script>

<div class="hulyComponent">
  {#if !embedded}
    <Header adaptive={'disabled'}>
      <Breadcrumb
        icon={setting.icon.Members}
        label={setting.string.GuestPermissionsSettings}
        size={'large'}
        isCurrent
      />
    </Header>
  {/if}
  <div class="hulyComponent-content__container columns">
    {#if !embedded}
      <div class="hulyComponent-content__column navigation py-2">
        <Scroller shrink>
          <NavItem
            icon={contact.icon.Person}
            label={setting.string.GuestPermissionsTabGuest}
            selected={guestPermissionsTab === 'guest'}
            on:click={() => {
              guestPermissionsTab = 'guest'
            }}
          />
          <NavItem
            icon={contact.icon.Persona}
            label={settingsRes.string.GuestPermissionsTabDocumentGuest}
            selected={guestPermissionsTab === 'document'}
            on:click={() => {
              guestPermissionsTab = 'document'
            }}
          />
          <NavItem
            icon={contact.icon.Persona}
            label={setting.string.GuestPermissionsTabAnonymousGuest}
            selected={guestPermissionsTab === 'anonymous'}
            on:click={() => {
              guestPermissionsTab = 'anonymous'
            }}
          />
        </Scroller>
      </div>

      <Separator name={'guestPermissionsSettings'} index={0} color={'var(--theme-divider-color)'} />
    {/if}

    <div class="hulyComponent-content__column content">
      {#if loading}
        <div class="w-full h-full flex-col-center justify-center">
          <Loading />
        </div>
      {:else}
        <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
          <div class="hulyComponent-content guestPermissionsRoot flex-col">
            {#if operationError}
              <div class="operationError" role="alert">
                <Label label={settingsRes.string.GuestSecuritySaveFailed} />
              </div>
            {/if}
            {#if guestPermissionsTab === 'anonymous'}
              <section class="section">
                <div class="sectionHeader">
                  <div class="sectionTitle">
                    <Label label={settingsRes.string.GuestAccess} />
                  </div>
                </div>
                <div class="guestAccessBlock">
                  <div class="guestAccessRow">
                    <div class="guestAccessRow-label">
                      <Label label={settingsRes.string.GuestAccessDescription} />
                    </div>
                    <div class="guestAccessRow-toggleCell">
                      <Toggle
                        disabled={!canManageAnonymousAccess}
                        on={allowReadOnlyGuests}
                        on:change={onReadonlyGuestsToggle}
                      />
                    </div>
                  </div>
                  <div class="guestAccessRow">
                    <div class="guestAccessRow-label">
                      <Label label={settingsRes.string.GuestSignUpDescription} />
                    </div>
                    <div class="guestAccessRow-toggleCell">
                      <Toggle
                        disabled={!allowReadOnlyGuests || !canManageAnonymousAccess}
                        on={allowGuestSignUp}
                        on:change={onGuestSignUpToggle}
                      />
                    </div>
                  </div>
                </div>
              </section>
            {/if}

            {#if guestPermissionsTab === 'document'}
              <section class="section">
                <div class="sectionHint">
                  <Label label={settingsRes.string.GuestDocumentRoleHint} />
                </div>
              </section>
            {/if}

            <section class="section">
              <div class="sectionHeader">
                <div class="sectionTitle">
                  <Label label={settingsRes.string.GuestSecurityProfile} />
                </div>
              </div>
              <div class="profileGrid">
                {#each SECURITY_PROFILES as profile}
                  <button
                    type="button"
                    class="profileOption"
                    class:profileOption-selected={currentProfile === profile}
                    disabled={guestPermissionsTab !== 'guest' || savingProfile}
                    on:click={() => applySecurityProfile(profile)}
                  >
                    <span class="profileOptionTitle"><Label label={getProfileLabel(profile)} /></span>
                    <span class="profileOptionDescription"><Label label={getProfileDescription(profile)} /></span>
                  </button>
                {/each}
                {#if currentProfile === GuestSecurityProfile.Custom}
                  <div class="profileOption profileOption-selected">
                    <Label label={getProfileLabel(GuestSecurityProfile.Custom)} />
                  </div>
                {/if}
              </div>
            </section>

            <section class="section">
              <div class="sectionHeader">
                <div class="sectionTitle">
                  <Label label={settingsRes.string.GuestEffectiveAccess} />
                </div>
              </div>
              <div class="effectiveAccessTable">
                {#each sortedVisibleModuleGroups as group}
                  {@const activePermissions = getActivePermissions(group)}
                  <div class="effectiveAccessRow">
                    <div class="effectiveAccessApp">
                      <Label label={getApplicationLabel(group.application)} />
                    </div>
                    <div class="effectiveAccessDetails">
                      <div>
                        <span class="effectiveAccessLabel"><Label label={settingsRes.string.GuestEffectiveActions} /></span>
                        {#if isModuleEnabled(group)}
                          <span class="effectiveAccessValue"><Label label={settingsRes.string.GuestActionView} /></span>
                          {#each activePermissions as permissionId}
                            <span class="effectiveAccessValue"><Label label={getPermissionLabel(permissionId)} /></span>
                          {/each}
                        {:else}
                          <span class="effectiveAccessValue"><Label label={settingsRes.string.GuestModuleDisabled} /></span>
                        {/if}
                      </div>
                      <div>
                        <span class="effectiveAccessLabel"><Label label={settingsRes.string.GuestEffectiveScope} /></span>
                        {#if !isModuleEnabled(group)}
                          <span class="effectiveAccessValue"><Label label={settingsRes.string.GuestDenied} /></span>
                        {:else if activePermissions.length === 0}
                          <span class="effectiveAccessValue"><Label label={settingsRes.string.GuestSpaceMembership} /></span>
                        {:else}
                          {#each Array.from(new Set(activePermissions.map(getScopeKind))) as scopeKind}
                            <span class="effectiveAccessValue"><Label label={getScopeLabel(scopeKind)} /></span>
                          {/each}
                        {/if}
                      </div>
                      <div>
                        <span class="effectiveAccessLabel"><Label label={settingsRes.string.GuestEffectiveSource} /></span>
                        {#if isModuleEnabled(group)}
                          <span class="effectiveAccessValue">
                            <Label label={settingsRes.string.GuestSecurityProfileSource} />:
                            <Label label={getProfileLabel(currentProfile)} />
                          </span>
                          <span class="effectiveAccessValue">
                            <Label
                              label={activePermissions.length > 0
                                ? settingsRes.string.GuestClassPermissionSource
                                : settingsRes.string.GuestSpaceMembership}
                            />
                          </span>
                        {:else}
                          <span class="effectiveAccessValue"><Label label={settingsRes.string.GuestModuleDisabled} /></span>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            </section>

            <details class="advancedSettings">
              <summary><Label label={settingsRes.string.GuestAdvancedSettings} /></summary>
              <section class="section advancedSettingsSection">
                <div class="sectionTitle">
                  <Label label={settingsRes.string.GuestActivityVisibility} />
                </div>
                <div class="profileGrid">
                  {#each ACTIVITY_SCOPES as scope}
                    <button
                      type="button"
                      class="profileOption"
                      class:profileOption-selected={currentActivityScope === scope}
                      disabled={roleSettingsReadOnly || savingActivityScope}
                      on:click={() => updateActivityScope(scope)}
                    >
                      <Label label={getActivityScopeLabel(scope)} />
                    </button>
                  {/each}
                </div>
              </section>

              <section class="section advancedSettingsSection">
              <div class="sectionHeader">
                <div class="sectionTitle">
                  <Label label={setting.string.GuestPermissionsApplicationPermissions} />
                </div>
                <div class="sectionHint">
                  {#if guestPermissionsTab === 'anonymous'}
                    <Label label={setting.string.GuestPermissionsAnonymousApplicationHint} />
                  {:else}
                    <Label label={setting.string.GuestPermissionsApplicationPermissionsHint} />
                  {/if}
                </div>
                {#if guestPermissionsTab === 'guest'}
                  <div class="sectionHint">
                    <Label label={core.string.AutoJoinGuestsDescr} />
                  </div>
                  <div class="sectionHint">
                    <Label label={settingsRes.string.GuestAutoJoinAvailableSpacesHint} />
                  </div>
                {:else if guestPermissionsTab === 'anonymous'}
                  <div class="sectionHint">
                    <Label label={settingsRes.string.GuestAnonymousVisibleSpacesHint} />
                  </div>
                {/if}
              </div>

              <div class="cardStack" class:cardStack-readonly={roleSettingsReadOnly}>
                {#each sortedVisibleModuleGroups as group}
                  {@const app = getApplication(group.application)}
                  {@const moduleOn = isModuleEnabled(group)}
                  {@const permissionCount = (group.permissions ?? []).length}
                  {@const hasGuestAutoJoinRow =
                    guestPermissionsTab === 'guest' &&
                    group.role === AccountRole.Guest &&
                    group.spaceClass !== undefined}
                  {@const hasAnonymousGuestSpacesRow =
                    guestPermissionsTab === 'anonymous' &&
                    group.role === AccountRole.ReadOnlyGuest &&
                    group.spaceClass !== undefined}
                  {@const hasPermissionRowsBlock =
                    permissionCount > 0 || hasGuestAutoJoinRow || hasAnonymousGuestSpacesRow}
                  <div class="permissionModuleCard" class:permissionModuleCard-off={!moduleOn}>
                    <div
                      class="permissionModuleCard-header"
                      class:permissionModuleCard-headerOnly={!hasPermissionRowsBlock}
                    >
                      <div class="permissionModuleCard-headerMain">
                        {#if app}
                          <div class="appIcon appIcon-sm">
                            <Icon icon={app.icon} size={'small'} />
                          </div>
                        {:else}
                          <div class="appIcon appIcon-sm appIcon-placeholder" />
                        {/if}
                        <div class="permissionModuleCard-titles">
                          <div class="permissionModuleCard-name">
                            <Label label={getApplicationLabel(group.application)} />
                          </div>
                        </div>
                      </div>
                      <div class="permissionModuleCard-toggleCell">
                        <Toggle
                          disabled={roleSettingsReadOnly}
                          on={moduleOn}
                          on:change={handleAccessToggle(group)}
                        />
                      </div>
                    </div>

                    {#if hasPermissionRowsBlock}
                      <div class="permissionRows">
                        {#if permissionCount > 0}
                          {#each group.permissions ?? [] as permissionId}
                            <div class="permissionRow">
                              <div class="permissionRow-label">
                                <Label label={getPermissionLabel(permissionId)} />
                              </div>
                              <div class="permissionRow-toggleCell">
                                <Toggle
                                  disabled={!moduleOn || roleSettingsReadOnly}
                                  on={isPermissionActive(group, permissionId)}
                                  on:change={handlePermissionToggle(group, permissionId)}
                                />
                              </div>
                            </div>
                          {/each}
                        {/if}
                        {#if hasGuestAutoJoinRow}
                          <div class="permissionRow permissionRow--guestSpaces">
                            <div class="permissionRow-label">
                              <Label label={settingsRes.string.GuestAutoJoinAvailableSpaces} />
                            </div>
                            <div class="permissionRow-editorCell">
                              <AvailableSpacesInput
                                {group}
                                disabled={!moduleOn || roleSettingsReadOnly}
                              />
                            </div>
                          </div>
                        {:else if hasAnonymousGuestSpacesRow}
                          <div class="permissionRow permissionRow--guestSpaces">
                            <div class="permissionRow-label">
                              <Label label={settingsRes.string.GuestAnonymousVisibleSpaces} />
                            </div>
                            <div class="permissionRow-editorCell">
                              <AnonymousGuestSpaceInput
                                {group}
                                disabled={!moduleOn || roleSettingsReadOnly}
                              />
                            </div>
                          </div>
                        {/if}
                      </div>
                    {/if}
                  </div>
                {/each}
                {#if visibleModuleGroups.length === 0}
                  <div class="emptyState emptyState-block">—</div>
                {/if}
              </div>
              </section>
            </details>
          </div>
        </Scroller>
      {/if}
    </div>
  </div>
</div>

<style lang="scss">
  $toggleTrackWidth: 2.25rem;

  .operationError {
    padding: var(--spacing-2) var(--spacing-3);
    border: 1px solid var(--theme-state-negative-color);
    border-radius: var(--border-radius-medium);
    background: var(--theme-state-negative-background-color);
    color: var(--theme-state-negative-color);
  }

  .guestPermissionsRoot {
    max-width: 40rem;
    width: 100%;
    margin: 0 auto;
    gap: 2rem;
  }

  .guestAccessBlock {
    display: flex;
    flex-direction: column;
    gap: 0;
    padding-right: 1rem;
    overflow: visible;
  }

  .guestAccessRow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) #{$toggleTrackWidth};
    align-items: center;
    column-gap: 0.75rem;
    min-height: 2.5rem;
    padding: 0.625rem 0 0.625rem 0.25rem;
  }

  .guestAccessRow:not(:first-child) {
    border-top: 1px solid var(--theme-navpanel-divider);
  }

  .guestAccessRow--editor {
    align-items: start;
    min-height: auto;
    padding-top: 0.75rem;
    padding-bottom: 0.75rem;
    overflow: visible;
  }

  .guestAccessRow--editor .guestAccessRow-editorCell {
    grid-column: 2;
    grid-row: 1;
    justify-self: end;
    align-self: start;
    width: max-content;
    max-width: min(22rem, calc(100vw - 3rem));
    min-width: 0;
    overflow: visible;
  }

  .guestAccessRow-editorInner {
    min-width: 0;
    max-width: 100%;
  }

  .guestAccessRow-label {
    min-width: 0;
    color: var(--theme-content-color);
  }

  .guestAccessRow-toggleCell {
    display: flex;
    justify-content: center;
    align-items: center;
    width: $toggleTrackWidth;
    justify-self: end;
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .sectionHeader {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .sectionTitle {
    font-weight: 500;
    font-size: 1rem;
    color: var(--theme-content-color);
  }

  .sectionHint {
    font-size: 0.8rem;
    color: var(--theme-halfcontent-color);
  }

  .profileGrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.5rem;
  }

  .profileOption {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-height: 2.5rem;
    padding: 0.625rem 0.75rem;
    border: 1px solid var(--theme-navpanel-divider);
    border-radius: var(--small-focus-BorderRadius);
    background: var(--theme-panel-color);
    color: var(--theme-content-color);
    text-align: left;
    cursor: pointer;
  }

  .profileOptionTitle {
    font-weight: 500;
  }

  .profileOptionDescription {
    font-size: 0.75rem;
    color: var(--theme-halfcontent-color);
  }

  .profileOption:hover:not(:disabled),
  .profileOption-selected {
    border-color: var(--theme-primary-color);
    background: var(--theme-button-hovered);
  }

  .profileOption:disabled {
    cursor: default;
    opacity: 0.7;
  }

  .effectiveAccessTable {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--theme-navpanel-divider);
    border-radius: var(--small-focus-BorderRadius);
    overflow: hidden;
  }

  .effectiveAccessRow {
    display: grid;
    grid-template-columns: minmax(8rem, 0.35fr) minmax(0, 1fr);
    gap: 1rem;
    padding: 0.75rem 1rem;
    background: var(--theme-panel-color);
  }

  .effectiveAccessRow:not(:first-child) {
    border-top: 1px solid var(--theme-navpanel-divider);
  }

  .effectiveAccessApp {
    font-weight: 500;
  }

  .effectiveAccessDetails {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }

  .effectiveAccessLabel {
    display: inline-block;
    min-width: 7.5rem;
    color: var(--theme-halfcontent-color);
  }

  .effectiveAccessValue:not(:last-child)::after {
    content: ', ';
  }

  .advancedSettings {
    border-top: 1px solid var(--theme-divider-color);
    padding-top: 0.75rem;
  }

  .advancedSettings summary {
    color: var(--theme-content-color);
    cursor: pointer;
    font-weight: 500;
  }

  .advancedSettingsSection {
    margin-top: 1rem;
  }

  .cardStack {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding-top: 0.5rem;
  }

  .cardStack-readonly {
    opacity: 0.85;
  }

  .appIcon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
    border-radius: var(--small-focus-BorderRadius);
    background-color: var(--theme-button-default);
    color: var(--theme-caption-color);
  }

  .appIcon-sm {
    width: 2rem;
    height: 2rem;
  }

  .appIcon-placeholder {
    opacity: 0.35;
  }

  .permissionModuleCard {
    display: flex;
    flex-direction: column;
    border-radius: var(--small-focus-BorderRadius);
    border: 1px solid var(--theme-navpanel-divider);
    overflow: hidden;
    background-color: var(--theme-panel-color);
    box-shadow: var(--theme-popup-shadow);
  }

  .permissionModuleCard-off .permissionRows {
    opacity: 0.55;
  }

  .permissionModuleCard-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) #{$toggleTrackWidth};
    align-items: center;
    column-gap: 0.75rem;
    padding: 0.75rem 1rem;
    background-color: var(--theme-comp-header-color);
    border-bottom: 1px solid var(--theme-divider-color);

    &.permissionModuleCard-headerOnly {
      border-bottom: none;
    }
  }

  .permissionModuleCard-headerMain {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .permissionModuleCard-toggleCell,
  .permissionRow-toggleCell {
    display: flex;
    justify-content: center;
    align-items: center;
    width: $toggleTrackWidth;
    justify-self: end;
  }

  .permissionModuleCard-name {
    font-weight: 500;
    font-size: 0.9375rem;
    color: var(--theme-content-color);
  }

  .permissionRows {
    display: flex;
    flex-direction: column;
    padding: 0.25rem 1rem 0.75rem;
    background-color: var(--theme-panel-color);
  }

  .permissionRow {
    display: grid;
    grid-template-columns: minmax(0, 1fr) #{$toggleTrackWidth};
    align-items: center;
    column-gap: 0.75rem;
    padding: 0.625rem 0 0.625rem 0.25rem;
    min-height: 2.5rem;
  }

  .permissionRow:not(:first-child) {
    border-top: 1px solid var(--theme-navpanel-divider);
  }

  .permissionRow-label {
    min-width: 0;
    color: var(--theme-content-color);
  }

  .permissionRow--guestSpaces {
    align-items: start;
    min-height: auto;
    padding-top: 0.75rem;
    padding-bottom: 0.75rem;
    grid-template-columns: minmax(0, 1fr) minmax(8rem, max-content);
  }

  .permissionRow--guestSpaces .permissionRow-editorCell {
    grid-column: 2;
    justify-self: end;
    align-self: start;
    width: max-content;
    max-width: min(18rem, calc(100vw - 4rem));
    min-width: 0;
    overflow: visible;
  }

  .emptyState {
    font-size: 0.875rem;
    color: var(--theme-halfcontent-color);
    padding: 0.25rem 0;
  }

  .emptyState-block {
    padding: 0.5rem 0;
  }
</style>
