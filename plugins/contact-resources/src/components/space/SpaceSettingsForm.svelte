<!--
//
// Copyright © 2022-2025 Hardcore Engineering Inc.
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
  import { Analytics } from '@hcengineering/analytics'
  import core, {
    AccountRole,
    getCurrentAccount,
    hasAccountRole,
    notEmpty,
    readOnlyGuestAccountUuid,
    setWorkspaceGuestAutoJoinRoles,
    type AccountUuid,
    type Ref,
    type Role,
    type RolesAssignment
  } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import { SettingsGroup, SettingsRow, StateTag, StateType, Toggle } from '@hcengineering/ui'
  import view from '@hcengineering/view'
  import { createEventDispatcher, onMount } from 'svelte'

  import contact from '../../plugin'
  import { employeeRefByAccountUuidStore, getAccountClient, getAnonymousRefs } from '../../utils'
  import AccountArrayEditor from '../AccountArrayEditor.svelte'

  /**
   * Shared people/access/joining/roles sections of the space create/edit dialogs.
   * Place it inside a presentation `Card`; data, validation and saving stay with the dialog.
   * Plugin specific rows (type, name, icon, …) go to the default slot and are rendered
   * in the leading group, before Owners and Members.
   * Optional settings (`autoJoin`, `autoJoinForRoles`, `restricted`) are shown only when bound.
   */

  export let owners: AccountUuid[]
  export let members: AccountUuid[]
  export let isPrivate: boolean
  export let autoJoin: boolean | undefined = undefined
  export let autoJoinForRoles: AccountRole[] | undefined = undefined
  export let restricted: boolean | undefined = undefined
  export let roles: Array<Pick<Role, '_id' | 'name'>> = []
  export let rolesAssignment: RolesAssignment | undefined = undefined

  export let readonly: boolean = false
  /** Overrides the default rule: a public space without members cannot be made private. */
  export let privateDisabled: boolean | undefined = undefined
  export let showAnonymousAccess: boolean = true
  export let ownersAllowGuests: boolean = false
  export let membersLabel: IntlString = core.string.Members

  export let privateToggleId: string | undefined = undefined
  export let autoJoinToggleId: string | undefined = undefined
  export let restrictedToggleId: string | undefined = undefined

  $: privateControlId = `${privateToggleId ?? 'space-private'}-input`
  const anonymousControlId = 'space-anonymous-access-input'
  $: restrictedControlId = `${restrictedToggleId ?? 'space-restricted'}-input`
  $: autoJoinControlId = `${autoJoinToggleId ?? 'space-auto-join'}-input`
  const guestAutoJoinControlId = 'space-guest-auto-join-input'

  const dispatch = createEventDispatcher<{ membersChange: AccountUuid[] }>()

  const canManageAnonymousAccess = hasAccountRole(getCurrentAccount(), AccountRole.Owner)
  let workspaceAllowsAnonymous = false
  let workspaceInfoLoaded = false

  onMount(() => {
    if (!showAnonymousAccess) return
    getAccountClient()
      .getWorkspaceInfo()
      .then((info) => {
        workspaceAllowsAnonymous = info.allowReadOnlyGuest ?? false
      })
      .catch((err) => {
        Analytics.handleError(err as Error)
      })
      .finally(() => {
        workspaceInfoLoaded = true
      })
  })

  $: anonymousRefs = getAnonymousRefs($employeeRefByAccountUuidStore)
  $: ownersExcludeItems = getAnonymousRefs($employeeRefByAccountUuidStore, owners)
  $: visibleMembers = members.filter((m) => m !== readOnlyGuestAccountUuid)
  $: membersPersons = visibleMembers.map((m) => $employeeRefByAccountUuidStore.get(m)).filter(notEmpty)

  $: isPrivateDisabled = readonly || (privateDisabled ?? (!isPrivate && members.length === 0))

  $: anonymousAccess = members.includes(readOnlyGuestAccountUuid)
  // A leftover anonymous member can still be removed when the workspace switch is off.
  $: anonymousDisabled =
    readonly || !canManageAnonymousAccess || !workspaceInfoLoaded || (!workspaceAllowsAnonymous && !anonymousAccess)
  $: workspaceAnonymousOff = workspaceInfoLoaded && !workspaceAllowsAnonymous
  // When the workspace switch is off, that is the only thing worth saying in the tooltip.
  $: anonymousDescription = workspaceAnonymousOff
    ? contact.string.AnonymousGuestAccessWorkspaceOffNote
    : contact.string.AnonymousGuestAccessDescr
  $: anonymousNote =
    !workspaceAnonymousOff && !canManageAnonymousAccess ? contact.string.AnonymousGuestAccessOwnerOnlyNote : undefined

  $: guestAutoJoin = autoJoinForRoles?.includes(AccountRole.Guest) ?? false
  $: showMembership = autoJoin !== undefined || autoJoinForRoles !== undefined

  function removeFromRoles (removed: Set<AccountUuid>): void {
    if (removed.size === 0 || rolesAssignment === undefined) return
    for (const [key, value] of Object.entries(rolesAssignment)) {
      rolesAssignment[key as Ref<Role>] = value != null ? value.filter((m) => !removed.has(m)) : undefined
    }
  }

  function setMembers (newMembers: AccountUuid[]): void {
    const newMembersSet = new Set(newMembers)
    removeFromRoles(new Set(members.filter((m) => !newMembersSet.has(m))))
    members = newMembers
    dispatch('membersChange', newMembers)
  }

  function handleOwnersChanged (newOwners: AccountUuid[]): void {
    owners = newOwners
    members = Array.from(new Set([...members, ...newOwners]))
  }

  function handleMembersChanged (newVisibleMembers: AccountUuid[]): void {
    setMembers(anonymousAccess ? [...newVisibleMembers, readOnlyGuestAccountUuid] : newVisibleMembers)
  }

  function setAnonymousAccess (enabled: boolean): void {
    if (anonymousDisabled || enabled === anonymousAccess) return
    setMembers(enabled ? [...members, readOnlyGuestAccountUuid] : members.filter((m) => m !== readOnlyGuestAccountUuid))
  }

  function setGuestAutoJoin (enabled: boolean): void {
    autoJoinForRoles = setWorkspaceGuestAutoJoinRoles(autoJoinForRoles ?? [], enabled)
  }

  function handleRoleAssignmentChanged (roleId: Ref<Role>, newMembers: AccountUuid[]): void {
    rolesAssignment = { ...(rolesAssignment ?? {}), [roleId]: newMembers }
  }
