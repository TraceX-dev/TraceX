<!--
//
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
  import type { Doc } from '@hcengineering/core'
  import type { CopyAsMarkdownTableProps, CopyRelationshipTableAsMarkdownProps } from '@hcengineering/converter'
  import type { IntlString } from '@hcengineering/platform'
  import { Card, getClient } from '@hcengineering/presentation'
  import { Button, DropdownLabelsIntl, Label } from '@hcengineering/ui'
  import view, {
    MAX_TABLE_ROWS,
    TableSourceError,
    tableSourceErrorMessage,
    type ResolvedTableSnapshot,
    type TableSource,
    type TableSourceMode
  } from '@hcengineering/view'
  import { createEventDispatcher, onMount } from 'svelte'
  import { type TableCopyFormat, writeTableToClipboard } from '../markdown/copyActions'
  import { buildRelationshipTablePropsFromMetadata } from '../markdown/tableBuilder'
  import { modelToConfig } from '../model/tableModel'
  import { captureRelationshipSnapshot, captureTableSnapshot, captureViewSnapshot } from '../trackedTable'

  /** Card class, columns, the query the view ran and its source (see openCopyTableDialog). */
  export let props: CopyAsMarkdownTableProps
  /** Rows the action was invoked on, in view order. */
  export let selected: Doc[] = []
  /** Rows the view has loaded, in view order. */
  export let loaded: Doc[] = []
  export let relationship: CopyRelationshipTableAsMarkdownProps | undefined = undefined

  type Scope = 'selection' | 'loaded' | 'view'

  const dispatch = createEventDispatcher()
  const client = getClient()
  const formatStorageKey = 'tracex.copyTable.format'

  function storedFormat (): TableCopyFormat {
    try {
      return localStorage.getItem(formatStorageKey) === 'markdown' ? 'markdown' : 'tracex'
    } catch {
      return 'tracex'
    }
  }

  let format: TableCopyFormat = storedFormat()
  let scope: Scope = selected.length > 0 ? 'selection' : props.query !== undefined ? 'view' : 'loaded'
  let total: number | undefined
  let savedViewName = ''
  let copying = false
  let error: { label: IntlString, params: Record<string, string | number> } | undefined

  const formatItems = [
    { id: 'tracex', label: view.string.TraceXTable },
    { id: 'markdown', label: view.string.MarkdownTable }
  ]

  onMount(async () => {
    if (props.query !== undefined) {
      try {
        const result = await client.findAll(props.cardClass, props.query, { limit: 1, total: true })
        total = result.total >= 0 ? result.total : undefined
      } catch (err) {
        console.warn('Failed to count table rows', err)
      }
    }
    if (props.source?.filteredViewId !== undefined) {
      const filtered = await client.findOne(view.class.FilteredView, { _id: props.source.filteredViewId })
      savedViewName = filtered?.name ?? ''
    }
  })

  // "Loaded rows" is only a distinct choice while the view has not loaded everything.
  $: showLoaded =
    loaded.length > 0 && loaded.length !== selected.length && (total === undefined || loaded.length < total)
  $: scopeItems = [
    ...(selected.length > 0
      ? [{ id: 'selection', label: view.string.SelectedRows, params: { count: selected.length } }]
      : []),
    ...(showLoaded ? [{ id: 'loaded', label: view.string.LoadedRows, params: { count: loaded.length } }] : []),
    ...(props.query !== undefined
      ? [
          total === undefined
            ? { id: 'view', label: view.string.EntireView }
            : { id: 'view', label: view.string.EntireViewCount, params: { count: total } }
        ]
      : [])
  ]
  $: rows = scope === 'selection' ? selected : loaded
  $: mode = (
    scope !== 'view' ? 'fixed' : props.source?.filteredViewId !== undefined ? 'savedView' : 'frozen'
  ) as TableSourceMode
  $: tooLarge = scope === 'view' && total !== undefined && total > MAX_TABLE_ROWS
  $: hint =
    format === 'markdown'
      ? { label: view.string.MarkdownTableHint, params: {} }
      : mode === 'fixed'
        ? { label: view.string.TableModeFixedHint, params: { count: rows.length } }
        : mode === 'savedView'
          ? { label: view.string.TableModeSavedViewHint, params: { name: savedViewName } }
          : { label: view.string.TableModeFrozenHint, params: {} }
  $: notice = tooLarge
    ? tableSourceErrorMessage(new TableSourceError('tooLarge', { count: total ?? 0, limit: MAX_TABLE_ROWS }))
    : error
  $: canCopy = !copying && !tooLarge && (scope === 'view' || rows.length > 0)

  function sourceFor (selectedMode: TableSourceMode): TableSource {
    const kind = relationship === undefined ? 'table' : 'relationship'
    if (selectedMode === 'fixed') return { kind, mode: 'fixed' }
    const { filteredViewId, baseQuery, baseOptions, ...rest } = props.source ?? { kind, mode: selectedMode }
    return selectedMode === 'savedView'
      ? { ...rest, kind, mode: selectedMode, filteredViewId, baseQuery, baseOptions }
      : { ...rest, kind, mode: selectedMode }
  }

  async function resolve (): Promise<ResolvedTableSnapshot> {
    const source = sourceFor(mode)
    const config = relationship === undefined ? props.config : modelToConfig(relationship.model)
    if (scope === 'view') return await captureViewSnapshot({ ...props, config }, source, client)
    if (relationship === undefined) return await captureTableSnapshot(rows, { ...props, source }, client)
    const rebuilt = await buildRelationshipTablePropsFromMetadata(rows, { cardClass: props.cardClass, config }, client)
    return await captureRelationshipSnapshot({ ...rebuilt, viewlet: props.viewlet, source }, client)
  }

  async function copy (): Promise<void> {
    if (!canCopy) return
    copying = true
    error = undefined
    try {
      await writeTableToClipboard(await resolve(), format)
      try {
        localStorage.setItem(formatStorageKey, format)
      } catch {}
      dispatch('close')
    } catch (err) {
      console.error('Failed to copy table', err)
      error = tableSourceErrorMessage(err)
    } finally {
      copying = false
    }
  }
