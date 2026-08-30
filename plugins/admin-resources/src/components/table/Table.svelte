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
  import { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  import Pagination from './Pagination.svelte'
  import SortIcon from './SortIcon.svelte'

  interface TableColumn<Row> {
    id: string
    label: IntlString
    getValue: (row: Row) => string | number | boolean | null | undefined
    sortable?: boolean
  }

  interface TableSort {
    columnId: string
    direction: 'asc' | 'desc'
  }

  interface TableQuery {
    offset: number
    limit: number
    search: string
    sorting: TableSort | undefined
  }

  interface TablePage<Row> {
    items: Row[]
    total?: number
    hasNext: boolean
  }

  type TableLoader<Row> = (query: TableQuery) => Promise<TablePage<Row>>

  export let columns: Array<TableColumn<unknown>>
  export let data: unknown[] = []
  export let loader: TableLoader<unknown> | undefined = undefined
  export let pageSize: number = 10
  export let pageSizes: number[] = [10, 25, 50]
  export let showPagination: boolean = true
  export let search = ''

  let offset = 0
  let previousSearch = search
  let sorting: TableSort | undefined = undefined
  let loadedPage: TablePage<unknown> = { items: [], hasNext: false }
  let loading = false
  let loadError: Error | undefined = undefined
  let lastLoaderKey: string | undefined = undefined

  $: query = { offset, limit: pageSize, search, sorting } satisfies TableQuery
  $: if (search !== previousSearch) {
    previousSearch = search
    offset = 0
  }
  $: loaderKey = JSON.stringify(query)
  $: if (loader !== undefined && loaderKey !== lastLoaderKey) {
    lastLoaderKey = loaderKey
    void loadPage(loader, query)
  }

  $: filteredData = filterAndSort(data, columns, search, sorting)
  $: visibleRows = loader === undefined ? filteredData.slice(offset, offset + pageSize) : loadedPage.items
  $: totalCount = loader === undefined ? filteredData.length : loadedPage.total
  $: hasNext = loader === undefined ? offset + pageSize < filteredData.length : loadedPage.hasNext

  async function loadPage (currentLoader: TableLoader<unknown>, currentQuery: TableQuery): Promise<void> {
    loading = true
    loadError = undefined
    try {
      const page = await currentLoader(currentQuery)
      if (JSON.stringify(currentQuery) === loaderKey) {
        loadedPage = page
      }
    } catch (error) {
      if (JSON.stringify(currentQuery) === loaderKey) {
        loadError = error instanceof Error ? error : new Error('Unable to load table data')
        loadedPage = { items: [], hasNext: false }
      }
    } finally {
      if (JSON.stringify(currentQuery) === loaderKey) {
        loading = false
      }
    }
  }

  function updateSorting (column: TableColumn<unknown>): void {
    if (column.sortable !== true) {
      return
    }

    sorting =
      sorting?.columnId === column.id && sorting.direction === 'asc'
        ? { columnId: column.id, direction: 'desc' }
        : { columnId: column.id, direction: 'asc' }
    offset = 0
  }

  export function refresh (): void {
    lastLoaderKey = undefined
  }

  function filterAndSort (
    rows: unknown[],
    tableColumns: Array<TableColumn<unknown>>,
    currentSearch: string,
    currentSorting: TableSort | undefined
  ): unknown[] {
    const normalizedSearch = currentSearch.trim().toLocaleLowerCase()
    const filtered = rows.filter(
      (row) =>
        normalizedSearch.length === 0 ||
        tableColumns.some((column) =>
          String(column.getValue(row) ?? '')
            .toLocaleLowerCase()
            .includes(normalizedSearch)
        )
    )
    if (currentSorting === undefined) return filtered

    const column = tableColumns.find((it) => it.id === currentSorting?.columnId)
    if (column === undefined) return filtered

    return [...filtered].sort((first, second) => {
      const firstValue = String(column.getValue(first) ?? '')
      const secondValue = String(column.getValue(second) ?? '')
      const direction = currentSorting?.direction === 'desc' ? -1 : 1
      return firstValue.localeCompare(secondValue, undefined, { numeric: true }) * direction
    })
  }
</script>

<div class="data-table">
  <table class="antiTable">
    <thead class="scroller-thead">
      <tr class="scroller-thead__tr">
        {#each columns as column}
          <th
            class:sortable={column.sortable}
            class:sorted={sorting?.columnId === column.id}
            on:click={() => {
              updateSorting(column)
            }}
          >
            <div class="antiTable-cells">
              <Label label={column.label} />
              {#if sorting?.columnId === column.id}
                <div class="icon">
                  <SortIcon descending={sorting.direction === 'desc'} />
                </div>
              {/if}
            </div>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each visibleRows as row}
        <tr class="antiTable-body__row">
          {#each columns as column}
            {@const value = column.getValue(row)}
            <td><slot {row} {column} {value}>{value ?? ''}</slot></td>
          {/each}
        </tr>
      {/each}
      {#if !loading && visibleRows.length === 0}
        <tr class="antiTable-body__row">
          <td colspan={columns.length} class="data-table__empty">{loadError?.message ?? 'No rows'}</td>
        </tr>
      {/if}
    </tbody>
  </table>

  {#if showPagination}
    <Pagination
      {offset}
      {pageSize}
      rowsCount={visibleRows.length}
      {hasNext}
      {totalCount}
      {pageSizes}
      on:pageChange={(event) => {
        offset = event.detail
      }}
      on:pageSizeChange={(event) => {
        pageSize = event.detail
        offset = 0
      }}
    />
  {/if}
</div>

<style lang="scss">
  .antiTable {
    width: 100%;
    min-width: 68rem;
    border-collapse: collapse;

    th,
    td {
      vertical-align: middle;
    }

    th:first-child,
    td:first-child {
      padding-left: 1rem;
    }

    th:last-child,
    td:last-child {
      padding-right: 1rem;
    }
  }

  .data-table__empty {
    padding: 1rem;
    text-align: center;
  }
</style>
