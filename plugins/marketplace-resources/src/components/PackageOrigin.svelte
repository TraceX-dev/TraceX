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
  import marketplace, { type CatalogPackageIdentity, type CatalogPackageOrigin } from '@hcengineering/marketplace'
  import { Label, getCurrentResolvedLocation, locationToUrl } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'
  import { getMarketplaceClient } from '../catalog'

  export let identity: CatalogPackageIdentity
  export let version: string

  let origin: CatalogPackageOrigin | undefined
  let generation = 0
  onDestroy(() => {
    generation++
  })

  async function load (identity: CatalogPackageIdentity, version: string): Promise<void> {
    const request = ++generation
    origin = undefined
    try {
      const value = await getMarketplaceClient().origin(identity, version)
      if (request === generation) origin = value
    } catch {
      // Fail closed when the authority cannot verify provenance access.
    }
  }

  $: void load(identity, version)
  $: href = origin === undefined ? '' : locationToUrl({
    path: [getCurrentResolvedLocation().path[0], origin.workspaceUrl, ...origin.path]
  })
</script>

{#if origin !== undefined}
  <div class="flex-col flex-gap-1 text-sm" data-id="package-origin">
    <span class="content-dark-color"><Label label={marketplace.string.Origin} /></span>
    <a {href}>{[origin.workspaceName, ...origin.labels].join(' › ')}</a>
  </div>
{/if}
