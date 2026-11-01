<!--
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
  import { onMount } from 'svelte'
  import { type LoginInfo } from '@hcengineering/account-client'
  import { getClient as getOpenAuthClient, type OAuthWorkspace } from '@hcengineering/openauth-client'
  import { getMetadata } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import ui, {
    Button,
    DropdownLabels,
    getCurrentLocation,
    Icon,
    IconCheckCircle,
    Label,
    Loading,
    ModernCheckbox,
    type DropdownTextItem,
    navigate
  } from '@hcengineering/ui'
  import { loginId } from '@hcengineering/login'
  import { logIn, logOut } from '@hcengineering/workbench'
  import login from '../plugin'
  import { doLoginNavigate, getAccount, getAccountDisplayName } from '../utils'
  import { clearOAuthRequest, getPreferredOAuthWorkspace, rememberOAuthRequest } from '../oauth'
  import LoginForm from './LoginForm.svelte'
  import ProvidersOnlyForm from './ProvidersOnlyForm.svelte'

  const request = getCurrentLocation().query?.request
  const issuerUrl = getMetadata(login.metadata.OAuthURL)?.replace(/\/$/, '')
  const client = issuerUrl === undefined || issuerUrl === '' ? undefined : getOpenAuthClient(issuerUrl)
  const useOTP = getMetadata(presentation.metadata.MailUrl) != null && getMetadata(presentation.metadata.MailUrl) !== ''
  const localLoginHidden = getMetadata(login.metadata.HideLocalLogin) ?? false
  let loading = true
  let submitting = false
  let failed = false
  let identity: LoginInfo | null = null
  let clientName = ''
  let workspaces: OAuthWorkspace[] = []
  let workspaceItems: DropdownTextItem[] = []
  let selectedWorkspace: string | undefined
  let allWorkspaces = false

  $: workspaceItems = workspaces.map((workspace) => ({
    id: workspace.id,
    label: `${workspace.name} (${workspace.url})`
  }))

  async function loadWorkspaces (token: string): Promise<void> {
    if (client === undefined || typeof request !== 'string') throw new Error('Invalid OAuth request')
    workspaces = await client.getWorkspaces(request, token)
    selectedWorkspace = getPreferredOAuthWorkspace(workspaces)?.id
  }

  async function load (): Promise<void> {
    try {
      if (client === undefined || typeof request !== 'string') {
        throw new Error('Invalid OAuth request')
      }
      const details = await client.getRequest(request)
      clientName = details.clientName
      rememberOAuthRequest(request)
      identity = await getAccount(false)
      if (identity?.token !== undefined) await loadWorkspaces(identity.token)
    } catch {
      failed = true
    } finally {
      loading = false
    }
  }

  async function authorize (): Promise<void> {
    if (
      submitting ||
      workspaces.length === 0 ||
      identity?.token === undefined ||
      client === undefined ||
      typeof request !== 'string'
    )
      return
    const workspaceId = allWorkspaces ? null : selectedWorkspace
    if (workspaceId === undefined) return
    submitting = true
    try {
      await client.completeRequest(request, identity.token, workspaceId)
      // The destination is built exclusively from trusted installation configuration, never query input.
      clearOAuthRequest()
      window.location.assign(client.getCompletionUrl(request))
    } catch {
      failed = true
      submitting = false
    }
  }

  async function handleLogin (result: LoginInfo | null): Promise<void> {
    try {
      if (result?.token !== undefined && result.tfaRequired !== true) {
        await logIn(result)
        await loadWorkspaces(result.token)
        identity = result
      } else {
        await doLoginNavigate(result, () => {})
      }
    } catch {
      failed = true
    }
  }

  async function changeAccount (): Promise<void> {
    if (submitting) return
    submitting = true
    try {
      await logOut()
      identity = null
      workspaces = []
      selectedWorkspace = undefined
      allWorkspaces = false
    } catch {
      failed = true
    } finally {
      submitting = false
    }
  }

  function cancel (): void {
    clearOAuthRequest()
    if (client !== undefined && typeof request === 'string' && !failed) {
      window.location.assign(client.getCancelUrl(request))
    } else {
      navigate({ path: [loginId, 'login'] })
    }
  }

  onMount(() => {
    void load()
  })
