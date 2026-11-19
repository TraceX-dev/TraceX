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
  import marketplace from '@hcengineering/marketplace'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { Breadcrumb, Button, Header, IconAdd, Notice, Scroller, TabsControl, showPopup } from '@hcengineering/ui'
  import { hasMarketplace } from '../catalog'
  import InstalledPackages from './InstalledPackages.svelte'
  import PackageCatalog from './PackageCatalog.svelte'
  import PublishPackagePopup from './PublishPackagePopup.svelte'

  const configured = hasMarketplace()
  const tabs = [
    { label: marketplace.string.Catalog },
    { label: marketplace.string.InstalledPackages },
    { label: marketplace.string.MyPublications }
  ]
  let selected = configured ? 0 : 1
  let search: string | undefined = ''
  let catalog: PackageCatalog | undefined
  let error = ''

  function publishFile (): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.yaml,.yml,.json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (file === undefined) return
      error = ''
      try {
        const source = await file.text()
        showPopup(PublishPackagePopup, { source }, 'centered', (): void => {
          void catalog?.reload()
        })
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
    }
    input.click()
  }
</script>

<div class="hulyComponent">
  <Header adaptive="disabled">
    <Breadcrumb icon={marketplace.icon.Marketplace} label={marketplace.string.Marketplace} size="large" isCurrent />
    <svelte:fragment slot="actions">
      {#if configured && selected === 2}
        <Button label={marketplace.string.PublishPackage} icon={IconAdd} kind="primary" on:click={publishFile} />
      {/if}
    </svelte:fragment>
  </Header>
  <TabsControl model={tabs} bind:selected padding="0 var(--spacing-3)" size="small" />
  <div class="hulyComponent-content__column content">
    <Scroller align="center" padding="var(--spacing-3)" bottomPadding="var(--spacing-3)">
      <div class="hulyComponent-content flex-gap-4">
        {#if selected === 1}
          <InstalledPackages />
        {:else}
          {#key selected}
            <PackageCatalog bind:this={catalog} bind:search mine={selected === 2} />
          {/key}
        {/if}
        {#if error}<Notice label={getEmbeddedLabel(error)} kind="error" />{/if}
      </div>
    </Scroller>
  </div>
</div>
