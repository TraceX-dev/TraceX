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
  import type { ActiveSessionInfo, SecurityAuthMethod } from '@hcengineering/account-client'
  import type { IntlString } from '@hcengineering/platform'
  import { MessageBox } from '@hcengineering/presentation'
  import { Button, Label, showPopup } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  import settingsRes from '../plugin'
  import {
    filterKnownAnomalyCodes,
    formatLocation,
    hasAnomalies,
    maskIpAddress,
    parseUserAgent
  } from '../securityLoginActivity'
  import { getAccountClient } from '../utils'
  import DeviceIcon from './DeviceIcon.svelte'

  const accountClient = getAccountClient()

  let sessions: ActiveSessionInfo[] = []
  let loading = false
  let loaded = false
  let error = false
  let revoking: string | undefined
  let revokingAll = false

  $: otherSessions = sessions.filter((s) => !s.isCurrent)

  const anomalyLabels: Record<string, IntlString> = {
    new_country_for_account: settingsRes.string.AnomalyNewCountry,
    impossible_travel_suspected: settingsRes.string.AnomalyImpossibleTravel,
    repeated_failed_attempts_from_ip: settingsRes.string.AnomalyRepeatedFailures
  }

  async function loadSessions (): Promise<void> {
    loading = true
    error = false
    try {
      sessions = await accountClient.getMyActiveSessions({ redact: true })
      loaded = true
    } catch (err: any) {
      error = true
      Analytics.handleError(err)
    } finally {
      loading = false
    }
  }

  function handleSignOut (session: ActiveSessionInfo): void {
    showPopup(MessageBox, {
      label: settingsRes.string.SignOutDialogTitle,
      message: settingsRes.string.SignOutDialogMessage,
      okLabel: settingsRes.string.SignOutDialogAction,
      action: async () => {
        revoking = session.sessionId
        try {
          await accountClient.revokeSession({ sessionId: session.sessionId })
          Analytics.handleEvent('Settings:ActiveSessionRevoked', {
            authMethod: session.authMethod
          })
          // Drop it locally for instant feedback, then refresh from the server.
          sessions = sessions.filter((s) => s.sessionId !== session.sessionId)
          void loadSessions()
        } catch (err: any) {
          Analytics.handleError(err)
          await loadSessions()
        } finally {
          revoking = undefined
        }
      }
    })
  }

  function handleSignOutAllOthers (): void {
    const targets = otherSessions
    if (targets.length === 0) return
    showPopup(MessageBox, {
      label: settingsRes.string.SignOutAllOtherSessionsDialogTitle,
      message: settingsRes.string.SignOutAllOtherSessionsDialogMessage,
      okLabel: settingsRes.string.SignOutAllOtherSessionsDialogAction,
      action: async () => {
        revokingAll = true
        try {
          const results = await Promise.allSettled(
            targets.map(async (s) => {
              await accountClient.revokeSession({ sessionId: s.sessionId })
            })
          )
          const revokedIds = new Set(
            targets.filter((_, i) => results[i].status === 'fulfilled').map((s) => s.sessionId)
          )
          sessions = sessions.filter((s) => s.isCurrent || !revokedIds.has(s.sessionId))
          Analytics.handleEvent('Settings:ActiveSessionsSignOutAllOthers', { count: revokedIds.size })
          void loadSessions()
        } catch (err: any) {
          Analytics.handleError(err)
          await loadSessions()
        } finally {
          revokingAll = false
        }
      }
    })
  }

  const compactFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  function formatCompactDate (time: number): string {
    return compactFormatter.format(new Date(time))
  }

  function formatFullDate (time: number): string {
    return new Date(time).toLocaleString()
  }

  function formatAuthMethod (method: SecurityAuthMethod): string {
    if (method === 'otp') return 'OTP'
    return method.charAt(0).toUpperCase() + method.slice(1)
  }

  onMount(() => {
    void loadSessions()
  })
</script>

