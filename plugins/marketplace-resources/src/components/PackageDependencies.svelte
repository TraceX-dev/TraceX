<!--
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import marketplace, {
    type DefinitionPackageRelease,
    type ResolvedDefinitionPackage
  } from '@hcengineering/marketplace'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { AccordionItem, Label } from '@hcengineering/ui'
  import { createPackageDraftPreview } from '../package-draft-preview'
  import PackageCard from './PackageCard.svelte'
  import PackageDraftProcessPreview from './PackageDraftProcessPreview.svelte'

  export let release: DefinitionPackageRelease
  export let resolved: ResolvedDefinitionPackage | undefined = undefined
  export let path = 'dependencies'
</script>

{#if Object.keys(release.dependencies ?? {}).length > 0}
  <section class="flex-col flex-gap-3 min-w-0" data-id="package-dependencies">
    <Label label={marketplace.string.PackageDependencies} />
    {#each Object.entries(release.dependencies ?? {}) as [alias, dependency] (alias)}
      {@const child = resolved?.dependencies[alias]}
      <PackageCard
        name={dependency.id}
        version={dependency.version}
        authorName={dependency.author}
        kind={child?.release.definition.kind}
      >
        <div class="text-sm content-dark-color overflow-x-auto">{dependency.contentHash}</div>
        {#each Object.entries(dependency.destinations) as [member, destination] (member)}
          <div class="flex-col flex-gap-1 text-sm" data-id="package-dependency-destination">
            <span>{member} → {destination.masterTag}</span>
            {#each Object.entries(destination.bindings) as [slot, value] (slot)}
              <span class="content-dark-color">{slot} → {value}</span>
            {/each}
          </div>
        {/each}
        {#if child !== undefined}
          {#each createPackageDraftPreview(child.release).processes as preview (preview.definition._id)}
            <AccordionItem
              id={`${path}.${alias}.${preview.definition._id}`}
              label={getEmbeddedLabel(preview.definition.name)}
              size="large"
              contentAlign="stretch"
            >
              <PackageDraftProcessPreview
                {preview}
                documents={child.release.definition.docs}
                draftId={`${path}.${alias}`}
              />
            </AccordionItem>
          {/each}
          <svelte:self release={child.release} resolved={child} path={`${path}.${alias}`} />
        {/if}
      </PackageCard>
    {/each}
  </section>
{/if}
