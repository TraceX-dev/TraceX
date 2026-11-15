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
  import { type Doc, type Ref } from '@hcengineering/core'
  import marketplace, {
    type DefinitionPackageChange,
    type DefinitionPackageReviewComponents
  } from '@hcengineering/marketplace'
  import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import ui, { AccordionItem, Button, Label, Notice } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import {
    packageUpdateDifferences,
    packageUpdateDocumentLabel,
    packageUpdatePropertyLabel,
    packageUpdateStatus
  } from '../package-update-review'
  import PackageUpdateValue from './PackageUpdateValue.svelte'

  export let change: DefinitionPackageChange
  export let review: DefinitionPackageReviewComponents
  export let currentDocuments: Record<string, unknown>[]
  export let incomingDocuments: Record<string, unknown>[]
  export let targetDocuments: Record<string, unknown>[]
  export let needsResolution: boolean
  export let blocked: boolean
  export let choice: 'local' | 'upstream' | undefined
  export let busy: boolean
  export let installationId: string

  const dispatch = createEventDispatcher<{ resolve: 'local' | 'upstream' }>()
  const client = getClient()
  const statusLabels = {
    decision: marketplace.string.ChooseVersion,
    update: marketplace.string.WillUpdate,
    preserve: marketplace.string.LocalChangesPreserved,
    matches: marketplace.string.AlreadyMatches
  }
  const operationLabels = {
    added: marketplace.string.Added,
    removed: marketplace.string.Removed,
    modified: marketplace.string.Modified
  }
  $: status = packageUpdateStatus(change, choice, blocked)
  $: proposal = status === 'decision' || (needsResolution && change.resolution === 'local' && choice === undefined)
  $: differences = packageUpdateDifferences(
    review,
    proposal ? 'incoming' : 'target',
    proposal && change.conflictPaths !== undefined ? change.conflictPaths : undefined
  )
  $: afterDocuments = proposal ? incomingDocuments : targetDocuments
  $: root =
    (proposal ? review.incoming : review.target)?.documents[change.key]?.document ??
    review.local?.documents[change.key]?.document ??
    review.baseline?.documents[change.key]?.document

  function displayValue (key: string, value: unknown): unknown {
    return key === '$order' && typeof value === 'number' ? value + 1 : value
  }

  function classLabel (id: string): IntlString {
    return (
      client.getModel().findObject<Doc & { label?: IntlString }>(id as Ref<Doc>)?.label ??
      getEmbeddedLabel(id.split(':').pop() ?? id)
    )
  }
</script>

<section
  class="change flex-col flex-no-shrink"
  class:needs-decision={status === 'decision'}
  data-id="package-update-change"
