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
  import card, { type MasterTag } from '@hcengineering/card'
  import { type Ref } from '@hcengineering/core'
  import marketplace, {
    parseDefinitionPackageRelease,
    getDefinitionPackageProcessSlots,
    type DefinitionPackageDestination,
    type DefinitionPackageInstallation,
    type DefinitionPackageRelease
  } from '@hcengineering/marketplace'
  import process, { type Process } from '@hcengineering/process'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import { Button, Dialog, Label, Notice, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'
  import { installDefinitionPackage } from '../installations'
  import PackageProcessDestinations from './PackageProcessDestinations.svelte'
  import DefinitionPackageUpdatePopup from './DefinitionPackageUpdatePopup.svelte'
  import PackageCard from './PackageCard.svelte'
  import { getPackageName } from '../package-presentation'

  export let source: string
  export let masterTag: Ref<MasterTag> | undefined = undefined

  const dispatch = createEventDispatcher<{ close: boolean }>()
  let release: DefinitionPackageRelease | undefined
  let members: Process[] = []
  let existing: DefinitionPackageInstallation[] = []
  let destinations: Record<string, DefinitionPackageDestination> = {}
  let busy = false
  let error = ''

  onMount(() => {
    void parseDefinitionPackageRelease(source)
      .then(async (value) => {
        release = value
        members =
          value.definition.kind === 'process'
            ? (value.definition.docs.filter((doc) => doc._class === process.class.Process) as unknown as Process[])
            : []
        if (masterTag !== undefined && value.definition.kind === 'process') {
          destinations = Object.fromEntries(members.map((member) => [member._id, { masterTag, bindings: {} }]))
        }
        existing = (await getClient().findAll(marketplace.class.DefinitionPackageInstallation, {})).filter(
          (installation) =>
            installation.package.id === value.package.id && installation.package.author === value.package.author
        )
      })
      .catch((cause: unknown) => {
        error = cause instanceof Error ? cause.message : String(cause)
      })
  })

  async function install (): Promise<void> {
    if (busy || release === undefined) return
    busy = true
    error = ''
    try {
      await installDefinitionPackage(release, destinations)
      dispatch('close', true)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  $: canInstall =
    release !== undefined &&
    members.every((member) => {
      const target = destinations[member._id]
      return (
        target !== undefined &&
        Object.keys(getDefinitionPackageProcessSlots(member, members)).every(
          (key) => (target.bindings[key]?.trim().length ?? 0) > 0
        )
      )
    })
</script>

<Dialog
  label={marketplace.string.InstallPackage}
  width="44rem"
  padding="var(--spacing-3)"
  on:close={() => {
    if (!busy) dispatch('close', false)
  }}
>
  <div class="flex-col flex-gap-4">
    {#if release !== undefined}
      <PackageCard
        name={getPackageName(release)}
        version={release.package.version}
        description={release.package.description}
        kind={release.definition.kind}
      />
      {#if existing.length > 0}
        <Label label={marketplace.string.InstalledPackages} />
        {#each existing as installation (installation._id)}
          <div class="flex-between flex-wrap flex-gap-2">
            <span>{installation.name} · {installation.package.version}</span>
            <Button
              label={marketplace.string.UpdatePackage}
              kind="secondary"
              disabled={busy}
              on:click={() =>
                showPopup(DefinitionPackageUpdatePopup, { source, installation }, 'centered', (result) => {
                  if (result === true) dispatch('close', true)
                })}
            />
          </div>
        {/each}
      {/if}
      {#if release.definition.kind === 'card'}
        <div class="flex-col flex-gap-2">
          <span class="text-sm content-dark-color"><Label label={card.string.MasterTags} /></span>
          {#each release.definition.docs.filter((doc) => doc._class === card.class.MasterTag || doc._class === card.class.Tag) as type (type._id)}
            <span>{String(type.label ?? type._id).replace(/^embedded:embedded:/, '')}</span>
          {/each}
        </div>
      {/if}
      <PackageProcessDestinations {members} bind:destinations {busy} />
    {/if}
    {#if error}<div data-id="package-install-error"><Notice label={getEmbeddedLabel(error)} kind="error" /></div>{/if}
  </div>
  <svelte:fragment slot="footerRight">
    <Button
      label={existing.length > 0 ? marketplace.string.InstallAnotherInstance : marketplace.string.InstallPackage}
      kind="primary"
      loading={busy}
      disabled={busy || !canInstall}
      on:click={install}
    />
  </svelte:fragment>
</Dialog>
