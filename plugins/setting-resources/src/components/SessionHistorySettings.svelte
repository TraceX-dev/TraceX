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
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { Analytics } from '@hcengineering/analytics'
  import type { SecurityLoginHistoryEvent } from '@hcengineering/account-client'
  import { MessageBox } from '@hcengineering/presentation'
  import { Button, Label, showPopup } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  import settingsRes from '../plugin'
  import { formatLocation, getShortUserAgent, maskIpAddress, shouldShowNotMeAction } from '../securityLoginActivity'
  import { getAccountClient } from '../utils'

  /** Narrow account client for security APIs (params match server contract). */
  const accountClient = getAccountClient() as unknown as {
    getMySecurityLoginHistory: (params?: { limit?: number, redact?: boolean }) => Promise<SecurityLoginHistoryEvent[]>
    reportSecurityLoginConcern: (params?: { loginEventId?: string }) => Promise<void>
  }
  const recentActivityLimit = 20
  let loginHistory: SecurityLoginHistoryEvent[] = []
  let loginHistoryLoading = false
  let loginHistoryLoaded = false
  let loginHistoryError = false

  async function loadRecentLoginActivity (): Promise<void> {
    loginHistoryLoading = true
    loginHistoryError = false
    try {
      loginHistory = await accountClient.getMySecurityLoginHistory({ limit: recentActivityLimit, redact: true })
      loginHistoryLoaded = true
    } catch (err: any) {
      loginHistoryError = true
      Analytics.handleError(err)
    } finally {
      loginHistoryLoading = false
    }
  }

  function handleNotMeAction (event?: SecurityLoginHistoryEvent): void {
    showPopup(MessageBox, {
      label: settingsRes.string.NotMeDialogTitle,
      message: settingsRes.string.NotMeDialogMessage,
      okLabel: settingsRes.string.NotMeDialogAction,
      action: async () => {
        await accountClient.reportSecurityLoginConcern(event !== undefined ? { loginEventId: event.id } : {})
        Analytics.handleEvent('Settings:RecentLoginActivityNotMe', {
          eventId: event?.id ?? 'header-action',
          authMethod: event?.authMethod ?? 'unknown'
        })
      }
    })
  }

  onMount(() => {
    void loadRecentLoginActivity()
  })
</script>

<div class="flex-col gap-2 max-w-240">
  <div class="flex-between">
    <h3 class="text-lg font-medium"><Label label={settingsRes.string.RecentLoginActivityTitle} /></h3>
    <Button
      label={settingsRes.string.NotMeAction}
      kind="secondary"
      on:click={() => {
        handleNotMeAction()
      }}
    />
  </div>
  {#if loginHistoryLoading}
    <div class="login-placeholder"><Label label={settingsRes.string.RecentLoginActivityLoading} /></div>
    <div class="login-placeholder"><Label label={settingsRes.string.RecentLoginActivityLoading} /></div>
    <div class="login-placeholder"><Label label={settingsRes.string.RecentLoginActivityLoading} /></div>
  {:else if loginHistoryError}
    <div class="login-empty">
      <div><Label label={settingsRes.string.RecentLoginActivityError} /></div>
      <Button
        label={settingsRes.string.RecentLoginActivityRetry}
        kind="secondary"
        on:click={() => {
          void loadRecentLoginActivity()
        }}
      />
    </div>
  {:else if loginHistoryLoaded && loginHistory.length === 0}
    <div class="login-empty"><Label label={settingsRes.string.RecentLoginActivityEmpty} /></div>
  {:else}
    <div class="flex-col gap-2">
      {#each loginHistory as loginEvent (loginEvent.id)}
        <div class="login-activity-row">
          <div class="flex-between gap-2">
            <span class="text-sm">{new Date(loginEvent.eventTime).toLocaleString()}</span>
            <span class:login-success={loginEvent.success} class:login-failed={!loginEvent.success}>
              {#if loginEvent.success}
                <Label label={settingsRes.string.RecentLoginActivitySuccess} />
              {:else}
                <Label label={settingsRes.string.RecentLoginActivityFailure} />
              {/if}
            </span>
          </div>
          <div class="text-sm flex-row-center gap-1">
            <Label label={settingsRes.string.RecentLoginActivityMethod} />: {loginEvent.authMethod}
          </div>
          <div class="text-sm flex-row-center gap-1">
            <Label label={settingsRes.string.RecentLoginActivityIp} />: {maskIpAddress(loginEvent.ip)}
          </div>
          <div class="text-sm flex-row-center gap-1">
            <Label label={settingsRes.string.RecentLoginActivityLocation} />:
            {formatLocation({ city: loginEvent.city, country: loginEvent.country })}
          </div>
          <div class="text-sm flex-row-center gap-1">
            <Label label={settingsRes.string.RecentLoginActivityDevice} />:
            {getShortUserAgent(loginEvent.userAgent)}
          </div>
          {#if shouldShowNotMeAction(loginEvent)}
            <div class="mt-2">
              <Button
                label={settingsRes.string.NotMeAction}
                kind="secondary"
                on:click={() => {
                  handleNotMeAction(loginEvent)
                }}
              />
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style lang="scss">
  .login-activity-row {
    border: 1px solid var(--theme-divider-color, var(--divider-color));
    border-radius: 0.5rem;
    padding: 0.75rem;
  }

  .login-placeholder {
    height: 2.25rem;
    border-radius: 0.5rem;
    background: var(--theme-button-default, var(--button-default));
    opacity: 0.35;
  }

  .login-empty {
    color: var(--caption-color);
    font-size: 0.875rem;
  }

  .login-success {
    color: var(--theme-positive-color, #2e7d32);
  }

  .login-failed {
    color: var(--theme-danger-color, #d32f2f);
  }
</style>
