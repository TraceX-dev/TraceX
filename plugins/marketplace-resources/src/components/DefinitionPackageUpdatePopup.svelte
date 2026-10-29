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
  import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
  import process, { type Process } from '@hcengineering/process'
  import diffview from '@hcengineering/diffview'
  import { createTwoFilesPatch } from 'diff'
  import { Button, Component, Dialog, Label, Notice } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'
  import { reviewDefinitionPackageUpdate, updateDefinitionPackage } from '../installations'
  import PackageProcessDestinations from './PackageProcessDestinations.svelte'
  import PackageCard from './PackageCard.svelte'

  export let installation: DefinitionPackageInstallation
  export let source: string

  const dispatch = createEventDispatcher<{ close: boolean }>()
  let incoming: DefinitionPackageRelease | undefined
  let preview: PreparedDefinitionPackageUpdate | undefined
  let destinations = structuredClone(installation.destinations)
  let resolutions: Record<string, 'local' | 'upstream'> = {}
  let members: Process[] = []
  let busy = false
  let error = ''
  let expanded: Record<string, boolean> = {}

  function patch (key: string, side: 'local' | 'incoming'): string {
    const review = preview?.reviews[key]
    return review === undefined
      ? ''
      : createTwoFilesPatch('definition.yaml', 'definition.yaml', review.baseline, review[side])
  }

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
  })

  async function review (): Promise<void> {
    if (busy || incoming === undefined) return
    busy = true
    preview = undefined
    error = ''
    try {
      preview = await reviewDefinitionPackageUpdate(installation, incoming, destinations, resolutions)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  function resolve (key: string, value: 'local' | 'upstream'): void {
    resolutions = { ...resolutions, [key]: value }
    void review()
  }

  function label (key: string): IntlString {
    const doc = [...(preview?.documents ?? []), ...(preview?.current ?? [])].find((item) => item._id === key)
    const data = doc as unknown as { name?: string, label?: IntlString } | undefined
    const original = Object.entries(preview?.installation.identities ?? {}).find(([, local]) => local === key)?.[0]
    const source = incoming?.definition.docs.find((doc) => doc._id === original)
    return (
      data?.label ??
      getEmbeddedLabel(data?.name ?? String(source?.name ?? source?.label ?? key).replace(/^embedded:embedded:/, ''))
    )
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
    preview = undefined
  }
</script>

<Dialog
  label={marketplace.string.UpdatePackage}
  width="64rem"
  on:close={() => {
    if (!busy) dispatch('close', false)
  }}
>
  <div class="flex-col flex-gap-4">
    {#if incoming !== undefined}
      <PackageCard
        name={installation.name}
        version={`${installation.package.version} → ${incoming.package.version}`}
        description={incoming.package.description}
        kind={incoming.definition.kind}
      />
      <PackageProcessDestinations
        {members}
        {busy}
        {destinations}
        on:change={(event) => changeDestinations(event.detail)}
      />
      <Button label={marketplace.string.ReviewPackageChanges} disabled={busy} on:click={review} />
    {/if}
    {#if preview !== undefined}
      {#each preview.changes as change (change.key)}
        <div class="flex-col flex-gap-2" data-id="package-update-change">
          <Label label={label(change.key)} />
          <Button
            label={marketplace.string.ShowChanges}
            kind="secondary"
            on:click={() => {
              expanded = { ...expanded, [change.key]: !expanded[change.key] }
            }}
          />
          {#if expanded[change.key]}
            {#if change.resolution !== 'local'}
              <Label label={marketplace.string.PublishedChanges} />
              <Component
                is={diffview.component.DiffView}
                props={{ patch: patch(change.key, 'incoming'), viewed: [] }}
              />
            {/if}
            {#if change.resolution === 'local' || change.resolution === 'conflict'}
              <Label label={marketplace.string.LocalChanges} />
              <Component is={diffview.component.DiffView} props={{ patch: patch(change.key, 'local'), viewed: [] }} />
            {/if}
          {/if}
          {#if change.impact === 'destructive' || change.impact === 'unknown'}
            <Label label={marketplace.string.MigrationRequired} />
          {/if}
          {#if change.resolution === 'local' && resolutions[change.key] !== 'upstream'}<Label
              label={marketplace.string.KeepLocalChanges}
            />{/if}
          {#if change.resolution === 'conflict' || change.resolution === 'local'}
            <div class="flex-row-center flex-gap-2">
              <Button
                label={marketplace.string.KeepLocalChanges}
                kind={resolutions[change.key] === 'local' ? 'primary' : 'secondary'}
                disabled={busy}
                on:click={() => resolve(change.key, 'local')}
              />
              <Button
                label={marketplace.string.UsePackageVersion}
                kind={resolutions[change.key] === 'upstream' ? 'primary' : 'secondary'}
                disabled={busy}
                on:click={() => resolve(change.key, 'upstream')}
              />
            </div>
          {/if}
        </div>
      {/each}
      {#if preview.missingDependencies}<Label label={marketplace.string.UnresolvedPackageDependencies} />{/if}
      {#if preview.changes.some((change) => change.class === process.class.Process && change.resolution !== 'local')}
        <Label label={marketplace.string.ProcessChangesAffectActiveExecutions} />
      {/if}
    {/if}
    {#if error}<div data-id="package-update-error"><Notice label={getEmbeddedLabel(error)} kind="error" /></div>{/if}
  </div>
  <svelte:fragment slot="footerRight">
    <Button
      label={marketplace.string.UpdatePackage}
      kind="primary"
      loading={busy}
      disabled={busy || preview === undefined || preview.blocked}
      on:click={update}
    />
  </svelte:fragment>
</Dialog>
