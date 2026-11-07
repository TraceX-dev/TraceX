<!--
//
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
//
-->
<script lang="ts">
  import type { WorkspaceAuditEvent, WorkspaceAuditPage, WorkspaceAuditQuery } from '@hcengineering/account-client'
  import { AccountRole, getCurrentAccount } from '@hcengineering/core'
  import platform, { PlatformError } from '@hcengineering/platform'
  import {
    Breadcrumb,
    Button,
    DateTimePresenter,
    DropdownLabelsIntl,
    Header,
    IconHistory,
    Label,
    ListView,
    Loading,
    Notice,
    RangeDatePopup,
    Scroller,
    SectionEmpty,
    StateTag,
    showPopup,
    type DropdownIntlItem
  } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'
  import {
    AUDIT_EVENT_ITEMS,
    AUDIT_OUTCOME_LABELS,
    AUDIT_OUTCOME_TYPES,
    getAuditEventLabel,
    getAuditTarget
  } from '../../audit'
  import setting from '../../plugin'
  import { clearSettingsStore, settingsStore } from '../../store'
  import { getAccountClient } from '../../utils'
  import AuditEventDetails from './AuditEventDetails.svelte'
  import AuditIdentity from './AuditIdentity.svelte'

  const periodItems: DropdownIntlItem[] = [
    { id: '7', label: setting.string.Last7Days },
    { id: '1', label: setting.string.Today },
    { id: '30', label: setting.string.Last30Days },
    { id: 'custom', label: setting.string.CustomPeriod }
  ]
  const outcomeItems: DropdownIntlItem[] = [
    { id: '', label: setting.string.AllResults },
    ...Object.entries(AUDIT_OUTCOME_LABELS).map(([id, label]) => ({ id, label }))
  ]
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const owner = getCurrentAccount().role === AccountRole.Owner

  let events: WorkspaceAuditEvent[] = []
  let nextCursor: WorkspaceAuditPage['nextCursor']
  let period = '7'
  let eventType = ''
  let outcome = ''
  let startDate: Date | null = null
  let endDate: Date | null = null
  let loading = true
  let loadingMore = false
  let failed = false
  let denied = !owner
  let generation = 0
  let query: WorkspaceAuditQuery

  function makeQuery (): WorkspaceAuditQuery {
    const now = new Date()
    const from = period === 'custom' && startDate !== null ? new Date(startDate) : new Date(now)
    from.setHours(0, 0, 0, 0)
    if (period !== 'custom') from.setDate(from.getDate() - (Number(period) - 1))
    const to = period === 'custom' && startDate !== null ? new Date(endDate ?? startDate) : new Date(now)
    to.setDate(to.getDate() + 1)
    to.setHours(0, 0, 0, 0)
    return {
      from: from.getTime(),
      to: to.getTime(),
      limit: 50,
      event: eventType || undefined,
      outcome: outcome === 'succeeded' || outcome === 'denied' || outcome === 'failed' ? outcome : undefined
    }
  }

  async function load (more = false): Promise<void> {
    if (!owner || denied || (more && (loading || loadingMore || nextCursor === undefined))) {
      loading = false
      return
    }
    const request = ++generation
    if (more) {
      loadingMore = true
    } else {
      loading = true
      loadingMore = false
      events = []
      nextCursor = undefined
      query = makeQuery()
      clearSettingsStore()
    }
    failed = false
    try {
      const page = await getAccountClient().getWorkspaceAuditEvents({ ...query, cursor: more ? nextCursor : undefined })
      if (request !== generation) return
      const seen = new Set(events.map((event) => event.eventId))
      events = more ? [...events, ...page.events.filter((event) => !seen.has(event.eventId))] : page.events
      nextCursor = page.nextCursor
    } catch (error) {
      if (request !== generation) return
      failed = true
      if (error instanceof PlatformError && error.status.code === platform.status.Forbidden) {
        denied = true
        events = []
        nextCursor = undefined
        clearSettingsStore()
      }
    } finally {
      if (request === generation) {
        loading = false
        loadingMore = false
      }
    }
  }

  function selectPeriod (value: string): void {
    if (value !== 'custom') {
      period = value
      void load()
      return
    }
    const previous = period
    period = 'custom'
    showPopup(
      RangeDatePopup,
      { startDate, endDate, label: setting.string.Period },
      'top',
      (result?: { startDate?: Date | null, endDate?: Date | null }) => {
        if (result?.startDate != null) {
          startDate = result.startDate
          endDate = result.endDate ?? null
          period = 'custom'
          void load()
        } else {
          period = previous
        }
      }
    )
  }

  function handlePeriodSelected (event: CustomEvent<unknown>): void {
    selectPeriod(String(event.detail))
  }

  function handleEventSelected (event: CustomEvent<unknown>): void {
    eventType = String(event.detail)
    void load()
  }

  function handleOutcomeSelected (event: CustomEvent<unknown>): void {
    outcome = String(event.detail)
    void load()
  }

  function refresh (): void {
    void load()
  }
  function retry (): void {
    void load(events.length > 0)
  }
  function loadNext (): void {
    void load(true)
  }
  function eventKey (index: number): string {
    return events[index].eventId
  }

  function clearFilters (): void {
    period = '7'
    eventType = ''
    outcome = ''
    startDate = null
    endDate = null
    void load()
  }

  function openEvent (event: WorkspaceAuditEvent): void {
    settingsStore.set({ id: event.eventId, component: AuditEventDetails, props: { event } })
  }

  onMount(() => {
    void load()
  })
  onDestroy(() => {
    generation++
    clearSettingsStore()
  })
