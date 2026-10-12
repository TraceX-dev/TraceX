<!--
// Copyright © 2022 Hardcore Engineering Inc.
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the 'License');
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import { Analytics } from '@hcengineering/analytics'
  import { copyTextToClipboard, createQuery } from '@hcengineering/presentation'
  import setting, { RoleCapability } from '@hcengineering/setting'
  import { getDefaultInviteRole, resolveInviteSettings } from '@hcengineering/setting-resources'
  import { getResource, type IntlString } from '@hcengineering/platform'
  import ui, {
    type AnySvelteComponent,
    type DropdownIntlItem,
    Button,
    DropdownLabelsIntl,
    EditBox,
    IconCopy,
    Label,
    ModernDialog,
    Notice,
    Toggle,
    showTooltipForDuration
  } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'

  import login from '../plugin'
  import { getInviteLink } from '../utils'

  export let role: AccountRole | undefined = undefined
  export let ignoreSettings: boolean = false

  const dispatch = createEventDispatcher()
  const query = createQuery()
  const defaultInviteRole = getDefaultInviteRole()
  const defaultSettings = resolveInviteSettings(undefined)
  const canConfigure = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer) && !ignoreSettings
  const requestedRole = role

  const expirationItems: DropdownIntlItem[] = [
    { id: '48', label: login.string.InviteHours, params: { hours: 48 } },
    { id: '168', label: login.string.InviteSevenDays },
    { id: 'never', label: login.string.NoExpiration },
    { id: 'custom', label: login.string.InviteCustom }
  ]
  const limitItems: DropdownIntlItem[] = [
    { id: 'unlimited', label: login.string.InviteUnlimitedUses },
    { id: 'once', label: login.string.InviteSingleUse },
    { id: 'custom', label: login.string.InviteCustom }
  ]
  const roleLabels: Record<AccountRole, IntlString> = {
    [AccountRole.ReadOnlyGuest]: login.string.InviteReadonlyGuest,
    [AccountRole.DocGuest]: login.string.InviteGuest,
    [AccountRole.Guest]: login.string.InviteGuest,
    [AccountRole.User]: login.string.InviteMember,
    [AccountRole.Maintainer]: login.string.InviteMaintainer,
    [AccountRole.Owner]: login.string.InviteOwner,
    [AccountRole.Admin]: login.string.InviteAdmin
  }

  let expirationPreset = String(defaultSettings.expirationTime)
  let customHours: number | undefined = defaultSettings.expirationTime
  let limitPreset = 'unlimited'
  let customLimit: number | undefined = 1
  let emailMask = ''
  let useWorkspaceSettings = !canConfigure && !ignoreSettings
  let hasWorkspaceSettings = false
  let workspaceSettings = defaultSettings
  let settingsInitialized = ignoreSettings
  let canGenerateInviteLinks = false
  let userRoleSelectComponent: AnySvelteComponent | undefined
  let link: string | undefined
  let loading = false
  let copying = false
  let error: IntlString | undefined
  let destroyed = false
  let dismissCopyTooltip: (() => void) | undefined

  $: expirationHours = useWorkspaceSettings
    ? workspaceSettings.expirationTime
    : expirationPreset === 'never'
      ? -1
      : expirationPreset === 'custom'
        ? customHours
        : Number(expirationPreset)
  $: useLimit = useWorkspaceSettings
    ? workspaceSettings.limit
    : limitPreset === 'unlimited'
      ? -1
      : limitPreset === 'once'
        ? 1
        : customLimit
  $: inviteRole = useWorkspaceSettings
    ? (requestedRole ?? workspaceSettings.defaultInviteRole)
    : (role ?? defaultInviteRole)
  $: expirationInvalid =
    expirationHours !== -1 &&
    (expirationHours === undefined || !Number.isInteger(expirationHours) || expirationHours < 1)
  $: limitInvalid = useLimit !== -1 && (useLimit === undefined || !Number.isInteger(useLimit) || useLimit < 1)
  $: canCreate = settingsInitialized && canGenerateInviteLinks && !expirationInvalid && !limitInvalid && !loading

  onMount(() => {
    if (!ignoreSettings) {
      query.query(setting.class.InviteSettings, {}, (set) => {
        if (settingsInitialized) return
        const state = resolveInviteSettings(set?.[0])
        hasWorkspaceSettings = set?.[0] !== undefined
        useWorkspaceSettings = hasWorkspaceSettings || !canConfigure
        workspaceSettings = state
        expirationPreset =
          state.expirationTime < 0
            ? 'never'
            : state.expirationTime === 48 || state.expirationTime === 168
              ? String(state.expirationTime)
              : 'custom'
        customHours = state.expirationTime < 0 ? defaultSettings.expirationTime : state.expirationTime
        limitPreset = state.noLimit ? 'unlimited' : state.limit === 1 ? 'once' : 'custom'
        customLimit = state.noLimit ? 1 : state.limit
        emailMask = state.emailMask
        role = role ?? state.defaultInviteRole
        settingsInitialized = true
      })
    }
    void initializeResources()
  })

  onDestroy(() => {
    destroyed = true
    dismissCopyTooltip?.()
  })

  async function initializeResources (): Promise<void> {
    try {
      const checkCapability = await getResource(setting.function.HasRoleCapability)
      canGenerateInviteLinks = await checkCapability(RoleCapability.GenerateInviteLink)
      if (canConfigure) {
        userRoleSelectComponent = await getResource(setting.component.UserRoleSelect)
      }
    } catch (err: unknown) {
      error = login.string.InviteLinkCreationFailed
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  async function createLink (): Promise<void> {
    if (loading || !canCreate || link !== undefined || expirationHours === undefined || useLimit === undefined) return
    loading = true
    error = undefined
    try {
      link = await getInviteLink(expirationHours, emailMask, useLimit, inviteRole)
    } catch (err: unknown) {
      error = login.string.InviteLinkCreationFailed
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      loading = false
    }
  }

  async function copy (event: MouseEvent): Promise<void> {
    if (link === undefined || copying) return
    const button = event.currentTarget
    if (!(button instanceof HTMLElement)) return
    copying = true
    error = undefined
    try {
      await copyTextToClipboard(link)
      if (!destroyed && button.isConnected) {
        dismissCopyTooltip?.()
        dismissCopyTooltip = showTooltipForDuration(login.string.Copied, button, 2000, 'top')
      }
    } catch (err: unknown) {
      error = login.string.InviteLinkCopyFailed
      Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      copying = false
    }
  }
</script>

<ModernDialog
  label={link === undefined ? login.string.CreateInviteLink : login.string.InviteLinkCreated}
  width="min(32rem, calc(100vw - 2rem))"
  isForm={false}
  isHeaderBorderHidden
  isFooterBorderHidden
  shadow
  on:close={() => dispatch('close')}
  on:changeContent
>
  <div class="flex-col" style:gap="1.25rem">
    {#if canConfigure && hasWorkspaceSettings && settingsInitialized && link === undefined}
      <div class="flex-between flex-gap-4">
        <label for="workspace-invite-settings">
          <Label label={login.string.UseWorkspaceInviteSettings} />
        </label>
        <Toggle
          inputId="workspace-invite-settings"
          bind:on={useWorkspaceSettings}
          disabled={loading}
          on:change={() => {
            error = undefined
          }}
        />
      </div>
    {/if}

    {#if useWorkspaceSettings}
      <div class="summary flex-col flex-gap-2 p-4 border-radius-2">
        <div class="flex-row-center flex-wrap flex-gap-2 caption-color" style:line-height="1.5">
          {#if !settingsInitialized}
            <Label label={login.string.LoadingAccount} />
          {:else}
            <span><Label label={roleLabels[inviteRole]} /></span>
            <span aria-hidden="true">·</span>
            <span>
              {#if expirationHours === -1}
                <Label label={login.string.NoExpiration} />
              {:else if !expirationInvalid}
                <Label label={login.string.InviteHours} params={{ hours: expirationHours }} />
              {:else}
                <Label label={login.string.InviteExpiration} />
              {/if}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {#if useLimit === -1}
                <Label label={login.string.InviteUnlimitedUses} />
              {:else if !limitInvalid}
                <Label label={login.string.InviteUses} params={{ count: useLimit }} />
              {:else}
                <Label label={login.string.InviteUseLimit} />
              {/if}
            </span>
          {/if}
        </div>
      </div>
    {/if}

    {#if link !== undefined}
      <div class="flex-col flex-gap-2">
        <Label label={login.string.InviteLinkLabel} />
        <div class="flex-row-center flex-gap-2" data-id="invite-link">
          <div class="flex-grow min-w-0" style:flex-basis="0">
            <EditBox value={link} format="text" kind="default" disabled />
          </div>
          <Button icon={IconCopy} size="medium" kind="ghost" loading={copying} disabled={copying} on:click={copy} />
        </div>
      </div>
    {:else if canConfigure && settingsInitialized && !useWorkspaceSettings}
      <div class="flex-col flex-gap-4">
        {#if userRoleSelectComponent}
          <div class="field items-center flex-gap-4">
            <Label label={login.string.InviteRole} />
            <div class="flex-row-center flex-gap-2">
              <div class="flex-grow min-w-0" style:flex-basis="0">
                <svelte:component
                  this={userRoleSelectComponent}
                  selected={role ?? defaultInviteRole}
                  disabled={loading}
                  size="small"
                  minWidth="100%"
                  on:selected={(event) => {
                    role = event.detail
                    error = undefined
                  }}
                />
              </div>
            </div>
          </div>
        {/if}
        <div class="field items-center flex-gap-4">
          <Label label={login.string.InviteExpiration} />
          <div class="flex-row-center flex-gap-2">
            <div class="flex-grow min-w-0" style:flex-basis="0">
              <DropdownLabelsIntl
                label={login.string.InviteExpiration}
                items={expirationItems}
                selected={expirationPreset}
                size="small"
                width="100%"
                justify="left"
                disabled={loading}
                on:selected={(event) => {
                  expirationPreset = event.detail
                  error = undefined
                }}
              />
            </div>
            {#if expirationPreset === 'custom'}
              <div class="flex-no-shrink min-w-0" style:width="3.75rem">
                <EditBox
                  placeholder={login.string.LinkValidHours}
                  bind:value={customHours}
                  format="number"
                  kind="default"
                  minValue={1}
                  maxDigitsAfterPoint={0}
                  disabled={loading}
                  focusable
                  on:input={() => {
                    error = undefined
                  }}
                />
              </div>
              <span class="text-md content-color"><Label label={login.string.InviteHoursUnit} /></span>
            {/if}
          </div>
        </div>
        <div class="field items-center flex-gap-4">
          <Label label={login.string.InviteUseLimit} />
          <div class="flex-row-center flex-gap-2">
            <div class="flex-grow min-w-0" style:flex-basis="0">
              <DropdownLabelsIntl
                label={login.string.InviteUseLimit}
                items={limitItems}
                selected={limitPreset}
                size="small"
                width="100%"
                justify="left"
                disabled={loading}
                on:selected={(event) => {
                  limitPreset = event.detail
                  error = undefined
                }}
              />
            </div>
            {#if limitPreset === 'custom'}
              <div class="flex-no-shrink min-w-0" style:width="3.75rem">
                <EditBox
                  placeholder={login.string.InviteLimit}
                  bind:value={customLimit}
                  format="number"
                  kind="default"
                  minValue={1}
                  maxDigitsAfterPoint={0}
                  disabled={loading}
                  focusable
                  on:input={() => {
                    error = undefined
                  }}
                />
              </div>
            {/if}
          </div>
        </div>
      </div>
    {:else if !settingsInitialized}
      <Label label={login.string.LoadingAccount} />
    {/if}
    {#if link === undefined && settingsInitialized && (expirationInvalid || limitInvalid)}
      <Notice label={login.string.InvitePositiveNumber} kind="error" />
    {/if}
    {#if error !== undefined}
      <div role="alert"><Notice label={error} kind="error" /></div>
    {/if}
  </div>

  <svelte:fragment slot="footerButtons">
    {#if link === undefined}
      <Button label={ui.string.Cancel} size="medium" on:click={() => dispatch('close')} />
      <Button
        label={login.string.CreateInviteLink}
        size="medium"
        kind="primary"
        disabled={!canCreate}
        {loading}
        on:click={createLink}
      />
    {:else}
      <Button label={login.string.Close} size="medium" on:click={() => dispatch('close')} />
      <Button
        label={login.string.CopyInviteLink}
        icon={IconCopy}
        size="medium"
        kind="primary"
        loading={copying}
        disabled={copying}
        on:click={copy}
      />
    {/if}
  </svelte:fragment>
</ModernDialog>

<style lang="scss">
  .summary {
    border: 1px solid var(--theme-dialog-border-color);
  }

  .field {
    display: grid;
    grid-template-columns: minmax(6rem, 1fr) minmax(0, 2fr);
  }
</style>
