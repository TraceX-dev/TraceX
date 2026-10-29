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
    compareDefinitionPackageVersions,
    parseDefinitionPackageRelease,
    type DefinitionPackageInstallation
  } from '@hcengineering/marketplace'
  import { createQuery } from '@hcengineering/presentation'
  import {
    Button,
    IconAdd,
    Label,
    Notice,
    SectionEmpty,
    SettingsCardsLayout,
    Spinner,
    showPopup
  } from '@hcengineering/ui'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import PackageCard from './PackageCard.svelte'
  import { disconnectDefinitionPackage } from '../installations'
  import DefinitionPackageInstallPopup from './DefinitionPackageInstallPopup.svelte'
  import DefinitionPackageUpdatePopup from './DefinitionPackageUpdatePopup.svelte'
  import { downloadCatalogRelease, hasMarketplace } from '../catalog'

  const query = createQuery()
  let installations: DefinitionPackageInstallation[] = []
  let loading = true
  let busy = false
  let error = ''
  let upToDate: string | undefined
  query.query(marketplace.class.DefinitionPackageInstallation, {}, (result) => {
    installations = result
    loading = false
  })

  function importFile (installation?: DefinitionPackageInstallation): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.yaml,.yml,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (file === undefined) return
      try {
        const source = await file.text()
        if (installation === undefined) showPopup(DefinitionPackageInstallPopup, { source }, 'centered')
        else showPopup(DefinitionPackageUpdatePopup, { source, installation }, 'centered')
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
    }
    input.click()
  }

  async function disconnect (installation: DefinitionPackageInstallation): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    try {
      await disconnectDefinitionPackage(installation)
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  async function updateFromCatalog (installation: DefinitionPackageInstallation): Promise<void> {
    if (busy || installation.package.author === undefined) return
    busy = true
    error = ''
    upToDate = undefined
    try {
      const source = await downloadCatalogRelease({ id: installation.package.id, author: installation.package.author })
      const release = await parseDefinitionPackageRelease(source)
      if (compareDefinitionPackageVersions(release.package.version, installation.package.version) <= 0) {
        upToDate = installation._id
      } else showPopup(DefinitionPackageUpdatePopup, { source, installation }, 'centered')
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }
</script>

<div class="flex-col flex-gap-4">
  <div class="flex-between flex-wrap flex-gap-3">
    <span class="font-medium"><Label label={marketplace.string.InstalledPackages} /></span>
    <Button
      label={marketplace.string.InstallPackage}
      icon={IconAdd}
      kind="primary"
      disabled={busy}
      on:click={() => importFile()}
    />
  </div>
  {#if loading}
    <div class="flex-center p-4"><Spinner /></div>
  {:else if installations.length === 0}
    <SectionEmpty icon={marketplace.icon.Marketplace} label={marketplace.string.NoInstalledPackages} />
  {:else}
    <SettingsCardsLayout columns={2}>
      {#each installations as installation (installation._id)}
        <div data-id="installed-package">
          <PackageCard
            name={installation.name}
            version={installation.package.version}
            description={installation.package.description}
          >
            {#if upToDate === installation._id}<Notice label={marketplace.string.NoNewVersion} kind="positive" />{/if}
            <svelte:fragment slot="actions">
              {#if hasMarketplace() && installation.package.author !== undefined}
                <Button
                  label={marketplace.string.UpdateFromCatalog}
                  kind="primary"
                  disabled={busy}
                  on:click={() => updateFromCatalog(installation)}
                />
              {/if}
              <Button
                label={marketplace.string.UpdatePackage}
                disabled={busy}
                on:click={() => importFile(installation)}
              />
              <Button
                label={marketplace.string.DisconnectFromPackage}
                kind="ghost"
                disabled={busy}
                on:click={() => disconnect(installation)}
              />
            </svelte:fragment>
          </PackageCard>
        </div>
      {/each}
    </SettingsCardsLayout>
  {/if}
  {#if error}<div data-id="package-installation-error">
      <Notice label={getEmbeddedLabel(error)} kind="error" />
    </div>{/if}
</div>
