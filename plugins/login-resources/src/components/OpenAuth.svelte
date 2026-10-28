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
  import { getMetadata } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import ui, {
    Button,
    getCurrentLocation,
    Icon,
    IconArrowRight,
    IconCheck,
    IconLink,
    Label,
    Loading,
    navigate
  } from '@hcengineering/ui'
  import { loginId } from '@hcengineering/login'
  import { logIn } from '@hcengineering/workbench'
  import login from '../plugin'
  import { doLoginNavigate, getAccount } from '../utils'
  import { clearOAuthRequest, rememberOAuthRequest } from '../oauth'
  import LoginForm from './LoginForm.svelte'
  import ProvidersOnlyForm from './ProvidersOnlyForm.svelte'

  const request = getCurrentLocation().query?.request
  const issuerUrl = getMetadata(login.metadata.OAuthURL)?.replace(/\/$/, '')
  const useOTP = getMetadata(presentation.metadata.MailUrl) != null && getMetadata(presentation.metadata.MailUrl) !== ''
  const localLoginHidden = getMetadata(login.metadata.HideLocalLogin) ?? false
  let loading = true
  let submitting = false
  let failed = false
  let identity: LoginInfo | null = null
  let clientName = ''
  let redirectOrigins: string[] = []

  async function load (): Promise<void> {
    try {
      if (
        issuerUrl === undefined ||
        issuerUrl === '' ||
        typeof request !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(request)
      ) {
        throw new Error('Invalid OAuth request')
      }
      const response = await fetch(`${issuerUrl}/requests/${encodeURIComponent(request)}`)
      if (!response.ok) throw new Error('OAuth request expired')
      const details: unknown = await response.json()
      if (
        typeof details !== 'object' ||
        details === null ||
        !('clientName' in details) ||
        typeof details.clientName !== 'string' ||
        !('redirectOrigins' in details) ||
        !Array.isArray(details.redirectOrigins) ||
        !details.redirectOrigins.every((origin) => typeof origin === 'string')
      ) {
        throw new Error('Invalid OAuth request details')
      }
      clientName = details.clientName
      redirectOrigins = details.redirectOrigins
      rememberOAuthRequest(request)
      identity = await getAccount(false)
    } catch {
      failed = true
    } finally {
      loading = false
    }
  }

  async function authorize (): Promise<void> {
    if (submitting || identity?.token === undefined || issuerUrl === undefined || typeof request !== 'string') return
    submitting = true
    try {
      const response = await fetch(`${issuerUrl}/requests/${encodeURIComponent(request)}/complete`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${identity.token}` }
      })
      if (!response.ok) throw new Error('OAuth authorization failed')
      // The destination is built exclusively from trusted installation configuration, never query input.
      clearOAuthRequest()
      window.location.assign(`${issuerUrl}/tracex/complete?request=${encodeURIComponent(request)}`)
    } catch {
      failed = true
      submitting = false
    }
  }

  async function handleLogin (result: LoginInfo | null): Promise<void> {
    try {
      if (result?.token !== undefined && result.tfaRequired !== true) {
        await logIn(result)
        identity = result
      } else {
        await doLoginNavigate(result, () => {})
      }
    } catch {
      failed = true
    }
  }

  function cancel (): void {
    clearOAuthRequest()
    if (issuerUrl !== undefined && typeof request === 'string' && !failed) {
      window.location.assign(`${issuerUrl}/tracex/cancel?request=${encodeURIComponent(request)}`)
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
  <Button label={login.string.Close} on:click={cancel} />
{:else}
  <div class="authorization flex-col" data-id="mcp-authorization">
    <div class="flex-col flex-gap-4">
      <div class="authorization-icon flex-center rounded-lg background-bg-accent-color">
        <Icon icon={IconLink} size="medium" />
      </div>
      <h1 class="authorization-title font-semi-bold caption-color">
        <Label label={login.string.AuthorizeApplication} params={{ application: clientName }} />
      </h1>
      <div class="authorization-details flex-col flex-gap-1 text-md">
        <span><Label label={login.string.SignedInAs} params={{ name: identity.name ?? identity.account }} /></span>
        <span class="content-dark-color">{issuerUrl === undefined ? '' : new URL(issuerUrl).host}</span>
      </div>
    </div>
    <div
      class="authorization-permissions flex-row-top flex-gap-3 p-4 rounded-lg border-divider-color background-bg-accent-color"
    >
      <div class="flex-no-shrink mt-0-5 caption-color"><Icon icon={IconCheck} size="small" /></div>
      <div class="min-w-0"><Label label={login.string.AuthorizeApplicationDescription} /></div>
    </div>
    <div class="flex-col flex-gap-2 content-dark-color text-sm">
      {#each redirectOrigins as origin}
        <div class="flex-row-top flex-gap-2">
          <div class="flex-no-shrink"><Icon icon={IconArrowRight} size="small" /></div>
          <span class="authorization-origin">{origin}</span>
        </div>
      {/each}
    </div>
    <div class="authorization-actions top-divider pt-4">
      <Button label={ui.string.Cancel} size="large" shape="round2" dataId="mcp-cancel" on:click={cancel} />
      <Button
        label={login.string.Proceed}
        kind="contrast"
        size="large"
        shape="round2"
        dataId="mcp-authorize"
        on:click={() => {
          void authorize()
        }}
      />
    </div>
  </div>
{/if}

<style lang="scss">
  .authorization {
    gap: var(--spacing-3);
    padding: var(--spacing-2) var(--spacing-4);
    color: var(--theme-content-color);
  }

  .authorization-icon {
    width: var(--spacing-6);
    height: var(--spacing-6);
    color: var(--theme-caption-color);
  }

  .authorization-title {
    margin: 0;
    font-size: 1.25rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .authorization-details {
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .authorization-permissions {
    line-height: 1.6;
  }

  .authorization-origin {
    overflow-wrap: anywhere;
  }

  .authorization-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--spacing-1);
  }

  @media (max-width: 480px) {
    .authorization {
      padding: var(--spacing-2);
    }
  }
</style>
