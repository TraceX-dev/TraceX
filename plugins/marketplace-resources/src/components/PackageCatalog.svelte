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
  import type { MasterTag } from '@hcengineering/card'
  import type { Ref } from '@hcengineering/core'
  import marketplace, { type CatalogPackage, type DefinitionPackageInstallation } from '@hcengineering/marketplace'
  import { createQuery, MessageBox } from '@hcengineering/presentation'
  import ui, {
    Button,
    IconAdd,
    IconDelete,
    IconHistory,
    Label,
    Notice,
    SearchInput,
    SectionEmpty,
    SettingsCardsLayout,
    Spinner,
    showPopup
  } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { createEventDispatcher, onDestroy } from 'svelte'
  import { downloadCatalogRelease, getInstalledPackageVersions, getMarketplaceClient, hasMarketplace } from '../catalog'
  import { listCatalogPackages } from '../catalog-search'
  import DefinitionPackageInstallPopup from './DefinitionPackageInstallPopup.svelte'
  import PackageVersionsPopup from './PackageVersionsPopup.svelte'
  import PackageCard from './PackageCard.svelte'
  import PackageOrigin from './PackageOrigin.svelte'
  import PackageAccessPopup from './PackageAccessPopup.svelte'

  export let kind: CatalogPackage['kind'] | undefined = undefined
  export let masterTag: Ref<MasterTag> | undefined = undefined
  export let mine = false
  export let columns: 1 | 2 = 2
  export let autoFocus = false
  export let search: string | undefined = ''

  const configured = hasMarketplace()
  const dispatch = createEventDispatcher<{ installed: void }>()
  let entries: CatalogPackage[] = []
  let installations: DefinitionPackageInstallation[] = []
  const installationsQuery = createQuery()
  installationsQuery.query(marketplace.class.DefinitionPackageInstallation, {}, (result) => {
    installations = result
  })
  let nextOffset: number | undefined
  let loading = false
  let busy = false
  let error = ''
  let generation = 0
  let destroyed = false
  onDestroy(() => {
    generation++
    destroyed = true
  })

  export async function reload (query: string | undefined = search, own = mine, packageKind = kind): Promise<void> {
    const request = ++generation
    error = ''
    entries = []
    nextOffset = undefined
    loading = false
    if (!configured) return
    loading = true
    try {
      const page = await listCatalogPackages(
        getMarketplaceClient(),
        { search: query, mine: own },
        packageKind,
        () => request === generation
      )
      if (request !== generation) return
      entries = page.items
      nextOffset = page.nextOffset
    } catch (cause) {
      if (request === generation) error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (request === generation) loading = false
    }
  }

  async function loadMore (): Promise<void> {
    if (loading || nextOffset === undefined) return
    const request = generation
    loading = true
    error = ''
    try {
      const page = await listCatalogPackages(
        getMarketplaceClient(),
        { search, mine, offset: nextOffset },
        kind,
        () => request === generation
      )
      if (request !== generation) return
      const keys = new Set(entries.map((entry) => `${entry.author}/${entry.id}`))
      entries = [...entries, ...page.items.filter((entry) => !keys.has(`${entry.author}/${entry.id}`))]
      nextOffset = page.nextOffset
    } catch (cause) {
      if (request === generation) error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (request === generation) loading = false
    }
  }

  function installed (result: unknown): void {
    if (result === true && !destroyed) dispatch('installed')
  }

  async function install (entry: CatalogPackage): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    try {
      const source = await downloadCatalogRelease(entry, entry.version)
      if (destroyed) return
      showPopup(DefinitionPackageInstallPopup, { source, masterTag }, 'centered', installed)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  async function toggleVisibility (entry: CatalogPackage): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    try {
      await getMarketplaceClient().setVisibility(entry, entry.visibility === 'private' ? 'public' : 'private')
      await reload()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  function deletePackage (entry: CatalogPackage): void {
    if (busy || destroyed) return
    showPopup(
      MessageBox,
      {
        label: marketplace.string.DeletePackage,
        message: marketplace.string.DeletePackageConfirmation,
        params: { name: entry.name },
        okLabel: marketplace.string.DeletePackage,
        dangerous: true,
        action: async () => {
          busy = true
          error = ''
          try {
            await getMarketplaceClient().delete(entry)
          } finally {
            busy = false
          }
        }
      },
      'centered',
      (result) => {
        if (result === true && !destroyed) void reload()
      }
    )
  }

  $: void reload(search, mine, kind)
</script>

<div class="flex-col flex-gap-4" data-id="marketplace-catalog">
  {#if !configured}
    <Notice label={marketplace.string.MarketplaceNotConfigured} />
  {:else}
    <div class="flex-col flex-gap-4">
      <div class="text-sm content-dark-color"><Label label={marketplace.string.CatalogDescription} /></div>
      <div class="catalog-search w-full"><SearchInput bind:value={search} width="100%" {autoFocus} /></div>
    </div>
    {#if entries.length > 0}
      <SettingsCardsLayout {columns}>
        {#each entries as entry (`${entry.author}/${entry.id}`)}
          <div data-id="catalog-package">
            <PackageCard
              name={entry.name}
              version={entry.version}
              description={entry.description}
              kind={entry.kind}
              authorName={entry.authorName}
              contactEmail={entry.contactEmail}
              publishedOn={entry.publishedOn}
              visibility={entry.visibility}
              installedVersions={getInstalledPackageVersions(entry, installations)}
            >
              <PackageOrigin identity={entry} version={entry.version} />
              <svelte:fragment slot="actions">
                <Button
                  label={marketplace.string.InstallPackage}
                  icon={IconAdd}
                  kind="primary"
                  disabled={busy}
                  on:click={() => install(entry)}
                />
                <Button
                  label={marketplace.string.VersionHistory}
                  icon={IconHistory}
                  kind="ghost"
                  disabled={busy}
                  on:click={() => {
                    showPopup(PackageVersionsPopup, { entry, masterTag }, 'centered', installed)
                  }}
                />
                {#if mine}
                  <div data-id="package-manage-access">
                    <Button
                      label={marketplace.string.ManagePackageAccess}
                      kind="ghost"
                      disabled={busy}
                      on:click={() => {
                        showPopup(PackageAccessPopup, { entry }, 'centered', () => {
                          void reload()
                        })
                      }}
                    />
                  </div>
                  <div data-id="package-toggle-visibility">
                    <Button
                      label={entry.visibility === 'private'
                        ? marketplace.string.MakePublic
                        : marketplace.string.MakePrivate}
                      kind="ghost"
                      disabled={busy}
                      on:click={() => toggleVisibility(entry)}
                    />
                  </div>
                  <div data-id="package-delete">
                    <Button
                      label={marketplace.string.DeletePackage}
                      icon={IconDelete}
                      kind="dangerous"
                      disabled={busy}
                      on:click={() => deletePackage(entry)}
                    />
                  </div>
                {/if}
              </svelte:fragment>
            </PackageCard>
          </div>
        {/each}
      </SettingsCardsLayout>
    {:else if !loading && !error}
      <SectionEmpty
        icon={marketplace.icon.Marketplace}
        label={mine && (search ?? '') === '' ? marketplace.string.NoPublishedPackages : ui.string.NoResults}
      />
    {/if}
    {#if loading}<div class="flex-center p-4"><Spinner /></div>{/if}
    {#if nextOffset !== undefined && !loading}
      <div class="flex-center"><Button label={marketplace.string.LoadMore} on:click={loadMore} /></div>
    {/if}
    {#if error}<div data-id="marketplace-error"><Notice label={getEmbeddedLabel(error)} kind="error" /></div>{/if}
  {/if}
</div>

<style lang="scss">
  .catalog-search {
    max-width: 24rem;
  }
</style>
