<!--
// Copyright © TraceX SAS 2026
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
  import { getMetadata, type IntlString } from '@hcengineering/platform'
  import presentation, { MessageBox } from '@hcengineering/presentation'
  import { Button, Label, showPopup } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  import settingsRes from '../plugin'
  import {
    classifyLoginHistoryRow,
    coalesceLoginHistory,
    decodeSessionIdFromToken,
    filterHistoryByStatus,
    filterKnownAnomalyCodes,
    formatLocation,
    isRoutineEvent,
    maskIpAddress,
    parseUserAgent,
    type LoginHistoryRowBadge,
    type LoginHistoryStatusFilter,
    type SecurityLoginHistoryGroup
  } from '../securityLoginActivity'
  import { getAccountClient } from '../utils'
  import DeviceIcon from './DeviceIcon.svelte'

  /** Account client subset used by this view. */
  const accountClient = getAccountClient() as unknown as {
    getMySecurityLoginHistory: (params?: { limit?: number, redact?: boolean }) => Promise<SecurityLoginHistoryEvent[]>
    reportSecurityLoginConcern: (params?: { loginEventId?: string }) => Promise<void>
  }
  const recentActivityLimit = 50
  let loginHistory: SecurityLoginHistoryEvent[] = []
  let loginHistoryLoading = false
  let loginHistoryLoaded = false
  let loginHistoryError = false
  let statusFilter: LoginHistoryStatusFilter = 'all'

  const filterDefs: Array<{ key: LoginHistoryStatusFilter, label: IntlString }> = [
    { key: 'all', label: settingsRes.string.RecentLoginActivityFilterAll },
    { key: 'success', label: settingsRes.string.RecentLoginActivityFilterSuccessful },
    { key: 'failed', label: settingsRes.string.RecentLoginActivityFilterFailed }
  ]

  $: groups = coalesceLoginHistory(filterHistoryByStatus(loginHistory, statusFilter))

  // Maps supported anomaly codes to badge labels.
  const anomalyLabels: Record<string, IntlString> = {
    new_country_for_account: settingsRes.string.AnomalyNewCountry,
    impossible_travel_suspected: settingsRes.string.AnomalyImpossibleTravel,
    repeated_failed_attempts_from_ip: settingsRes.string.AnomalyRepeatedFailures
  }

  const rowBadgeLabels: Record<LoginHistoryRowBadge, IntlString> = {
    currentSession: settingsRes.string.RecentLoginActivityBadgeCurrentSession,
    sameIp: settingsRes.string.RecentLoginActivityBadgeSameIp,
    otherDevice: settingsRes.string.RecentLoginActivityBadgeOtherDevice
  }

  // Derive the current session only from this browser's access token.
  $: currentSessionId = decodeSessionIdFromToken(getMetadata(presentation.metadata.Token))
  $: currentEvent = loginHistory.find((event) => event.sessionId === currentSessionId)
  $: currentDeviceInfo = parseUserAgent(currentEvent?.userAgent)
  $: currentRowContext = {
    sessionId: currentSessionId,
    ip: currentEvent?.ip,
    deviceKnown: currentDeviceInfo.deviceKind !== 'unknown',
    deviceLabel: currentDeviceInfo.label
  }

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

  function handleNotMeAction (): void {
    showPopup(MessageBox, {
      label: settingsRes.string.NotMeDialogTitle,
      message: settingsRes.string.NotMeDialogMessage,
      okLabel: settingsRes.string.NotMeDialogAction,
      action: async () => {
        await accountClient.reportSecurityLoginConcern({})
        Analytics.handleEvent('Settings:RecentLoginActivityNotMe', {
          eventId: 'header-action',
          authMethod: 'unknown'
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
    <div>
      <h3 class="session-history__title">
        <Label label={settingsRes.string.RecentLoginActivityTitle} />
      </h3>
      <p class="session-history__description">
        <Label label={settingsRes.string.RecentLoginActivityDescription} />
      </p>
    </div>
    <Button
      label={settingsRes.string.ReportSuspiciousActivityAction}
      kind={'ghost'}
      size={'small'}
      on:click={() => {
        handleNotMeAction()
      }}
    />
  </header>

  {#if loginHistoryLoaded && loginHistory.length > 0}
    <div class="session-history__filters" role="tablist">
      {#each filterDefs as f (f.key)}
        <Button
          label={f.label}
          kind={statusFilter === f.key ? 'primary' : 'ghost'}
          size={'small'}
          on:click={() => {
            statusFilter = f.key
          }}
        />
      {/each}
    </div>
  {/if}

  {#if loginHistoryLoading && !loginHistoryLoaded}
    <ul class="session-history__list">
      {#each [0, 1, 2] as placeholderIndex (placeholderIndex)}
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
      <Label
        label={statusFilter === 'all'
          ? settingsRes.string.RecentLoginActivityEmpty
          : settingsRes.string.RecentLoginActivityEmptyFiltered}
      />
    </div>
  {:else}
    <ul class="session-history__list">
      {#each groups as group (group.id)}
        {@const parsedUa = parseUserAgent(group.event.userAgent)}
        {@const anomalyCodes = filterKnownAnomalyCodes(group.event.anomalyCodes)}
        {@const routine = isRoutineEvent(group.event)}
        {@const rowBadge = classifyLoginHistoryRow(
          group.event,
          parsedUa.deviceKind !== 'unknown',
          parsedUa.label,
          currentRowContext
        )}
        <li
          class="session-history__row"
          class:session-history__row--failed={!group.event.success}
          class:session-history__row--routine={routine}
        >
          <span class="session-history__device-icon">
            <DeviceIcon kind={parsedUa.deviceKind} size={routine ? 14 : 16} />
          </span>
          <div class="session-history__body">
            <div class="session-history__line session-history__line--head">
              <span class="session-history__device" title={group.event.userAgent ?? ''}>{parsedUa.label}</span>
              <span class="session-history__method">{formatAuthMethod(group.event.authMethod)}</span>
              {#if group.count > 1}
                <span class="session-history__count" title={formatGroupRange(group)}>×{group.count}</span>
              {/if}
              {#if !group.event.success}
                <span class="session-history__failed-label">
                  <Label label={settingsRes.string.RecentLoginActivityFailure} />
                </span>
              {/if}
              {#each anomalyCodes as code (code)}
                <span class="session-history__anomaly"><Label label={anomalyLabels[code]} /></span>
              {/each}
            </div>
            <div class="session-history__line session-history__line--network">
              <time datetime={new Date(group.lastEventTime).toISOString()} title={formatFullDate(group.lastEventTime)}>
                {formatCompactDate(group.lastEventTime)}
              </time>
              <span class="session-history__sep" aria-hidden="true">·</span>
              <span>{maskIpAddress(group.event.ip)}</span>
              <span class="session-history__sep" aria-hidden="true">·</span>
              <span>{formatLocation({ city: group.event.city, country: group.event.country })}</span>
            </div>
          </div>
          {#if rowBadge !== undefined}
            <span class="session-history__tag session-history__tag--{rowBadge}">
              <Label label={rowBadgeLabels[rowBadge]} />
            </span>
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
    align-items: flex-start;
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

  .session-history__description {
    font-size: 0.8125rem;
    color: var(--theme-content-color, var(--content-color));
    margin: 0.25rem 0 0;
    max-width: 34rem;
  }

  .session-history__filters {
    display: flex;
    align-items: center;
    gap: 0.375rem;
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
    gap: 0.625rem;
    padding: 0.75rem 0.25rem;
    border-bottom: 1px solid var(--theme-divider-color, var(--divider-color));
  }
  .session-history__row:last-child {
    border-bottom: none;
  }

  .session-history__row--routine {
    opacity: 0.6;
    padding: 0.5rem 0.25rem;
  }

  .session-history__row--placeholder {
    height: 4.5rem;
    background: var(--theme-button-default, var(--button-default));
    opacity: 0.35;
    border-radius: 0.375rem;
    border-bottom: none;
    margin-bottom: 0.25rem;
  }

  .session-history__device-icon {
    flex: 0 0 auto;
    margin-top: 0.1875rem;
    color: var(--theme-darker-color, var(--dark-color));
    display: flex;
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

  .session-history__row--routine .session-history__line--head {
    font-size: 0.8125rem;
    color: var(--theme-content-color, var(--content-color));
  }

  .session-history__line--network {
    font-size: 0.8125rem;
    color: var(--theme-content-color, var(--content-color));
  }

  .session-history__device {
    font-weight: 600;
  }

  .session-history__row--routine .session-history__device {
    font-weight: 500;
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

  .session-history__anomaly {
    color: var(--theme-danger-color, #d32f2f);
    background: rgba(211, 47, 47, 0.1);
    font-weight: 500;
    font-size: 0.6875rem;
    border-radius: 0.5rem;
    padding: 0 0.375rem;
    line-height: 1.25rem;
  }

  .session-history__row--failed .session-history__device,
  .session-history__row--failed .session-history__method {
    color: var(--theme-danger-color, #d32f2f);
  }

  .session-history__tag {
    flex: 0 0 auto;
    align-self: center;
    margin-left: auto;
    white-space: nowrap;
    font-weight: 500;
    font-size: 0.6875rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    border-radius: 0.5rem;
    padding: 0 0.5rem;
    line-height: 1.25rem;
    background: var(--theme-button-default, var(--button-default));
    color: var(--theme-content-color, var(--content-color));
  }

  .session-history__tag--currentSession {
    color: var(--theme-positive-color, #2e7d32);
  }

  .session-history__tag--sameIp {
    color: var(--theme-content-color, var(--content-color));
  }

  .session-history__tag--otherDevice {
    color: var(--theme-darker-color, var(--dark-color));
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
</style>
