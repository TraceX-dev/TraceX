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
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import marketplace, {
    parseDefinitionPackageRelease,
    type DefinitionPackageDestination,
    type DefinitionPackageInstallation,
    type DefinitionPackageRelease,
    type PreparedDefinitionPackageUpdate
  } from '@hcengineering/marketplace'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import process, { type Process } from '@hcengineering/process'
  import { AccordionItem, Button, Dialog, Label, Notice, Scroller, Spinner } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'
  import { reviewDefinitionPackageUpdate, updateDefinitionPackage } from '../installations'
  import {
    packageUpdateCanApply,
    packageUpdateDocuments,
    packageUpdateNeedsResolution,
    packageUpdateStatus,
    packageUpdateVisibleChanges,
    type PackageUpdateStatus
  } from '../package-update-review'
  import PackageProcessDestinations from './PackageProcessDestinations.svelte'
  import PackageUpdateChange from './PackageUpdateChange.svelte'

  export let installation: DefinitionPackageInstallation
  export let source: string

  const dispatch = createEventDispatcher<{ close: boolean }>()
  let incoming: DefinitionPackageRelease | undefined
  let preview: PreparedDefinitionPackageUpdate | undefined
  let destinations = structuredClone(installation.destinations)
  let resolutions: Record<string, 'local' | 'upstream'> = {}
  let members: Process[] = []
  let loading = true
  let busy = false
  let error = ''
  const statuses: PackageUpdateStatus[] = ['decision', 'update', 'preserve', 'matches']
  const statusLabels = {
    decision: marketplace.string.ChooseVersion,
    update: marketplace.string.WillUpdate,
    preserve: marketplace.string.LocalChangesPreserved,
    matches: marketplace.string.AlreadyMatches
  }

  $: changes = (preview === undefined ? [] : packageUpdateVisibleChanges(preview)).sort(
    (left, right) =>
      statuses.indexOf(packageUpdateStatus(left, resolutions[left.key], preview?.blockedChanges.includes(left.key))) -
      statuses.indexOf(packageUpdateStatus(right, resolutions[right.key], preview?.blockedChanges.includes(right.key)))
  )
  $: currentDocuments = packageUpdateDocuments(preview?.reviewComponents ?? {}, 'local')
  $: incomingDocuments = packageUpdateDocuments(preview?.reviewComponents ?? {}, 'incoming')
  $: targetDocuments = packageUpdateDocuments(preview?.reviewComponents ?? {}, 'target')

  onMount(() => {
    void parseDefinitionPackageRelease(source)
      .then(async (release) => {
        incoming = release
        members =
          release.definition.kind === 'process'
            ? (release.definition.docs.filter((doc) => doc._class === process.class.Process) as unknown as Process[])
            : []
        destinations = Object.fromEntries(
          Object.entries(destinations).filter(([key]) => members.some((member) => member._id === key))
        )
        if (members.every((member) => destinations[member._id] !== undefined)) await review()
      })
      .catch((cause: unknown) => {
        error = cause instanceof Error ? cause.message : String(cause)
      })
      .finally(() => {
        loading = false
      })
  })

  async function review (): Promise<void> {
    if (busy || incoming === undefined) return
    busy = true
    error = ''
    try {
      preview = await reviewDefinitionPackageUpdate(installation, incoming, destinations, resolutions)
    } catch (cause) {
      preview = undefined
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  function resolve (key: string, value: 'local' | 'upstream'): void {
    resolutions = { ...resolutions, [key]: value }
    void review()
  }

  async function update (): Promise<void> {
    if (busy || incoming === undefined || preview === undefined || preview.blocked) return
    busy = true
    error = ''
    try {
      await updateDefinitionPackage(installation, incoming, destinations, resolutions, preview.fingerprint)
      dispatch('close', true)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      preview = undefined
    } finally {
      busy = false
    }
  }

  function changeDestinations (value: Record<string, DefinitionPackageDestination>): void {
    destinations = value
    resolutions = {}
    preview = undefined
  }
</script>

<Dialog
  label={marketplace.string.UpdatePackage}
  width="72rem"
  height="min(54rem, calc(100dvh - 3rem))"
  padding="0"
  isFullSize
  on:fullsize
  on:changeContent
  on:close={() => {
    if (!busy) dispatch('close', false)
  }}
>
  <div class="flex-col flex-grow min-h-0 min-w-0" data-id="package-update-review">
    <div class="summary flex-col flex-gap-2 flex-no-shrink">
      <div class="flex-row-center flex-wrap flex-gap-3">
        <h2>{installation.name}</h2>
        {#if incoming !== undefined}<span class="version text-sm"
            >v{installation.package.version} → v{incoming.package.version}</span
          >{/if}
      </div>
      <p class="text-sm content-dark-color"><Label label={marketplace.string.PackageUpdateExplanation} /></p>
      {#if preview !== undefined}
        <div class="flex-row-center flex-wrap flex-gap-3 text-sm" data-id="package-update-summary">
          {#each statuses as status (status)}
            {@const count = changes.filter(
              (change) =>
                packageUpdateStatus(change, resolutions[change.key], preview?.blockedChanges.includes(change.key)) ===
                status
            ).length}
            {#if count > 0}<span class="status"><Label label={statusLabels[status]} />: {count}</span>{/if}
          {/each}
        </div>
      {/if}
    </div>
    <Scroller padding="var(--spacing-5)" bottomPadding="var(--spacing-5)" noStretch>
      <div class="review-content flex-col flex-no-shrink min-w-0">
        {#if members.length > 0}
          <AccordionItem
            id={`package-update-destinations-${installation._id}`}
            label={process.string.RequiredSlots}
            size="large"
            kind="no-border"
            contentAlign="stretch"
            isOpen={members.some((member) => destinations[member._id] === undefined)}
          >
            <PackageProcessDestinations
              {members}
              {busy}
              {destinations}
              on:change={(event) => changeDestinations(event.detail)}
            />
          </AccordionItem>
        {/if}
        {#if error}<div data-id="package-update-error">
            <Notice label={getEmbeddedLabel(error)} kind="error" />
          </div>{/if}
        {#if preview !== undefined}
          {#if preview.missingDependencies}<Notice label={marketplace.string.UnresolvedPackageDependencies} />{/if}
          {#if changes.some((change) => change.class === process.class.Process && packageUpdateStatus(change, resolutions[change.key], preview?.blockedChanges.includes(change.key)) === 'update')}
            <Notice label={marketplace.string.ProcessChangesAffectActiveExecutions} />
          {/if}
          {#if changes.length === 0}<Notice label={marketplace.string.NoDefinitionChanges} />{/if}
          {#each changes as change (change.key)}
            <PackageUpdateChange
              {change}
              review={preview.reviewComponents[change.key]}
              {currentDocuments}
              {incomingDocuments}
              {targetDocuments}
              needsResolution={packageUpdateNeedsResolution(
                change,
                preview.missingDependencies,
                preview.blockedChanges.includes(change.key)
              )}
              blocked={preview.blockedChanges.includes(change.key)}
              choice={resolutions[change.key]}
              {busy}
              installationId={installation._id}
              on:resolve={(event) => resolve(change.key, event.detail)}
            />
          {/each}
        {:else if loading || busy}
          <div class="flex-center p-5"><Spinner /></div>
        {/if}
      </div>
    </Scroller>
  </div>
  <svelte:fragment slot="footerLeft">
    <Button
      label={marketplace.string.ReviewPackageChanges}
      disabled={busy || loading || incoming === undefined}
      on:click={review}
    />
  </svelte:fragment>
  <svelte:fragment slot="footerRight">
    <Button
      label={marketplace.string.UpdatePackage}
      kind="primary"
      disabled={!packageUpdateCanApply(preview, busy, loading)}
      on:click={update}
    />
  </svelte:fragment>
</Dialog>

<style>
  h2,
  p {
    margin: 0;
  }
  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  p {
    line-height: 1.5;
  }
  .summary {
    padding: var(--spacing-4) var(--spacing-5);
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .version,
  .status {
    padding: var(--spacing-1) var(--spacing-2);
    background: var(--theme-button-default);
    border-radius: var(--spacing-1);
  }
  .version {
    white-space: nowrap;
  }
  .review-content {
    width: 100%;
    gap: var(--spacing-4);
  }
</style>
