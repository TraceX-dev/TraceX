<!--
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { type CopyAsMarkdownTableProps } from '@hcengineering/converter'
  import { type Class, type Doc, type Ref } from '@hcengineering/core'
  import { translate } from '@hcengineering/platform'
  import { Card, getClient } from '@hcengineering/presentation'
  import { getCurrentLanguage } from '@hcengineering/theme'
  import { DropdownLabelsIntl, EditBox, Label } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'

  import plugin from '../plugin'
  import { exportTable, type TableExportFormat, type TableExportScope } from '../tableExport'

  export let _class: Ref<Class<Doc>>
  export let props: CopyAsMarkdownTableProps
  /** Rows the user ticked. */
  export let selected: Doc[] = []
  /** Rows currently rendered by the table, in render order. */
  export let page: Doc[] = []

  const dispatch = createEventDispatcher()
  const client = getClient()

  const formatItems = [
    { id: 'csv' as const, label: plugin.string.ExportCSV },
    { id: 'json' as const, label: plugin.string.ExportJSON },
    { id: 'md' as const, label: plugin.string.ExportMarkdown }
  ]

  let format: TableExportFormat = 'csv'
  // Offering "selected" when nothing is ticked would be a dead option.
  let scope: TableExportScope = selected.length > 0 ? 'selected' : 'page'
  let fileName = ''
  let exporting = false

  $: scopeItems = [
    ...(selected.length > 0
      ? [{ id: 'selected' as const, label: plugin.string.ExportScopeSelected, params: { count: selected.length } }]
      : []),
    { id: 'page' as const, label: plugin.string.ExportScopeLoaded, params: { count: page.length } }
  ]

  $: docs = scope === 'selected' ? selected : page

  onMount(() => {
    void suggestFileName()
  })

  async function suggestFileName(): Promise<void> {
    if (fileName !== '') return
    let title = String(_class)
    try {
      const label = client.getHierarchy().getClass(_class).label
      const translated = await translate(label, {}, getCurrentLanguage())
      if (translated.length > 0) title = translated
    } catch {
      // an unknown classifier: the raw ref is a poor but harmless name
    }
    fileName = `${title}-${new Date().toISOString().slice(0, 10)}`.replace(/[\\/:*?"<>|]/g, '_')
  }

  async function run(): Promise<void> {
    if (exporting || docs.length === 0) return
    exporting = true
    try {
      await exportTable({
        docs,
        props: { ...props, cardClass: _class },
        format,
        fileName: fileName !== '' ? fileName : 'export'
      })
      dispatch('close')
    } finally {
      exporting = false
    }
  }
</script>

<Card
  label={plugin.string.Export}
  okLabel={plugin.string.Export}
  okAction={run}
  canSave={!exporting && docs.length > 0}
  on:close={() => {
    dispatch('close')
  }}
>
  <div class="antiGrid">
    <div class="antiGrid-row">
      <div class="antiGrid-row__header"><Label label={plugin.string.ExportFormat} /></div>
      <div class="antiGrid-row__content">
        <DropdownLabelsIntl items={formatItems} bind:selected={format} />
      </div>
    </div>

    <div class="antiGrid-row">
      <div class="antiGrid-row__header"><Label label={plugin.string.ExportSource} /></div>
      <div class="antiGrid-row__content">
        <DropdownLabelsIntl items={scopeItems} bind:selected={scope} />
      </div>
    </div>

    <div class="antiGrid-row">
      <div class="antiGrid-row__header"><Label label={plugin.string.ExportFileName} /></div>
      <div class="antiGrid-row__content">
        <EditBox bind:value={fileName} placeholder={plugin.string.ExportFileName} />
      </div>
    </div>
  </div>
</Card>
