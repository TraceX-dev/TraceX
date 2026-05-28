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
  import type { SecurityAuthMethod, SecurityLoginHistoryEvent } from '@hcengineering/account-client'
  import { MessageBox } from '@hcengineering/presentation'
  import { Button, Label, showPopup } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  import settingsRes from '../plugin'
  import {
    coalesceLoginHistory,
    formatLocation,
    getShortUserAgent,
    maskIpAddress,
    shouldShowNotMeAction,
    type SecurityLoginHistoryGroup
  } from '../securityLoginActivity'
  import { getAccountClient } from '../utils'

  /** Narrow account client for security APIs (params match server contract). */
  const accountClient = getAccountClient() as unknown as {
    getMySecurityLoginHistory: (params?: { limit?: number, redact?: boolean }) => Promise<SecurityLoginHistoryEvent[]>
    reportSecurityLoginConcern: (params?: { loginEventId?: string }) => Promise<void>
  }
  const recentActivityLimit = 50
  let loginHistory: SecurityLoginHistoryEvent[] = []
  let loginHistoryLoading = false
  let loginHistoryLoaded = false
  let loginHistoryError = false

  $: groups = coalesceLoginHistory(loginHistory)

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

  function handleNotMeAction (group?: SecurityLoginHistoryGroup): void {
    showPopup(MessageBox, {
      label: settingsRes.string.NotMeDialogTitle,
      message: settingsRes.string.NotMeDialogMessage,
      okLabel: settingsRes.string.NotMeDialogAction,
      action: async () => {
        if (group === undefined) {
          await accountClient.reportSecurityLoginConcern({})
          Analytics.handleEvent('Settings:RecentLoginActivityNotMe', {
            eventId: 'header-action',
            authMethod: 'unknown'
          })
          return
        }
        // When the user reports a coalesced row, every underlying
        // event is part of the concern.
        await Promise.allSettled(
          group.ids.map((loginEventId) => accountClient.reportSecurityLoginConcern({ loginEventId }))
        )
        Analytics.handleEvent('Settings:RecentLoginActivityNotMe', {
          eventId: group.event.id,
          authMethod: group.event.authMethod,
          groupSize: group.count
        })
      }
    })
  }

  const compactFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  function formatCompactDate (eventTime: number): string {
    return compactFormatter.format(new Date(eventTime))
  }

  function formatFullDate (eventTime: number): string {
    return new Date(eventTime).toLocaleString()
  }

  function formatGroupRange (group: SecurityLoginHistoryGroup): string {
    if (group.count <= 1) return formatFullDate(group.lastEventTime)
    return `${formatFullDate(group.firstEventTime)} – ${formatFullDate(group.lastEventTime)}`
  }

  function formatAuthMethod (method: SecurityAuthMethod): string {
    if (method === 'otp') return 'OTP'
    return method.charAt(0).toUpperCase() + method.slice(1)
  }

  onMount(() => {
    void loadRecentLoginActivity()
  })
</script>