</script>

<div class="hulyComponent audit-log" data-id="workspace-audit-log">
  <Header adaptive="disabled">
    <Breadcrumb icon={IconHistory} label={setting.string.AuditLog} size="large" isCurrent />
  </Header>
  <div class="hulyComponent-content__column">
    {#if denied}
      <div class="p-4"><Notice kind="warning" label={setting.string.AuditOwnerOnly} /></div>
    {:else}
      <div class="flex-col flex-gap-2 p-4">
        <div class="flex-row-center flex-wrap flex-gap-2">
          <DropdownLabelsIntl
            items={periodItems}
            selected={period}
            label={setting.string.Period}
            dataId="audit-period"
            on:selected={handlePeriodSelected}
          />
          <DropdownLabelsIntl
            items={AUDIT_EVENT_ITEMS}
            selected={eventType}
            label={setting.string.Event}
            withSearch
            dataId="audit-event"
            on:selected={handleEventSelected}
          />
          <DropdownLabelsIntl
            items={outcomeItems}
            selected={outcome}
            label={setting.string.Result}
            dataId="audit-outcome"
            on:selected={handleOutcomeSelected}
          />
          <Button
            label={setting.string.Refresh}
            disabled={loading || loadingMore}
            dataId="audit-refresh"
            on:click={refresh}
          />
        </div>
        <div class="text-sm content-dark-color flex-row-center flex-wrap flex-gap-2">
          <Label label={setting.string.NewestFirst} /><span>· {timezone}</span>
          {#if period === 'custom' && startDate !== null}
            <DateTimePresenter value={startDate.getTime()} />
            {#if endDate !== null}<span>–</span><DateTimePresenter value={endDate.getTime()} />{/if}
          {/if}
        </div>
      </div>
      <Scroller>
        {#if loading}
          <Loading />
        {:else}
          {#if failed}
            <div class="flex-col flex-gap-2 p-4">
              <Notice kind="error" label={setting.string.AuditLoadFailed} />
              <Button label={setting.string.Retry} dataId="audit-retry" on:click={retry} />
            </div>
          {/if}
          {#if events.length > 0}
            <div class="audit-columns audit-head text-sm content-dark-color px-4 py-2">
              <Label label={setting.string.Time} /><Label label={setting.string.Event} />
              <Label label={setting.string.Actor} /><Label label={setting.string.Result} />
            </div>
            <ListView
              count={events.length}
              noScroll
              kind="full-size"
              updateOnMouse={false}
              selection={-1}
              getKey={eventKey}
            >
              <svelte:fragment slot="item" let:item>
                {@const event = events[item]}
                {@const target = getAuditTarget(event)}
                <div class="audit-columns audit-row px-4 py-3">
                  <span class="text-sm audit-time"><DateTimePresenter value={event.occurredAt} /></span>
                  <div class="audit-event flex-col flex-gap-1 min-w-0">
                    <Button
                      kind="link"
                      label={getAuditEventLabel(event.event)}
                      justify="left"
                      width="100%"
                      dataId="audit-event-details"
                      on:click={openEvent.bind(null, event)}
                    />
                    {#if target}<span class="text-sm content-dark-color"><AuditIdentity account={target} /></span>{/if}
                  </div>
                  <span class="audit-identity"
                    ><AuditIdentity account={event.actorAccountUuid} service={event.actorService} /></span
                  >
                  <span class="audit-result"
                    ><StateTag
                      type={AUDIT_OUTCOME_TYPES[event.outcome]}
                      label={AUDIT_OUTCOME_LABELS[event.outcome]}
                    /></span
                  >
                </div>
              </svelte:fragment>
            </ListView>
            <div class="flex-col flex-gap-2 p-4">
              {#if loadingMore}<Loading />
              {:else if nextCursor !== undefined}
                <Button label={setting.string.LoadMore} dataId="audit-load-more" on:click={loadNext} />
              {/if}
              <span class="text-sm content-dark-color"><Label label={setting.string.AuditEventsMayBeDelayed} /></span>
            </div>
          {:else if !failed}
            <SectionEmpty icon={IconHistory} label={setting.string.NoAuditEvents}>
              <div class="mt-2">
                <Button label={setting.string.ClearFilters} dataId="audit-clear-filters" on:click={clearFilters} />
              </div>
            </SectionEmpty>
          {/if}
        {/if}
      </Scroller>
    {/if}
  </div>
</div>

<style lang="scss">
  .audit-log {
    container-type: inline-size;
  }
  .audit-columns {
    display: grid;
    grid-template-columns: minmax(8rem, 1fr) minmax(10rem, 2fr) minmax(6rem, 1fr) max-content;
    align-items: center;
    gap: var(--spacing-3);
  }
  .audit-row {
    border-top: 1px solid var(--theme-divider-color);
  }
  .audit-identity {
    overflow-wrap: anywhere;
    min-width: 0;
  }
  .audit-time {
    grid-area: time;
  }
  .audit-event {
    grid-area: event;
  }
  .audit-identity {
    grid-area: actor;
  }
  .audit-result {
    grid-area: result;
  }
  .audit-row {
    grid-template-areas: 'time event actor result';
  }
  @container (max-width: 44rem) {
    .audit-head {
      display: none;
    }
    .audit-row {
      grid-template-columns: minmax(0, 1fr) max-content;
      grid-template-areas: 'event result' 'time time' 'actor actor';
    }
  }
</style>