<section class="active-sessions w-full">
  <header class="active-sessions__header">
    <div>
      <h3 class="active-sessions__title">
        <Label label={settingsRes.string.ActiveSessionsTitle} />
      </h3>
      {#if loaded && sessions.length > 0}
        <p class="active-sessions__description">
          <Label label={settingsRes.string.ActiveSessionsLegend} />
        </p>
      {/if}
    </div>
    <Button
      label={settingsRes.string.SignOutAllOtherSessions}
      kind={otherSessions.length === 0 ? 'regular' : 'dangerous'}
      size={'small'}
      loading={revokingAll}
      disabled={otherSessions.length === 0 || revoking !== undefined || revokingAll}
      on:click={() => {
        handleSignOutAllOthers()
      }}
    />
  </header>

  {#if loading && !loaded}
    <ul class="active-sessions__list">
      {#each [0, 1, 2] as placeholderIndex (placeholderIndex)}
        <li class="active-sessions__row active-sessions__row--placeholder" />
      {/each}
    </ul>
  {:else if error}
    <div class="active-sessions__state">
      <div><Label label={settingsRes.string.ActiveSessionsError} /></div>
      <Button
        label={settingsRes.string.ActiveSessionsRetry}
        kind={'secondary'}
        size={'small'}
        on:click={() => {
          void loadSessions()
        }}
      />
    </div>
  {:else if loaded && sessions.length === 0}
    <div class="active-sessions__state">
      <Label label={settingsRes.string.ActiveSessionsEmpty} />
    </div>
  {:else}
    <ul class="active-sessions__list">
      {#each sessions as session (session.sessionId)}
        {@const parsedUa = parseUserAgent(session.userAgent)}
        {@const anomalyCodes = filterKnownAnomalyCodes(session.anomalyCodes)}
        {@const flagged = hasAnomalies(session.anomalyCodes)}
        <li
          class="active-sessions__row"
          class:active-sessions__row--current={session.isCurrent}
          class:active-sessions__row--flagged={flagged}
        >
          <span class="active-sessions__device-icon">
            <DeviceIcon kind={parsedUa.deviceKind} />
          </span>
          <div class="active-sessions__body">
            <div class="active-sessions__line active-sessions__line--head">
              <span class="active-sessions__device" title={session.userAgent ?? ''}>{parsedUa.label}</span>
              <span class="active-sessions__method">{formatAuthMethod(session.authMethod)}</span>
              {#if session.isCurrent}
                <span class="active-sessions__badge active-sessions__badge--current">
                  <Label label={settingsRes.string.ActiveSessionsCurrent} />
                </span>
              {/if}
              {#each anomalyCodes as code (code)}
                <span class="active-sessions__badge active-sessions__badge--flagged">
                  <Label label={anomalyLabels[code]} />
                </span>
              {/each}
            </div>
            <div class="active-sessions__line active-sessions__line--network">
              <span>{maskIpAddress(session.ip)}</span>
              <span class="active-sessions__sep" aria-hidden="true">·</span>
              <span>{formatLocation({ city: session.city, country: session.country })}</span>
            </div>
            <div class="active-sessions__line active-sessions__line--time">
              <Label label={settingsRes.string.ActiveSessionsLastSeen} />
              <time datetime={new Date(session.lastSeen).toISOString()} title={formatFullDate(session.lastSeen)}>
                {formatCompactDate(session.lastSeen)}
              </time>
              <span class="active-sessions__sep" aria-hidden="true">·</span>
              <Label label={settingsRes.string.ActiveSessionsSignedIn} />
              <time datetime={new Date(session.createdOn).toISOString()} title={formatFullDate(session.createdOn)}>
                {formatCompactDate(session.createdOn)}
              </time>
            </div>
          </div>
          {#if !session.isCurrent}
            <div class="active-sessions__action">
              <Button
                label={settingsRes.string.SignOutAction}
                kind={'dangerous'}
                size={'small'}
                loading={revoking === session.sessionId}
                disabled={revoking !== undefined || revokingAll}
                on:click={() => {
                  handleSignOut(session)
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
  .active-sessions {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 60rem;
  }

  .active-sessions__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--theme-divider-color, var(--divider-color));
  }

  .active-sessions__title {
    font-size: 1.0625rem;
    font-weight: 500;
    color: var(--theme-caption-color, var(--caption-color));
    margin: 0;
  }

  .active-sessions__description {
    font-size: 0.8125rem;
    color: var(--theme-content-color, var(--content-color));
    margin: 0.25rem 0 0;
    max-width: 30rem;
  }

  .active-sessions__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }

  .active-sessions__row {
    display: flex;
    align-items: flex-start;
    gap: 0.625rem;
    padding: 0.75rem 0.25rem;
    border-bottom: 1px solid var(--theme-divider-color, var(--divider-color));
  }
  .active-sessions__row:last-child {
    border-bottom: none;
  }

  .active-sessions__row--flagged {
    background: rgba(211, 47, 47, 0.06);
    border-left: 2px solid var(--theme-danger-color, #d32f2f);
    padding-left: calc(0.25rem - 2px);
  }

  .active-sessions__row--placeholder {
    height: 4.5rem;
    background: var(--theme-button-default, var(--button-default));
    opacity: 0.35;
    border-radius: 0.375rem;
    border-bottom: none;
    margin-bottom: 0.25rem;
  }

  .active-sessions__device-icon {
    flex: 0 0 auto;
    margin-top: 0.125rem;
    color: var(--theme-darker-color, var(--dark-color));
    display: flex;
  }

  .active-sessions__body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .active-sessions__line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.375rem;
  }

  .active-sessions__line--head {
    font-size: 0.875rem;
    color: var(--theme-caption-color, var(--caption-color));
  }

  .active-sessions__line--network {
    font-size: 0.8125rem;
    color: var(--theme-content-color, var(--content-color));
  }

  .active-sessions__line--time {
    font-size: 0.8125rem;
    color: var(--theme-darker-color, var(--dark-color));
    font-variant-numeric: tabular-nums;
  }

  .active-sessions__device {
    font-weight: 600;
  }

  .active-sessions__method {
    font-weight: 500;
  }

  .active-sessions__sep {
    color: var(--theme-darker-color, var(--dark-color));
    opacity: 0.6;
  }

  .active-sessions__badge {
    font-weight: 500;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-radius: 0.5rem;
    padding: 0 0.375rem;
    line-height: 1.25rem;
    margin-left: 0.125rem;
  }

  .active-sessions__badge--current {
    color: var(--theme-positive-color, #2e7d32);
    background: var(--theme-button-default, var(--button-default));
  }

  .active-sessions__badge--flagged {
    color: var(--theme-danger-color, #d32f2f);
    background: rgba(211, 47, 47, 0.1);
    text-transform: none;
    letter-spacing: normal;
  }

  .active-sessions__action {
    flex: 0 0 auto;
    align-self: center;
    margin-left: 0.5rem;
  }

  .active-sessions__state {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    color: var(--theme-caption-color, var(--caption-color));
    font-size: 0.875rem;
    padding: 0.75rem 0;
  }
</style>
