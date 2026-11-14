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
  import marketplace, { type CatalogPackage, type CatalogRelease } from '@hcengineering/marketplace'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { Button, Dialog, Notice, showPopup } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import { downloadCatalogRelease, getMarketplaceClient } from '../catalog'
  import DefinitionPackageInstallPopup from './DefinitionPackageInstallPopup.svelte'
  import PackageCard from './PackageCard.svelte'

  export let entry: CatalogPackage

  const dispatch = createEventDispatcher<{ close: void }>()
  let releases: CatalogRelease[] = []
  let offset: number | undefined = 0
  let busy = false
  let error = ''

  async function load (): Promise<void> {
    if (busy || offset === undefined) return
    busy = true
    error = ''
    try {
      const page = await getMarketplaceClient().releases(entry, offset)
      const versions = new Set(releases.map((release) => release.version))
      releases = [...releases, ...page.items.filter((release) => !versions.has(release.version))]
      offset = page.nextOffset
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }
  void load()

  async function install (version: string): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    try {
      const source = await downloadCatalogRelease(entry, version)
      showPopup(DefinitionPackageInstallPopup, { source }, 'centered')
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }
</script>

<Dialog
  label={marketplace.string.VersionHistory}
  width="40rem"
  padding="var(--spacing-3)"
  on:close={() => dispatch('close')}
>
  <div class="flex-col flex-gap-4">
    <PackageCard
      name={entry.name}
      version={entry.version}
      description={entry.description}
      kind={entry.kind}
      authorName={entry.authorName}
      contactEmail={entry.contactEmail}
    />
    {#each releases as release (release.version)}
      <div class="release-row flex-between flex-gap-4" data-id="catalog-release">
        <div class="flex-col flex-gap-1">
          <span class="font-medium">v{release.version}</span>
          <time class="text-sm content-dark-color" datetime={new Date(release.publishedOn).toISOString()}>
            {new Date(release.publishedOn).toLocaleDateString()}
          </time>
        </div>
        <Button label={marketplace.string.InstallPackage} disabled={busy} on:click={() => install(release.version)} />
      </div>
    {/each}
    {#if offset !== undefined}<Button
        label={marketplace.string.LoadMore}
        loading={busy}
        disabled={busy}
        on:click={load}
      />{/if}
    {#if error}<div data-id="catalog-release-error"><Notice label={getEmbeddedLabel(error)} kind="error" /></div>{/if}
  </div>
</Dialog>

<style lang="scss">
  .release-row {
    padding-bottom: var(--spacing-3);
    border-bottom: 1px solid var(--theme-divider-color);
  }
</style>