</script>

<SettingsGroup dataId={'space-settings-general'}>
  <slot />

  <SettingsRow label={core.string.Owners}>
    <AccountArrayEditor
      value={owners}
      excludeItems={ownersExcludeItems}
      label={core.string.Owners}
      allowGuests={ownersAllowGuests}
      onChange={handleOwnersChanged}
      {readonly}
      kind={'regular'}
      size={'large'}
    />
  </SettingsRow>

  <SettingsRow label={membersLabel}>
    <AccountArrayEditor
      value={visibleMembers}
      excludeItems={anonymousRefs}
      label={membersLabel}
      allowGuests
      onChange={handleMembersChanged}
      {readonly}
      kind={'regular'}
      size={'large'}
    />
  </SettingsRow>
</SettingsGroup>

<SettingsGroup label={contact.string.SpaceAccessGroup} dataId={'space-settings-access'}>
  <SettingsRow
    label={presentation.string.MakePrivate}
    description={presentation.string.MakePrivateDescription}
    disabled={isPrivateDisabled}
    clickableLabel
    controlId={privateControlId}
  >
    <Toggle
      id={privateToggleId}
      inputId={privateControlId}
      ariaLabelledBy={`${privateControlId}-label`}
      ariaDescribedBy={`${privateControlId}-description`}
      bind:on={isPrivate}
      disabled={isPrivateDisabled}
    />
  </SettingsRow>

  {#if showAnonymousAccess}
    <SettingsRow
      label={contact.string.AnonymousGuestAccess}
      description={anonymousDescription}
      note={anonymousNote}
      disabled={anonymousDisabled}
      clickableLabel
      controlId={anonymousControlId}
      dataId={'space-anonymous-access'}
    >
      <svelte:fragment slot="badge">
        {#if anonymousAccess}
          <StateTag type={StateType.Positive} label={contact.string.PublicBadge} />
        {/if}
      </svelte:fragment>
      <Toggle
        inputId={anonymousControlId}
        ariaLabelledBy={`${anonymousControlId}-label`}
        ariaDescribedBy={`${anonymousControlId}-description`}
        on={anonymousAccess}
        disabled={anonymousDisabled}
        on:change={(ev) => {
          setAnonymousAccess(ev.detail)
        }}
      />
    </SettingsRow>
  {/if}

  {#if restricted !== undefined}
    <SettingsRow
      label={core.string.RBAC}
      description={core.string.RBACDescr}
      disabled={readonly}
      clickableLabel
      controlId={restrictedControlId}
    >
      <Toggle
        id={restrictedToggleId}
        inputId={restrictedControlId}
        ariaLabelledBy={`${restrictedControlId}-label`}
        ariaDescribedBy={`${restrictedControlId}-description`}
        bind:on={restricted}
        disabled={readonly}
      />
    </SettingsRow>
  {/if}
</SettingsGroup>

{#if showMembership}
  <SettingsGroup label={contact.string.SpaceMembershipGroup} dataId={'space-settings-membership'}>
    {#if autoJoin !== undefined}
      <SettingsRow
        label={core.string.AutoJoin}
        description={core.string.AutoJoinDescr}
        disabled={readonly}
        clickableLabel
        controlId={autoJoinControlId}
      >
        <Toggle
          id={autoJoinToggleId}
          inputId={autoJoinControlId}
          ariaLabelledBy={`${autoJoinControlId}-label`}
          ariaDescribedBy={`${autoJoinControlId}-description`}
          bind:on={autoJoin}
          disabled={readonly}
        />
      </SettingsRow>
    {/if}

    {#if autoJoinForRoles !== undefined}
      <SettingsRow
        label={core.string.AutoJoinGuests}
        description={core.string.AutoJoinGuestsDescr}
        disabled={readonly}
        clickableLabel
        controlId={guestAutoJoinControlId}
      >
        <Toggle
          inputId={guestAutoJoinControlId}
          ariaLabelledBy={`${guestAutoJoinControlId}-label`}
          ariaDescribedBy={`${guestAutoJoinControlId}-description`}
          on={guestAutoJoin}
          disabled={readonly}
          on:change={(ev) => {
            setGuestAutoJoin(ev.detail)
          }}
        />
      </SettingsRow>
    {/if}
  </SettingsGroup>
{/if}

{#if roles.length > 0}
  <SettingsGroup label={core.string.Roles} dataId={'space-settings-roles'}>
    {#each roles as role (role._id)}
      <SettingsRow label={view.string.RoleLabel} labelParams={{ role: role.name }}>
        <AccountArrayEditor
          value={rolesAssignment?.[role._id] ?? []}
          label={membersLabel}
          includeItems={membersPersons}
          readonly={readonly || membersPersons.length === 0}
          onChange={(refs) => {
            handleRoleAssignmentChanged(role._id, refs)
          }}
          kind={'regular'}
          size={'large'}
        />
      </SettingsRow>
    {/each}
  </SettingsGroup>
{/if}

<slot name="groups" />
