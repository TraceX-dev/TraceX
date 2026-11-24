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
  import card from '@hcengineering/card'
  import core, { getCurrentAccount, isOwnerOrMaintainer, type Ref } from '@hcengineering/core'
  import marketplace, {
    parseDefinitionPackageRelease,
    type DefinitionPackageDraft,
    type DefinitionPackageRelease,
    type ResolvedDefinitionPackage
  } from '@hcengineering/marketplace'
  import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
  import { getClient, MessageViewer } from '@hcengineering/presentation'
  import process from '@hcengineering/process'
  import { jsonToMarkup } from '@hcengineering/text-core'
  import { markdownToMarkup } from '@hcengineering/text-markdown'
  import {
    Button,
    Dialog,
    IconCheck,
    Label,
    Notice,
    Scroller,
    SelectPopup,
    Spinner,
    TabsControl,
    eventToHTMLElement,
    showPopup,
    tooltip
  } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'
  import { createPackageDraftPreview, draftCodeMarkup, type PackageDraftPreview } from '../package-draft-preview'
  import { hasMarketplace } from '../catalog'
  import DefinitionPackageInstallPopup from './DefinitionPackageInstallPopup.svelte'
  import PublishPackagePopup from './PublishPackagePopup.svelte'
  import PackageDraftProcessPreview from './PackageDraftProcessPreview.svelte'
  import PackageDraftType from './PackageDraftType.svelte'
  import PackageDependencies from './PackageDependencies.svelte'
  import PackageFieldLabelsPopup from './PackageFieldLabelsPopup.svelte'
  import { resolvePackageInstallation } from '../installations'

  interface ReviewTab {
    id: 'overview' | 'cards' | 'processes' | 'dependencies' | 'source'
    label: IntlString
  }

  export let draft: DefinitionPackageDraft

  const dispatch = createEventDispatcher<{ close: void }>()
  let release: DefinitionPackageRelease | undefined
  let resolved: ResolvedDefinitionPackage | undefined
  let dependencyError = ''
  let preview: PackageDraftPreview = { cards: [], processes: [] }
  let selected = 0
  let selectedProcessId: string | undefined
  let reviewMarkup = ''
  let sourceMarkup = ''
  let error = ''
  let scrollArea: HTMLElement | undefined | null
  const canInstall = isOwnerOrMaintainer()

  function loadDraft (current: DefinitionPackageDraft): void {
    error = ''
    dependencyError = ''
    resolved = undefined
    void parseDefinitionPackageRelease(current.release)
      .then(async (value) => {
        if (current !== draft) return
        preview = createPackageDraftPreview(value)
        reviewMarkup = jsonToMarkup(markdownToMarkup(current.review))
        sourceMarkup = draftCodeMarkup(current.release, 'yaml')
        release = value
        if (Object.keys(value.dependencies ?? {}).length > 0) {
          try {
            const tree = await resolvePackageInstallation(value)
            if (current === draft) resolved = tree
          } catch (cause) {
            if (current === draft) dependencyError = cause instanceof Error ? cause.message : String(cause)
          }
        }
      })
      .catch((cause: unknown) => {
        if (current === draft) error = cause instanceof Error ? cause.message : String(cause)
      })
  }

  onMount(() => {
    loadDraft(draft)
  })

  function reviewTabs (value: PackageDraftPreview, artifact: DefinitionPackageRelease | undefined): ReviewTab[] {
    const result: ReviewTab[] = [{ id: 'overview', label: marketplace.string.PackageOverview }]
    if (value.cards.length > 0) result.push({ id: 'cards', label: card.string.MasterTags })
    if (value.processes.length > 0) result.push({ id: 'processes', label: process.string.Processes })
    if (Object.keys(artifact?.dependencies ?? {}).length > 0)
      result.push({ id: 'dependencies', label: marketplace.string.PackageDependencies })
    result.push({ id: 'source', label: marketplace.string.PackageSource })
    return result
  }

  $: tabs = reviewTabs(preview, release)
  $: activeTab = tabs[selected]?.id ?? 'overview'
  $: selectedProcess =
    preview.processes.find((item) => item.definition._id === selectedProcessId) ?? preview.processes[0]
  $: fieldsCount = preview.cards.reduce((count, item) => count + item.fields.length, 0)

  function definitionLabel (value: unknown, fallback: string): IntlString {
    return typeof value === 'string' ? (value as IntlString) : getEmbeddedLabel(fallback)
  }

  function valueText (value: unknown): string {
    return typeof value === 'string' ? value : (JSON.stringify(value) ?? '—')
  }

  function selectProcess (event: MouseEvent): void {
    showPopup(
      SelectPopup,
      {
        value: preview.processes.map((item) => ({
          id: item.definition._id,
          label: getEmbeddedLabel(item.definition.name),
          isSelected: item.definition._id === selectedProcess?.definition._id
        })),
        searchable: true
      },
      eventToHTMLElement(event),
      (id: string | undefined): void => {
        if (id === undefined) return
        selectedProcessId = id
        scrollArea?.scrollTo({ top: 0 })
      }
    )
  }

  function download (): void {
    if (release === undefined) return
    const url = URL.createObjectURL(new Blob([draft.release], { type: 'application/yaml' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${release.package.id.replace(/\//g, '-')}-${release.package.version}.package.yaml`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  function install (): void {
    if (!isOwnerOrMaintainer() || release === undefined) return
    showPopup(DefinitionPackageInstallPopup, { source: draft.release }, 'centered')
  }

  function publish (): void {
    if (release === undefined) return
    showPopup(PublishPackagePopup, { source: draft.release }, 'centered')
  }

  function editFieldLabels (): void {
    showPopup(PackageFieldLabelsPopup, { base: { draft } }, 'centered', async (id?: Ref<DefinitionPackageDraft>) => {
      if (id === undefined) return
      try {
        const updated = await getClient().findOne(marketplace.class.DefinitionPackageDraft, { _id: id })
        if (updated !== undefined) {
          draft = updated
          loadDraft(updated)
        }
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
    })
  }

  function close (): void {
    dispatch('close')
  }
</script>

<Dialog
  label={marketplace.string.ReviewPackageDraft}
  width="72rem"
  height="min(54rem, calc(100dvh - 3rem))"
  padding="0"
  isFullSize
  on:fullsize
  on:changeContent
  on:close={close}
>
  <div class="flex-col flex-grow min-h-0 min-w-0" data-id="package-draft-review">
    {#if release !== undefined}
      <div class="summary flex-col flex-gap-2 flex-no-shrink">
        <div class="flex-row-center flex-wrap flex-gap-3">
          <h2>{draft.name}</h2>
          <span class="version text-sm">v{release.package.version}</span>
        </div>
        <div class="metadata flex-row-center flex-wrap flex-gap-4 text-sm content-dark-color">
          <span
            ><Label
              label={release.definition.kind === 'card'
                ? marketplace.string.CardModule
                : marketplace.string.ProcessBundle}
            /></span
          >
          {#if preview.cards.length > 0}<span><Label label={card.string.MasterTags} />: {preview.cards.length}</span
            >{/if}
          {#if fieldsCount > 0}<span><Label label={marketplace.string.Fields} />: {fieldsCount}</span>{/if}
          {#if preview.processes.length > 0}<span
              ><Label label={process.string.Processes} />: {preview.processes.length}</span
            >{/if}
        </div>
      </div>
      <div class="flex-no-shrink overflow-x-auto">
        <TabsControl model={tabs} bind:selected size="small" gap="medium" padding="0 var(--spacing-4)" noMargin />
      </div>
      {#if activeTab === 'processes' && selectedProcess !== undefined}
        <div class="process-toolbar flex-row-center flex-gap-3 flex-no-shrink">
          <Button label={getEmbeddedLabel(selectedProcess.definition.name)} on:click={selectProcess} />
          <span class="text-sm content-dark-color"
            ><Label label={marketplace.string.Transitions} />: {selectedProcess.transitions.length}</span
          >
        </div>
      {/if}
      {#key activeTab}
        <Scroller bind:divScroll={scrollArea} padding="var(--spacing-5)" bottomPadding="var(--spacing-5)" noStretch>
          <div class="review-content flex-col flex-no-shrink min-w-0" data-id="package-draft-scroll-content">
            {#if activeTab === 'overview'}
              {#if release.package.description}<p class="description content-dark-color">
                  {release.package.description}
                </p>{/if}
              <div class="overflow-x-auto" data-id="package-draft-explanation">
                <MessageViewer message={reviewMarkup} />
              </div>
              {#if !canInstall}<Notice label={marketplace.string.InstallationRequiresMaintainer} />{/if}
            {:else if activeTab === 'cards'}
              {#each preview.cards as item (item.definition._id)}
                <section class="flex-col flex-gap-3" data-id="package-draft-card-type">
                  <h3><Label label={definitionLabel(item.definition.label, item.definition._id)} /></h3>
                  <div class="fields-table overflow-x-auto">
                    <table>
                      <thead
                        ><tr>
                          <th><Label label={core.string.Name} /></th>
                          <th><Label label={marketplace.string.FieldType} /></th>
                          <th><Label label={marketplace.string.Required} /></th>
                          <th><Label label={marketplace.string.DefaultValue} /></th>
                        </tr></thead
                      >
                      <tbody>
                        {#each item.fields as field (field._id)}
                          <tr>
                            <td><Label label={definitionLabel(field.label, String(field.name ?? field._id))} /></td>
                            <td class="content-dark-color"
                              ><PackageDraftType value={field.type} documents={release.definition.docs} /></td
                            >
                            <td
                              >{#if field.required === true}<span use:tooltip={{ label: marketplace.string.Required }}
                                  ><span aria-hidden="true"><IconCheck size="small" /></span></span
                                >{:else}—{/if}</td
                            >
                            <td class="field-value"
                              >{field.defaultValue === undefined ? '—' : valueText(field.defaultValue)}</td
                            >
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                </section>
              {/each}
            {:else if activeTab === 'processes' && selectedProcess !== undefined}
              {#key selectedProcess.definition._id}
                <PackageDraftProcessPreview
                  preview={selectedProcess}
                  documents={release.definition.docs}
                  draftId={draft._id}
                />
              {/key}
            {:else if activeTab === 'dependencies'}
              {#if dependencyError}<Notice label={getEmbeddedLabel(dependencyError)} kind="error" />{/if}
              <PackageDependencies {release} {resolved} />
            {:else if activeTab === 'source'}
              <div class="overflow-x-auto" data-id="package-draft-source"><MessageViewer message={sourceMarkup} /></div>
            {/if}
          </div>
        </Scroller>
      {/key}
    {:else if !error}
      <div class="flex-center flex-grow p-5"><Spinner /></div>
    {/if}
    {#if error}
      <div class="p-5" data-id="package-draft-error"><Notice label={getEmbeddedLabel(error)} kind="error" /></div>
    {/if}
  </div>
  <svelte:fragment slot="footerLeft">
    {#if fieldsCount > 0 && draft.author === getCurrentAccount().uuid}
      <Button label={marketplace.string.EditFieldLabels} on:click={editFieldLabels} />
    {/if}
  </svelte:fragment>
  <svelte:fragment slot="footerRight">
    <Button label={marketplace.string.Export} disabled={release === undefined} on:click={download} />
    {#if hasMarketplace()}<Button
        label={marketplace.string.PublishPackage}
        disabled={release === undefined}
        on:click={publish}
      />{/if}
    {#if canInstall}<Button
        label={marketplace.string.InstallPackage}
        kind="primary"
        disabled={release === undefined}
        on:click={install}
      />{/if}
  </svelte:fragment>
</Dialog>

<style>
  h2,
  h3,
  p {
    margin: 0;
  }
  h2 {
    font-size: 1.25rem;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  h3 {
    font-size: 1rem;
    font-weight: 600;
  }
  .summary {
    padding: var(--spacing-4) var(--spacing-5);
  }
  .version {
    padding: var(--spacing-0_5) var(--spacing-2);
    background: var(--theme-button-default);
    border-radius: var(--spacing-1);
    white-space: nowrap;
  }
  .metadata {
    line-height: 1.5;
  }
  .review-content {
    width: 100%;
    gap: var(--spacing-5);
  }
  .description {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.6;
  }
  .process-toolbar {
    padding: var(--spacing-3) var(--spacing-5);
    border-bottom: 1px solid var(--theme-divider-color);
    flex-wrap: wrap;
  }
  .fields-table {
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--spacing-2);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  th {
    background: var(--theme-button-default);
    color: var(--theme-dark-color);
    font-weight: 500;
    text-align: left;
  }
  th,
  td {
    padding: var(--spacing-3) var(--spacing-4);
    vertical-align: top;
  }
  tbody tr + tr {
    border-top: 1px solid var(--theme-divider-color);
  }
  .field-value {
    overflow-wrap: anywhere;
    max-width: 18rem;
    white-space: pre-wrap;
  }
</style>