<section class="session-history w-full">
  <header class="session-history__header">
    <h3 class="session-history__title">
      <Label label={settingsRes.string.RecentLoginActivityTitle} />
    </h3>
    <Button
      label={settingsRes.string.NotMeAction}
      kind={'ghost'}
      size={'small'}
      on:click={() => {
        handleNotMeAction()
      }}
    />
  </header>

  {#if loginHistoryLoading && !loginHistoryLoaded}
    <ul class="session-history__list">
      {#each Array(3) as _}
        <li class="session-history__row session-history__row--placeholder" />
      {/each}
    </ul>
  {:else if loginHistoryError}
    <div class="session-history__state">
      <div><Label label={settingsRes.string.RecentLoginActivityError} /></div>
      <Button
        label={settingsRes.string.RecentLoginActivityRetry}
        kind={'secondary'}
        size={'small'}
        on:click={() => {
          void loadRecentLoginActivity()
        }}
      />
    </div>
  {:else if loginHistoryLoaded && groups.length === 0}
    <div class="session-history__state">
      <Label label={settingsRes.string.RecentLoginActivityEmpty} />
    </div>
  {:else}
    <ul class="session-history__list">
      {#each groups as group (group.id)}
        <li class="session-history__row" class:session-history__row--failed={!group.event.success}>
          <span
            class="session-history__status"
            class:session-history__status--success={group.event.success}
            class:session-history__status--failed={!group.event.success}
            role="img"
          >
            <span class="session-history__sr-only">
              <Label
                label={group.event.success
                  ? settingsRes.string.RecentLoginActivitySuccess
                  : settingsRes.string.RecentLoginActivityFailure}
              />
            </span>
          </span>
          <div class="session-history__body">
            <div class="session-history__line session-history__line--head">
              <time
                class="session-history__time"
                datetime={new Date(group.lastEventTime).toISOString()}
                title={formatFullDate(group.lastEventTime)}
              >
                {formatCompactDate(group.lastEventTime)}
              </time>
              <span class="session-history__sep" aria-hidden="true">·</span>
              <span class="session-history__method">{formatAuthMethod(group.event.authMethod)}</span>
              {#if group.count > 1}
                <span class="session-history__count" title={formatGroupRange(group)}>×{group.count}</span>
              {/if}
              {#if !group.event.success}
                <span class="session-history__failed-label">
                  <Label label={settingsRes.string.RecentLoginActivityFailure} />
                </span>
              {/if}
            </div>
            <div class="session-history__line session-history__line--network">
              <span>{maskIpAddress(group.event.ip)}</span>
              <span class="session-history__sep" aria-hidden="true">·</span>
              <span>{formatLocation({ city: group.event.city, country: group.event.country })}</span>
            </div>
            <div class="session-history__line session-history__line--device" title={group.event.userAgent ?? ''}>
              {getShortUserAgent(group.event.userAgent)}
            </div>
          </div>
          {#if shouldShowNotMeAction(group.event)}
            <div class="session-history__action">
              <Button
                label={settingsRes.string.NotMeAction}
                kind={'secondary'}
                size={'small'}
                on:click={() => {
                  handleNotMeAction(group)
                }}
              />
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style lang="scss">
  .session-history {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 60rem;
  }

  .session-history__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color, var(--divider-color));
  }

  .session-history__title {
    font-size: 1.0625rem;
    font-weight: 500;
    color: var(--theme-caption-color, var(--caption-color));
    margin: 0;
  }

  .session-history__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .session-history__row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 0.25rem;
    border-bottom: 1px solid var(--theme-divider-color, var(--divider-color));
  }
  .session-history__row:last-child {
    border-bottom: none;
  }

  .session-history__row--placeholder {
    height: 4.5rem;
    background: var(--theme-button-default, var(--button-default));
    opacity: 0.35;
    border-radius: 0.375rem;
    border-bottom: none;
    margin-bottom: 0.25rem;
  }

  .session-history__status {
    flex: 0 0 auto;
    width: 0.5rem;
    height: 0.5rem;
    margin-top: 0.5rem;
    border-radius: 50%;
    background: var(--theme-text-secondary, var(--content-color));
  }
  .session-history__status--success {
    background: var(--theme-positive-color, #2e7d32);
  }
  .session-history__status--failed {
    background: var(--theme-danger-color, #d32f2f);
  }

  .session-history__body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .session-history__line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.375rem;
  }

  .session-history__line--head {
    font-size: 0.875rem;
    color: var(--theme-caption-color, var(--caption-color));
  }

  .session-history__line--network {
    font-size: 0.8125rem;
    color: var(--theme-content-color, var(--content-color));
  }

  .session-history__line--device {
    font-size: 0.8125rem;
    color: var(--theme-darker-color, var(--dark-color));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .session-history__time {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .session-history__method {
    font-weight: 500;
  }

  .session-history__sep {
    color: var(--theme-darker-color, var(--dark-color));
    opacity: 0.6;
  }

  .session-history__count {
    color: var(--theme-caption-color, var(--caption-color));
    font-variant-numeric: tabular-nums;
    background: var(--theme-button-default, var(--button-default));
    border-radius: 0.5rem;
    padding: 0 0.375rem;
    font-size: 0.75rem;
    line-height: 1.25rem;
    margin-left: 0.125rem;
  }

  .session-history__failed-label {
    color: var(--theme-danger-color, #d32f2f);
    font-weight: 500;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-left: 0.125rem;
  }

  .session-history__row--failed .session-history__time,
  .session-history__row--failed .session-history__method {
    color: var(--theme-danger-color, #d32f2f);
  }

  .session-history__action {
    flex: 0 0 auto;
    align-self: center;
    margin-left: 0.5rem;
  }

  .session-history__state {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    color: var(--theme-caption-color, var(--caption-color));
    font-size: 0.875rem;
    padding: 0.75rem 0;
  }

  .session-history__sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
