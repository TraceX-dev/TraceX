<!--
//
// Copyright © 2025 Hardcore Engineering Inc.
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
//
-->
<script lang="ts">
  import presentation, { Card } from '@hcengineering/presentation'
  import textEditor from '@hcengineering/text-editor'
  import { DropdownLabelsIntl, Label } from '@hcengineering/ui'
  import view, { type TableMetadata, type TableSnapshot } from '@hcengineering/view'
  import { createEventDispatcher } from 'svelte'

  import StructuredTableDiff from './StructuredTableDiff.svelte'
  import TableSourceInfo from './TableSourceInfo.svelte'
  import type { TableDiffSide } from './tableDiff'

  /** The table as it is in the document now. */
  export let current: TableDiffSide
  /** The table as the source would render it now. */
  export let fresh: TableDiffSide
  /** Values as they were copied; enables the "copied values ↔ source" comparison. */
  export let baseline: TableSnapshot | undefined = undefined
  export let metadata: TableMetadata

  let comparison: 'current' | 'snapshot' = 'current'
  const comparisonItems = [
    { id: 'current', label: view.string.CompareCurrentTable },
    { id: 'snapshot', label: view.string.CompareSnapshot }
  ]
  $: compared = comparison === 'snapshot' && baseline !== undefined ? baseline : current

  const dispatch = createEventDispatcher()

  function handleClose (): void {
    dispatch('close')
  }
</script>

<Card
  label={textEditor.string.TableDiffLabel}
  fullSize={true}
  canSave={true}
  okLabel={presentation.string.Ok}
  okAction={handleClose}
  onCancel={handleClose}
  on:close={handleClose}
>
  {#if baseline !== undefined}
    <div class="comparison">
      <Label label={view.string.TableCompare} />
      <DropdownLabelsIntl items={comparisonItems} bind:selected={comparison} />
    </div>
  {/if}
  <div class="table-diff-container">
    <StructuredTableDiff oldTable={compared} newTable={fresh} />
  </div>
  <TableSourceInfo {metadata} />
</Card>

<style>
  .comparison {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0 1rem 0.75rem;
  }
  .table-diff-container {
    padding: 0rem 1rem;
    overflow: auto;
    max-height: 80vh;
  }
</style>
