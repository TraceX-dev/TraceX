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
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->

<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'
  import { type Doc } from '@hcengineering/core'
  import exportPlugin, { hasDocumentContent } from '@hcengineering/export'
  import type { DocumentExportOrientation, DocumentExportSettingsValues } from '@hcengineering/export'
  import presentation, { Card, getClient } from '@hcengineering/presentation'
  import { DropdownLabelsIntl, Label, Loading, Toggle } from '@hcengineering/ui'
  import type { DropdownIntlItem } from '@hcengineering/ui'
  import { loadDocumentExporters, reportExportError, type DocumentExporterState } from '../exporters'

  export let objects: Doc[]
  export let onSubmit: (values: DocumentExportSettingsValues) => Promise<boolean>

  const contentId = 'export-content-toggle'
  const previewId = 'export-preview-toggle'
  const bulk = objects.length > 1
  const contentAvailable = objects.every((doc) => hasDocumentContent(getClient().getHierarchy(), doc))
  const orientations: Array<DropdownIntlItem<DocumentExportOrientation>> = [
    { id: 'portrait', label: exportPlugin.string.PortraitMode },
    { id: 'landscape', label: exportPlugin.string.LandscapeMode }
  ]
  const dispatch = createEventDispatcher<{ close: DocumentExportSettingsValues | undefined }>()

  let exporters: DocumentExporterState[] = []
  let exporter: DocumentExportSettingsValues['exporter'] | undefined
  let orientation: DocumentExportOrientation = 'portrait'
  let contentOnly = false
  let preview = true
  let result: DocumentExportSettingsValues | undefined
  let loading = true
  let submitting = false
  let closed = false

  $: formats = exporters.map(({ exporter, available }) => ({
    id: exporter._id,
    label: exporter.label,
    disabled: !available
  }))
  $: selected = exporters.find((state) => state.exporter._id === exporter)
  $: contentChecked =
    selected?.exporter.contentOnly === 'always' ||
    (selected?.exporter.contentOnly === 'optional' && contentAvailable && contentOnly)
  $: previewChecked = selected?.exporter.preview !== undefined && preview

  onMount(() => {
    void loadDocumentExporters(objects)
      .then((states) => {
        if (closed) return
        exporters = states
        exporter = states.find(({ available }) => available)?.exporter._id ?? states[0]?.exporter._id
      })
      .catch(reportExportError)
      .finally(() => {
        loading = false
      })
  })

  async function submit (): Promise<boolean> {
    if (submitting || selected?.available !== true || exporter === undefined) return false
    const settings: DocumentExportSettingsValues = {
      exporter,
      orientation,
      contentOnly: !bulk && contentChecked,
      preview: !bulk && previewChecked
    }
    submitting = true
    try {
      if (!(await onSubmit(settings)) || closed) return false
      result = settings
      return true
    } finally {
      submitting = false
    }
  }

  function changeContentOnly (event: CustomEvent<boolean>): void {
    contentOnly = event.detail
  }

  function changePreview (event: CustomEvent<boolean>): void {
    preview = event.detail
  }

  function close (): void {
    if (closed) return
    closed = true
    dispatch('close', result)
  }

  onDestroy(() => {
    closed = true
  })
</script>

<Card
  label={exportPlugin.string.Export}
  okLabel={exportPlugin.string.Export}
  canSave={!loading && !submitting && selected?.available === true}
  okAction={submit}
  width="small"
  on:close={close}
>
  {#if loading}
    <Loading />
  {:else}
    <div class="grid">
      <span class="label"><Label label={exportPlugin.string.ExportFormat} /></span>
      <DropdownLabelsIntl
        items={formats}
        bind:selected={exporter}
        disabled={submitting}
        width="100%"
        dataId="export-format"
      />

      <span class="label"><Label label={exportPlugin.string.Orientation} /></span>
      <DropdownLabelsIntl
        items={orientations}
        bind:selected={orientation}
        disabled={submitting || selected?.exporter.supportsOrientation !== true}
        width="100%"
        dataId="export-orientation"
      />

      {#if !bulk}
        <label class="label" for={contentId}><Label label={exportPlugin.string.OnlyContent} /></label>
        <Toggle
          inputId={contentId}
          data-id="export-content-only"
          on={contentChecked}
          disabled={submitting || !contentAvailable || selected?.exporter.contentOnly !== 'optional'}
          on:change={changeContentOnly}
        />

        <label class="label" for={previewId}><Label label={presentation.string.DocumentPreview} /></label>
        <Toggle
          inputId={previewId}
          data-id="export-preview"
          on={previewChecked}
          disabled={submitting || selected?.exporter.preview === undefined}
          on:change={changePreview}
        />
      {/if}
    </div>
  {/if}
</Card>

<style lang="scss">
  .grid {
    display: grid;
    grid-template-columns: 1fr 1.5fr;
    grid-auto-rows: minmax(var(--spacing-4), max-content);
    justify-content: start;
    padding: var(--spacing-1);
    align-items: center;
    row-gap: var(--spacing-1);
    column-gap: var(--spacing-2);
    height: min-content;
  }
</style>