</script>

<!-- The footer button is ours: Card's own OK flow closes the dialog even when copying fails. -->
<Card
  label={view.string.CopyAsMarkdownTable}
  okAction={copy}
  canSave={false}
  width="small"
  on:close={() => dispatch('close')}
  on:changeContent
>
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    class="fields"
    on:keydown={(event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void copy()
    }}
  >
    <span class="caption"><Label label={view.string.TableFormat} /></span>
    <DropdownLabelsIntl
      items={formatItems}
      bind:selected={format}
      disabled={copying}
      kind="regular"
      size="large"
      width="100%"
      justify="left"
    />
    <span class="caption"><Label label={view.string.TableRows} /></span>
    <DropdownLabelsIntl
      items={scopeItems}
      bind:selected={scope}
      disabled={copying}
      kind="regular"
      size="large"
      width="100%"
      justify="left"
    />
  </div>
  <div class="hint secondary-textColor"><Label label={hint.label} params={hint.params} /></div>
  <svelte:fragment slot="error">
    {#if notice !== undefined}<Label label={notice.label} params={notice.params} />{/if}
  </svelte:fragment>
  <svelte:fragment slot="after-buttons">
    <Button
      label={view.string.CopyToClipboard}
      kind="primary"
      size="large"
      loading={copying}
      disabled={!canCopy}
      on:click={copy}
    />
  </svelte:fragment>
</Card>

<style lang="scss">
  .fields {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    align-items: center;
    gap: 0.75rem 1.5rem;
  }
  .caption {
    color: var(--theme-caption-color);
  }
  .hint {
    margin-top: 1rem;
    font-size: 0.8125rem;
    line-height: 1.4;
  }
</style>