>
  <AccordionItem
    id={`package-update-${installationId}-${change.key}`}
    size="large"
    kind="no-border"
    bottomSpace={false}
    contentAlign="stretch"
    isOpen={change.resolution === 'conflict'}
  >
    <svelte:fragment slot="title">
      <div class="heading flex-col flex-gap-1 min-w-0">
        <span class="text-sm content-dark-color"><Label label={classLabel(change.class)} /></span>
        <span
          ><Label
            label={root === undefined
              ? getEmbeddedLabel(change.key)
              : packageUpdateDocumentLabel(root, [...incomingDocuments, ...currentDocuments])}
          /></span
        >
      </div>
    </svelte:fragment>
    <svelte:fragment slot="actions"
      ><span class="status text-sm" data-id="package-update-status"><Label label={statusLabels[status]} /></span
      ></svelte:fragment
    >
    <div class="details flex-col flex-gap-4 min-w-0">
      {#each differences as document (document.id)}
        <div class="flex-col flex-gap-2" data-id="package-update-document">
          <div class="flex-row-center flex-wrap flex-gap-2">
            <span class="font-medium"><Label label={document.label} /></span>
            <span class="text-sm content-dark-color"
              ><Label label={classLabel(document.class)} /> · <Label
                label={operationLabels[document.operation]}
              /></span
            >
          </div>
          <div class="comparison overflow-x-auto">
            <table>
              <thead
                ><tr>
                  <th><Label label={marketplace.string.Property} /></th>
                  {#if document.operation !== 'added'}<th><Label label={marketplace.string.CurrentWorkspace} /></th
                    >{/if}
                  {#if document.operation !== 'removed'}<th
                      ><Label label={proposal ? marketplace.string.NewPackageVersion : ui.string.After} /></th
                    >{/if}
                </tr></thead
              >
              <tbody
                >{#each document.properties as property (property.key)}
                  <tr data-id="package-update-property">
                    <th><Label label={packageUpdatePropertyLabel(property.key)} /></th>
                    {#if document.operation === 'added'}
                      <td
                        ><PackageUpdateValue
                          value={displayValue(property.key, property.incoming)}
                          documents={afterDocuments}
                        /></td
                      >
                    {:else if document.operation === 'removed'}
                      <td
                        ><PackageUpdateValue
                          value={displayValue(property.key, property.current)}
                          documents={currentDocuments}
                        /></td
                      >
                    {:else if property.current === undefined || property.incoming === undefined}
                      <td colspan="2">
                        <span class="text-sm content-dark-color"
                          ><Label
                            label={property.current === undefined
                              ? marketplace.string.Added
                              : marketplace.string.Removed}
                          /></span
                        >
                        <div>
                          <PackageUpdateValue
                            value={displayValue(
                              property.key,
                              property.current === undefined ? property.incoming : property.current
                            )}
                            documents={property.current === undefined ? afterDocuments : currentDocuments}
                          />
                        </div>
                      </td>
                    {:else}
                      <td
                        ><PackageUpdateValue
                          value={displayValue(property.key, property.current)}
                          documents={currentDocuments}
                        /></td
                      >
                      <td
                        ><PackageUpdateValue
                          value={displayValue(property.key, property.incoming)}
                          documents={afterDocuments}
                        /></td
                      >
                    {/if}
                  </tr>
                {/each}</tbody
              >
            </table>
          </div>
        </div>
      {/each}
      {#if differences.length === 0}<span class="content-dark-color"
          ><Label
            label={status === 'preserve' ? marketplace.string.LocalChangesPreserved : marketplace.string.AlreadyMatches}
          /></span
        >{/if}
    </div>
  </AccordionItem>
  {#if blocked}
    <div class="decision flex-col flex-gap-2">
      <Notice label={marketplace.string.MigrationRequired} />
      <p class="text-sm content-dark-color">{change.reason}</p>
    </div>
  {/if}
  {#if needsResolution}
    <div class="decision flex-col flex-gap-3">
      {#if change.resolution === 'conflict'}<p class="text-sm content-dark-color">
          <Label label={marketplace.string.ConflictExplanation} />
        </p>{/if}
      <div class="flex-row-center flex-wrap flex-gap-2" data-id="package-update-resolution">
        <Button
          label={marketplace.string.KeepLocalChanges}
          kind={status === 'preserve' ? 'primary' : 'secondary'}
          disabled={busy}
          on:click={() => dispatch('resolve', 'local')}
        />
        <Button
          label={marketplace.string.UsePackageVersion}
          kind={choice === 'upstream' ? 'primary' : 'secondary'}
          disabled={busy}
          on:click={() => dispatch('resolve', 'upstream')}
        />
      </div>
    </div>
  {/if}
</section>

<style>
  .change {
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--spacing-2);
  }
  .needs-decision {
    border-color: var(--theme-link-color);
  }
  .heading {
    padding: var(--spacing-1) 0;
    white-space: normal;
    overflow-wrap: anywhere;
  }
  .status {
    padding: var(--spacing-1) var(--spacing-2);
    background: var(--theme-button-default);
    border-radius: var(--spacing-1);
    text-align: right;
  }
  .details,
  .decision {
    padding: var(--spacing-3) var(--spacing-4);
  }
  .decision {
    border-top: 1px solid var(--theme-divider-color);
  }
  p {
    margin: 0;
    line-height: 1.5;
  }
  .comparison {
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--spacing-1);
  }
  table {
    width: 100%;
    min-width: 36rem;
    table-layout: fixed;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  th,
  td {
    padding: var(--spacing-3);
    text-align: left;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  th {
    color: var(--theme-dark-color);
    font-weight: 500;
  }
  th:first-child {
    width: 24%;
  }
  thead {
    background: var(--theme-button-default);
  }
  tbody tr {
    border-top: 1px solid var(--theme-divider-color);
  }
  td + td {
    border-left: 1px solid var(--theme-divider-color);
  }
</style>
