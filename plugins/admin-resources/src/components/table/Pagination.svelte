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
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { DropdownLabelsIntl } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let offset: number
  export let pageSize: number
  export let rowsCount: number
  export let hasNext: boolean
  export let totalCount: number | undefined = undefined
  export let pageSizes: number[] = [10, 25, 50, 100]

  const dispatch = createEventDispatcher<{
    pageChange: number
    pageSizeChange: number
  }>()

  $: firstRow = rowsCount === 0 ? 0 : offset + 1
  $: lastRow = offset + rowsCount
  $: lastOffset = totalCount == null ? 0 : Math.max(0, Math.floor((totalCount - 1) / pageSize) * pageSize)

  function setPage (newOffset: number): void {
    dispatch('pageChange', Math.max(0, newOffset))
  }

  function setPageSize (event: CustomEvent<string>): void {
    dispatch('pageSizeChange', Number(event.detail))
  }
</script>

<div class="admin-pagination">
  <div class="admin-pagination-size">
    <span>Rows per page</span>
    <DropdownLabelsIntl
      selected={String(pageSize)}
      label={getEmbeddedLabel(String(pageSize))}
      items={pageSizes.map((size) => ({ id: String(size), label: getEmbeddedLabel(String(size)) }))}
      on:selected={setPageSize}
    />
  </div>

  <div class="admin-pagination-actions">
    <span>{firstRow}–{lastRow}{totalCount != null ? ` of ${totalCount}` : ''}</span>
    <button
      aria-label="First page"
      disabled={offset === 0}
      on:click={() => {
        setPage(0)
      }}>«</button
    >
    <button
      aria-label="Previous page"
      disabled={offset === 0}
      on:click={() => {
        setPage(offset - pageSize)
      }}>‹</button
    >
    <button
      aria-label="Next page"
      disabled={!hasNext}
      on:click={() => {
        setPage(offset + pageSize)
      }}>›</button
    >
    <button
      aria-label="Last page"
      disabled={totalCount == null || offset >= lastOffset}
      on:click={() => {
        setPage(lastOffset)
      }}>»</button
    >
  </div>
</div>

<style lang="scss">
  .admin-pagination,
  .admin-pagination-size,
  .admin-pagination-actions {
    display: flex;
    align-items: center;
    font: inherit;
  }

  .admin-pagination {
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem;
  }

  .admin-pagination-size,
  .admin-pagination-actions {
    gap: 0.25rem;
  }

  .admin-pagination button {
    height: 2.25rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    color: inherit;
    background: var(--theme-panel-color);
    font: inherit;
  }

  .admin-pagination button {
    width: 2.25rem;
    padding: 0;
    cursor: pointer;
  }

  .admin-pagination button:hover:not(:disabled) {
    background: var(--theme-button-hovered);
  }

  .admin-pagination button:disabled {
    color: var(--theme-dark-color);
    cursor: default;
  }
</style>