</script>

{#if loading || submitting}
  <Loading />
{:else if failed}
  <div class="flex-col flex-gap-4 p-6">
    <Label label={login.string.AuthorizationFailed} />
    <Button label={login.string.Close} on:click={cancel} />
  </div>
{:else if identity?.token === undefined}
  {#if localLoginHidden}
    <ProvidersOnlyForm />
  {:else}
    <LoginForm {useOTP} signUpDisabled={true} onLogin={handleLogin} />
  {/if}
{:else}
  <div class="authorization flex-col" data-id="mcp-authorization">
    <div class="flex-col flex-gap-2">
      <div class="fs-title overflow-label" data-id="mcp-account">{getAccountDisplayName(identity)}</div>
      <h1 class="authorization-title caption-color">
        <Label label={login.string.AuthorizeApplication} params={{ application: clientName }} />
      </h1>
    </div>

    {#if workspaces.length === 0}
      <div class="text-md content-dark-color" data-id="mcp-no-workspaces">
        <Label label={login.string.NoAvailableWorkspacesDescription} />
      </div>
    {:else}
      <div class="flex-col flex-gap-4" data-id="mcp-workspace-access">
        <div class="flex-col flex-gap-2">
          <span class="text-md font-medium caption-color"><Label label={login.string.SelectWorkspace} /></span>
          <DropdownLabels
            label={login.string.SelectWorkspace}
            placeholder={login.string.SelectWorkspace}
            items={workspaceItems}
            bind:selected={selectedWorkspace}
            autoSelect={false}
            showDropdownIcon
            disabled={allWorkspaces}
            enableSearch={workspaceItems.length > 5}
            kind="regular"
            size="x-large"
            width="100%"
            justify="left"
            dataId="mcp-workspace-select"
          />
        </div>
        <div data-id="mcp-all-workspaces">
          <ModernCheckbox bind:checked={allWorkspaces} labelIntl={login.string.AllAvailableWorkspaces} />
        </div>
      </div>

      <div class="authorization-permissions flex-row-top flex-gap-3 p-4 rounded-lg border-divider-color text-md">
        <div class="flex-no-shrink mt-0-5 caption-color"><Icon icon={IconCheckCircle} size="small" /></div>
        <div class="min-w-0">
          <Label
            label={allWorkspaces
              ? login.string.AuthorizeApplicationDescription
              : login.string.AuthorizeSelectedWorkspaceDescription}
          />
        </div>
      </div>
    {/if}

    <div class="flex-col flex-gap-2">
      {#if workspaces.length === 0}
        <Button
          label={login.string.ChangeAccount}
          kind="contrast"
          size="x-large"
          shape="round2"
          width="100%"
          dataId="mcp-change-account"
          on:click={() => {
            void changeAccount()
          }}
        />
      {:else}
        <Button
          label={login.string.Proceed}
          kind="contrast"
          size="x-large"
          shape="round2"
          width="100%"
          dataId="mcp-authorize"
          disabled={!allWorkspaces && selectedWorkspace === undefined}
          on:click={() => {
            void authorize()
          }}
        />
      {/if}
      <Button label={ui.string.Cancel} kind="link" size="large" width="100%" dataId="mcp-cancel" on:click={cancel} />
    </div>
  </div>
{/if}

<style lang="scss">
  .authorization {
    gap: var(--spacing-3);
    padding: var(--spacing-2) var(--spacing-4);
    color: var(--theme-content-color);
  }

  .authorization-title {
    margin: 0;
    font-size: 1.25rem;
    font-weight: 500;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .authorization-permissions {
    line-height: 1.6;
    background-color: var(--theme-bg-color);
  }

  @media (max-width: 480px) {
    .authorization {
      padding: var(--spacing-2);
    }
  }
</style>
