<!--
// Copyright © 2022-2024 Hardcore Engineering Inc.
// Copyright © 2026 TraceX
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
  import { AvatarType } from '@hcengineering/contact'
  import type { ApiKey } from '@hcengineering/account-client'
  import { EditableAvatar, getAccountClient } from '@hcengineering/contact-resources'
  import core, { Configuration, WorkspaceAccountPermission } from '@hcengineering/core'
  import { loginId } from '@hcengineering/login'
  import { translateCB } from '@hcengineering/platform'
  import { copyTextToClipboard, createQuery, getClient, MessageBox } from '@hcengineering/presentation'
  import { WorkspaceSetting } from '@hcengineering/setting'
  import view from '@hcengineering/view'
  import {
    Breadcrumb,
    Button,
    deviceOptionsStore as deviceInfo,
    DropdownLabels,
    type DropdownTextItem,
    EditBox,
    getLocalWeekStart,
    getWeekDayNames,
    hasLocalWeekStart,
    Header,
    IconCheckmark,
    IconClose,
    IconDelete,
    IconEdit,
    Label,
    Loading,
    navigate,
    Scroller,
    showPopup,
    themeStore,
    Toggle
  } from '@hcengineering/ui'
  import settingsRes from '../plugin'
  import ApiKeyPopup from './ApiTokenPopup.svelte'
  import CreateApiKey from './CreateApiKey.svelte'
  import WorkspacePermissionEditor from './WorkspacePermissionEditor.svelte'

  let loading = true
  let isEditingName = false
  let oldName: string
  let name: string = ''
  let workspaceUrl = ''
  let workspaceId = ''
  let workspaceIdCopied = false
  let passwordAgingRule: number | undefined = undefined
  let apiKeys: ApiKey[] = []

  const accountClient = getAccountClient()
  const disabledSet = ['\n', '<', '>', '/', '\\']

  $: editNameDisabled =
    isEditingName &&
    (name.trim().length > 40 ||
      name.trim() === oldName ||
      name.trim() === '' ||
      disabledSet.some((it) => name.includes(it)))

  void loadWorkspaceName()
  void loadApiKeys()

  async function loadWorkspaceName (): Promise<void> {
    const res = await accountClient.getWorkspaceInfo()

    workspaceUrl = res.url
    workspaceId = res.uuid
    oldName = res.name
    name = oldName
    passwordAgingRule = res.passwordAgingRule ?? undefined
    loading = false
  }

  async function handleEditName (): Promise<void> {
    if (editNameDisabled) {
      return
    }

    if (isEditingName) {
      await accountClient.updateWorkspaceName(name.trim())
    }

    isEditingName = !isEditingName
  }

  function handleCancelEditName (): void {
    name = oldName
    isEditingName = false
  }

  async function handleDelete (): Promise<void> {
    showPopup(MessageBox, {
      label: settingsRes.string.DeleteWorkspace,
      message: settingsRes.string.DeleteWorkspaceConfirm,
      dangerous: true,
      action: async () => {
        await accountClient.deleteWorkspace()
        navigate({ path: [loginId] })
      }
    })
  }

  // Avatar
  let avatarEditor: EditableAvatar
  let workspaceSettings: WorkspaceSetting | undefined = undefined

  const client = getClient()
  void client.findOne(settingsRes.class.WorkspaceSetting, {}).then((r) => {
    workspaceSettings = r
  })

  async function handleAvatarDone (): Promise<void> {
    const existing = await client.findOne(settingsRes.class.WorkspaceSetting, { _id: settingsRes.ids.WorkspaceSetting })
    if (existing !== undefined) {
      const avatar = await avatarEditor.createAvatar()
      // Remove old avatar if changed
      if (existing.icon != null && existing.icon !== avatar.avatar) {
        await avatarEditor.removeAvatar(existing.icon)
      }

      const icon = avatar.avatarType === AvatarType.IMAGE ? avatar.avatar : null
      await client.diffUpdate(existing, { icon })
    } else {
      const avatar = await avatarEditor.createAvatar()

      await client.createDoc(
        settingsRes.class.WorkspaceSetting,
        core.space.Workspace,
        { icon: avatar.avatar },
        settingsRes.ids.WorkspaceSetting
      )
    }
  }

  const permissionConfigurationQuery = createQuery()
  let disablePermissionsConfiguration: Configuration | undefined = undefined
  $: arePermissionsDisabled = disablePermissionsConfiguration?.enabled ?? false

  $: permissionConfigurationQuery.query(
    core.class.Configuration,
    { _id: settingsRes.ids.DisablePermissionsConfiguration },
    (result) => {
      disablePermissionsConfiguration = result[0]
    }
  )

  async function changePasswordAgingRules (val: number | undefined): Promise<void> {
    passwordAgingRule = val !== undefined ? Math.max(val, 1) : undefined
    await accountClient.updatePasswordAgingRule(passwordAgingRule)
  }

  async function loadApiKeys (): Promise<void> {
    apiKeys = await accountClient.getApiKeys()
  }

  async function copyWorkspaceId (): Promise<void> {
    await copyTextToClipboard(workspaceId)
    workspaceIdCopied = true
    setTimeout(() => {
      workspaceIdCopied = false
    }, 1000)
  }

  function handleCreateApiKey (): void {
    showPopup(CreateApiKey, {}, 'top', async (title?: string) => {
      if (title === undefined) return
      const { key } = await accountClient.createApiKey(title)
      showPopup(ApiKeyPopup, { apiKey: key })
      await loadApiKeys()
    })
  }

  function handleRevokeApiKey (apiKey: ApiKey): void {
    showPopup(MessageBox, {
      label: settingsRes.string.ApiToken,
      message: settingsRes.string.RevokeApiKeyConfirm,
      params: { name: apiKey.name },
      dangerous: true,
      action: async () => {
        await accountClient.revokeApiKey(apiKey.id)
        await loadApiKeys()
      }
    })
  }

  function handleTogglePermissions (): void {
    const newState = !arePermissionsDisabled
    showPopup(MessageBox, {
      label: newState ? settingsRes.string.DisablePermissions : settingsRes.string.EnablePermissions,
      message: newState
        ? settingsRes.string.DisablePermissionsConfirmation
        : settingsRes.string.EnablePermissionsConfirmation,
      dangerous: true,
      action: async () => {
        if (disablePermissionsConfiguration === undefined) {
          await client.createDoc(
            core.class.Configuration,
            core.space.Workspace,
            { enabled: newState },
            settingsRes.ids.DisablePermissionsConfiguration
          )
        } else {
          await client.update(disablePermissionsConfiguration, { enabled: newState })
        }
      }
    })
  }

  const weekInfoFirstDay: number = getLocalWeekStart()
  const hasWeekInfo: boolean = hasLocalWeekStart()
  const weekNames = getWeekDayNames()
  let items: DropdownTextItem[] = []
  let selected: string

  $: translateCB(
    hasWeekInfo ? settingsRes.string.SystemSetupString : settingsRes.string.DefaultString,
    { day: weekNames?.get(weekInfoFirstDay)?.toLowerCase() ?? '' },
    $themeStore.language,
    (r) => {
      items = [
        { id: 'system', label: r },
        ...Array.from(weekNames.entries()).map((it) => ({ id: it[0].toString(), label: it[1] }))
      ]
      const savedFirstDayOfWeek = localStorage.getItem('firstDayOfWeek') ?? 'system'
      selected = items[savedFirstDayOfWeek === 'system' ? 0 : $deviceInfo.firstDayOfWeek + 1].id
    }
  )

  const onSelected = (e: CustomEvent<string>): void => {
    selected = e.detail
    localStorage.setItem('firstDayOfWeek', `${e.detail}`)
    $deviceInfo.firstDayOfWeek = e.detail === 'system' ? weekInfoFirstDay : (parseInt(e.detail, 10) ?? 1)
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={settingsRes.icon.Setting} label={settingsRes.string.WorkspaceSettings} size={'large'} isCurrent />
  </Header>
  <div class="hulyComponent-content__column content">
    {#if loading}
      <div class="w-full h-full flex-col-center justify-center">
        <Loading />
      </div>
    {:else}
      <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
        <div class="hulyComponent-content flex-col flex-gap-4">
          <div class="title"><Label label={settingsRes.string.Workspace} /></div>
          <div class="ws">
            <EditableAvatar
              person={{
                avatarType: workspaceSettings?.icon !== undefined ? AvatarType.IMAGE : AvatarType.COLOR,
                avatar: workspaceSettings?.icon
              }}
              size="medium"
              {name}
              bind:this={avatarEditor}
              on:done={handleAvatarDone}
              imageOnly
              lessCrop
            />
            <div class="editBox">
              <EditBox
                bind:value={name}
                placeholder={settingsRes.string.WorkspaceName}
                kind="ghost-large"
                disabled={!isEditingName}
              />
            </div>
            <Button
              icon={isEditingName ? IconCheckmark : IconEdit}
              kind="ghost"
              size="small"
              disabled={editNameDisabled}
              on:click={handleEditName}
            />
            {#if isEditingName}
              <Button icon={IconClose} kind="ghost" size="small" on:click={handleCancelEditName} />
            {/if}
          </div>

          <div class="flex-col flex-gap-4 mt-6">
            <div class="title"><Label label={settingsRes.string.PasswordAgingRule} /></div>
            <div class="flex-row-center flex-gap-4">
              <Label label={settingsRes.string.PasswordAgingRuleDescription} />
              <Toggle
                on={!!passwordAgingRule}
                on:change={(e) => {
                  if (e.detail === false) {
                    void changePasswordAgingRules(undefined)
                  } else {
                    void changePasswordAgingRules(30)
                  }
                }}
              />
              {#if passwordAgingRule}
                <div class="w-32">
                  <EditBox
                    format={'number'}
                    minValue={1}
                    maxDigitsAfterPoint={0}
                    bind:value={passwordAgingRule}
                    disabled={!passwordAgingRule}
                    on:change={() => changePasswordAgingRules(passwordAgingRule)}
                  />
                </div>
              {/if}
            </div>
          </div>

          <div class="flex-col flex-gap-4 mt-6">
            <div class="title"><Label label={settingsRes.string.Calendar} /></div>
            <div class="flex-row-center flex-gap-4">
              <Label label={settingsRes.string.StartOfTheWeek} />
              <DropdownLabels
                {items}
                kind={'regular'}
                size={'medium'}
                {selected}
                enableSearch={false}
                on:selected={onSelected}
              />
            </div>
          </div>

          <div class="flex-col flex-gap-4 mt-6">
            <div class="title"><Label label={settingsRes.string.AccessControl} /></div>
            <div class="w-32">
              <Button
                kind="regular"
                label={arePermissionsDisabled
                  ? settingsRes.string.EnablePermissions
                  : settingsRes.string.DisablePermissions}
                on:click={handleTogglePermissions}
              />
            </div>
          </div>

          <WorkspacePermissionEditor
            permission={WorkspaceAccountPermission.ImportDocument}
            label={settingsRes.string.ImportDocumentPermission}
            description={settingsRes.string.ImportDocumentDescription}
            allowGuests={true}
          />

          <div class="flex-col flex-gap-4 mt-6">
            <div class="title"><Label label={settingsRes.string.ApiAccess} /></div>
            {#if workspaceId !== ''}
              <div class="flex-row-center flex-gap-2">
                <span><Label label={settingsRes.string.WorkspaceId} />: {workspaceId}</span>
                <Button
                  label={workspaceIdCopied ? view.string.Copied : view.string.CopyToClipboard}
                  kind="ghost"
                  size="small"
                  on:click={copyWorkspaceId}
                />
              </div>
            {/if}
            <div class="w-32">
              <Button
                label={settingsRes.string.GenerateApiToken}
                kind="regular"
                disabled={workspaceUrl === ''}
                showTooltip={{ label: settingsRes.string.GenerateApiToken }}
                on:click={handleCreateApiKey}
              />
            </div>
            {#if apiKeys.length > 0}
              <div class="flex-col flex-gap-2">
                {#each apiKeys as apiKey (apiKey.id)}
                  <div class="flex-row-center flex-gap-2">
                    <span>
                      {apiKey.name}{apiKey.keySuffix !== undefined ? ` · …${apiKey.keySuffix}` : ''} · {new Date(
                        apiKey.createdOn
                      ).toLocaleString()}
                    </span>
                    <Button
                      icon={IconDelete}
                      kind="ghost"
                      size="small"
                      on:click={() => {
                        handleRevokeApiKey(apiKey)
                      }}
                    />
                  </div>
                {/each}
              </div>
            {/if}
          </div>

          <div class="flex-col flex-gap-4 mt-6">
            <div class="title"><Label label={settingsRes.string.DangerZone} /></div>
            <div class="w-32">
              <Button
                label={settingsRes.string.DeleteWorkspace}
                kind="dangerous"
                on:click={handleDelete}
                showTooltip={{ label: settingsRes.string.DeleteWorkspace }}
              />
            </div>
          </div>
        </div>
      </Scroller>
    {/if}
  </div>
</div>

<style lang="scss">
  .title {
    font-weight: 500;
    font-size: 1rem;
  }
  .ws {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .editBox {
    width: 16rem;
  }
</style>
