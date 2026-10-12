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
  import core, { AccountRole, getCurrentAccount, type Ref } from '@hcengineering/core'
  import { Analytics } from '@hcengineering/analytics'
  import login from '@hcengineering/login'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import setting, { type InviteSettings, type RoleCapabilitySettings, RoleCapability } from '@hcengineering/setting'
  import { hasRoleCapability } from '../roleCapability'
  import {
    getDefaultInviterRoles,
    getDefaultInviteRole,
    INVITE_SETTINGS_DEFAULT_EXPIRATION_HOURS,
    resolveInviteSettings
  } from '../inviteSettingsUtils'
  import { translate } from '@hcengineering/platform'
  import {
    Breadcrumb,
    DropdownLabels,
    DropdownLabelsIntl,
    type DropdownIntlItem,
    DropdownTextItem,
    EditBox,
    Header,
    Label,
    Loading,
    Notice,
    Scroller,
    SettingsCard,
    SettingsCardsLayout,
    themeStore
  } from '@hcengineering/ui'
  import settingRes from '../plugin'
  import UserRoleSelect from './UserRoleSelect.svelte'
  import WorkspaceInvites from './WorkspaceInvites.svelte'

  const client = getClient()

  let loading = true
  const expirationItems: DropdownIntlItem[] = [
    { id: '48', label: settingRes.string.InviteHours, params: { hours: 48 } },
    { id: '168', label: settingRes.string.InviteSevenDays },
    { id: 'never', label: settingRes.string.InvitationNeverExpires },
    { id: 'custom', label: settingRes.string.InviteCustom }
  ]
  const limitItems: DropdownIntlItem[] = [
    { id: 'unlimited', label: settingRes.string.InvitationUnlimitedUses },
    { id: 'once', label: settingRes.string.InviteSingleUse },
    { id: 'custom', label: settingRes.string.InviteCustom }
  ]

  let expTime: number | undefined = INVITE_SETTINGS_DEFAULT_EXPIRATION_HOURS
  let expirationPreset = String(INVITE_SETTINGS_DEFAULT_EXPIRATION_HOURS)
  let limitPreset = 'unlimited'
  let saveFailed = false
  let mask: string = ''
  let limit: number | undefined = -1

  let defaultInviteRole: AccountRole = getDefaultInviteRole()
  let inviteLinkGeneratorRoles: AccountRole[] = getDefaultInviterRoles()
  let existingInviteSettings: InviteSettings[] = []
  let existingRoleCapabilitySettings: {
    _id: Ref<RoleCapabilitySettings>
    roleByCapability?: Record<string, AccountRole[]>
  }[] = []
  const query = createQuery()
  const roleCapabilityQuery = createQuery()
  roleCapabilityQuery.query(setting.class.RoleCapabilitySettings, {}, (set) => {
    existingRoleCapabilitySettings = set as typeof existingRoleCapabilitySettings
  })
  $: inviteExpirationInvalid = expTime !== -1 && (expTime === undefined || !Number.isInteger(expTime) || expTime < 1)
  $: inviteLimitInvalid = limit !== -1 && (limit === undefined || !Number.isInteger(limit) || limit < 1)
  $: roleByCapability = existingRoleCapabilitySettings[0]?.roleByCapability
  $: canManagePermissions = hasRoleCapability(
    getCurrentAccount(),
    RoleCapability.ManageInviteSettings,
    roleByCapability,
    undefined
  )
  let inviteLinkGeneratorRolesItems: DropdownTextItem[] = []
  $: lang = $themeStore?.language
  $: if (typeof lang === 'string') {
    void Promise.all([
      translate(settingRes.string.User, {}, lang),
      translate(settingRes.string.Maintainer, {}, lang),
      translate(settingRes.string.Owner, {}, lang)
    ]).then(([userLabel, maintainerLabel, ownerLabel]) => {
      inviteLinkGeneratorRolesItems = [
        { id: AccountRole.User, label: userLabel },
        { id: AccountRole.Maintainer, label: maintainerLabel },
        { id: AccountRole.Owner, label: ownerLabel }
      ]
    })
  }

  function applyInviteSettings (set: InviteSettings[]): void {
    existingInviteSettings = set
    const state = resolveInviteSettings(set[0])
    if (loading || expTime !== state.expirationTime) {
      expirationPreset =
        state.expirationTime < 0
          ? 'never'
          : state.expirationTime === 48 || state.expirationTime === 168
            ? String(state.expirationTime)
            : 'custom'
    }
    if (loading || limit !== state.limit) {
      limitPreset = state.noLimit ? 'unlimited' : state.limit === 1 ? 'once' : 'custom'
    }
    expTime = state.expirationTime
    mask = state.emailMask
    limit = state.limit
    defaultInviteRole = state.defaultInviteRole
    inviteLinkGeneratorRoles = state.inviteLinkGeneratorRoles
    loading = false
  }

  $: query.query(setting.class.InviteSettings, {}, applyInviteSettings)

  async function setInviteSettings (): Promise<void> {
    if (inviteExpirationInvalid || inviteLimitInvalid || expTime === undefined) return
    const savedLimit = limit ?? -1

    const newSettings = {
      expirationTime: expTime,
      emailMask: mask,
      limit: savedLimit,
      defaultInviteRole,
      inviteLinkGeneratorRoles: [...inviteLinkGeneratorRoles],
      enabled: true
    }
    if (existingInviteSettings.length === 0) {
      await client.createDoc(setting.class.InviteSettings, core.space.Workspace, newSettings)
    } else {
      await client.updateDoc(
        setting.class.InviteSettings,
        core.space.Workspace,
        existingInviteSettings[0]._id,
        newSettings
      )
    }
    const newRoleByCapability: Record<string, AccountRole[]> = {
      ...(existingRoleCapabilitySettings[0]?.roleByCapability ?? {}),
      [RoleCapability.GenerateInviteLink]: [...inviteLinkGeneratorRoles]
    }
    const roleCapabilityPayload = { roleByCapability: newRoleByCapability, enabled: true }
    if (existingRoleCapabilitySettings.length === 0) {
      await client.createDoc(setting.class.RoleCapabilitySettings, core.space.Workspace, roleCapabilityPayload)
    } else {
      await client.updateDoc(
        setting.class.RoleCapabilitySettings,
        core.space.Workspace,
        existingRoleCapabilitySettings[0]._id,
        roleCapabilityPayload
      )
    }
  }

  async function autoSaveIfValid (): Promise<void> {
    if (loading || inviteExpirationInvalid || inviteLimitInvalid) return
    saveFailed = false
    try {
      await setInviteSettings()
    } catch (err: unknown) {
      saveFailed = true
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  function handleExpirationPresetSelected (e: CustomEvent<string>): void {
    expirationPreset = e.detail
    expTime =
      expirationPreset === 'never'
        ? -1
        : expirationPreset === 'custom'
          ? expTime !== undefined && expTime > 0
            ? expTime
            : INVITE_SETTINGS_DEFAULT_EXPIRATION_HOURS
          : Number(expirationPreset)
    void autoSaveIfValid()
  }

  function handleLimitPresetSelected (e: CustomEvent<string>): void {
    limitPreset = e.detail
    limit = limitPreset === 'unlimited' ? -1 : limitPreset === 'once' ? 1 : limit !== undefined && limit > 0 ? limit : 1
    void autoSaveIfValid()
  }

  function handleExpTimeChange (): void {
    void autoSaveIfValid()
  }

  function handleLimitChange (): void {
    void autoSaveIfValid()
  }

  function handleDefaultInviteRoleSelected (e: CustomEvent<AccountRole>): void {
    defaultInviteRole = e.detail
    void autoSaveIfValid()
  }

  function handleGeneratorRolesSelected (e: CustomEvent<AccountRole[] | undefined>): void {
    if (e.detail != null) {
      inviteLinkGeneratorRoles = [...e.detail]
    }
    void autoSaveIfValid()
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={setting.icon.InviteSettings} label={settingRes.string.InviteSettings} size={'large'} isCurrent />
  </Header>
  <div class="hulyComponent-content__column content">
    {#if loading}
      <div class="w-full h-full flex-col-center justify-center">
        <Loading />
      </div>
    {:else}
      <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
        <div class="hulyComponent-content w-full">
          <SettingsCardsLayout columns={1}>
            <WorkspaceInvites />
            <SettingsCard label={settingRes.string.InviteSettings}>
              <div class="flex-col flex-gap-4">
                <div class="field items-center flex-gap-4">
                  <Label label={settingRes.string.Role} />
                  <div class="flex-grow min-w-0" style:flex-basis="0">
                    <UserRoleSelect
                      selected={defaultInviteRole}
                      size="small"
                      minWidth="100%"
                      on:selected={handleDefaultInviteRoleSelected}
                    />
                  </div>
                </div>
                <div class="field items-center flex-gap-4">
                  <Label label={settingRes.string.InviteExpiration} />
                  <div class="flex-row-center flex-gap-2">
                    <div class="flex-grow min-w-0" style:flex-basis="0">
                      <DropdownLabelsIntl
                        label={settingRes.string.InviteExpiration}
                        items={expirationItems}
                        selected={expirationPreset}
                        size="small"
                        width="100%"
                        justify="left"
                        on:selected={handleExpirationPresetSelected}
                      />
                    </div>
                    {#if expirationPreset === 'custom'}
                      <div class="flex-no-shrink min-w-0" style:width="3.75rem">
                        <EditBox
                          placeholder={login.string.LinkValidHours}
                          format="number"
                          kind="default"
                          minValue={1}
                          maxDigitsAfterPoint={0}
                          bind:value={expTime}
                          focusable
                          on:change={handleExpTimeChange}
                        />
                      </div>
                      <span class="text-md content-color"><Label label={settingRes.string.InviteHoursUnit} /></span>
                    {/if}
                  </div>
                </div>
                <div class="field items-center flex-gap-4">
                  <Label label={settingRes.string.InviteUseLimit} />
                  <div class="flex-row-center flex-gap-2">
                    <div class="flex-grow min-w-0" style:flex-basis="0">
                      <DropdownLabelsIntl
                        label={settingRes.string.InviteUseLimit}
                        items={limitItems}
                        selected={limitPreset}
                        size="small"
                        width="100%"
                        justify="left"
                        on:selected={handleLimitPresetSelected}
                      />
                    </div>
                    {#if limitPreset === 'custom'}
                      <div class="flex-no-shrink min-w-0" style:width="3.75rem">
                        <EditBox
                          placeholder={login.string.InviteLimit}
                          format="number"
                          kind="default"
                          minValue={1}
                          maxDigitsAfterPoint={0}
                          bind:value={limit}
                          focusable
                          on:change={handleLimitChange}
                        />
                      </div>
                    {/if}
                  </div>
                </div>
                {#if inviteExpirationInvalid || inviteLimitInvalid}
                  <Notice label={settingRes.string.InvitePositiveNumber} kind="error" />
                {/if}
                {#if saveFailed}
                  <div role="alert"><Notice label={settingRes.string.InviteSettingsSaveFailed} kind="error" /></div>
                {/if}
              </div>
            </SettingsCard>

            {#if canManagePermissions}
              <SettingsCard label={settingRes.string.Permissions}>
                <div class="flex-between flex-gap-4">
                  <Label label={settingRes.string.InviteLinkGeneratorRoles} />
                  <DropdownLabels
                    label={settingRes.string.InviteLinkGeneratorRoles}
                    items={inviteLinkGeneratorRolesItems}
                    selected={inviteLinkGeneratorRoles}
                    multiselect
                    autoSelect={false}
                    kind={'regular'}
                    size={'medium'}
                    on:selected={handleGeneratorRolesSelected}
                  />
                </div>
              </SettingsCard>
            {/if}
          </SettingsCardsLayout>
        </div>
      </Scroller>
    {/if}
  </div>
</div>

<style lang="scss">
  .field {
    display: grid;
    grid-template-columns: minmax(6rem, 1fr) minmax(0, 2fr);
  }
</style>
