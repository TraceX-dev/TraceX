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

import type { Class, Doc, DocumentQuery, Ref } from '@hcengineering/core'
import { getCurrentLocation } from '@hcengineering/ui'
import type { Filter, FilteredView, Viewlet, ViewOptions } from '@hcengineering/view'
import { get } from 'svelte/store'
import { selectedFilterStore } from './filter'
import { activeViewlet, makeViewletKey } from './utils'
import { getViewOptions, viewOptionStore } from './viewOptions'

/**
 * Where a filtered query came from. The filter bar attaches it to the query it emits, so a table
 * receiving that query knows its source explicitly instead of guessing it from query contents.
 * @public
 */
export interface QueryFilterSource {
  cardClass?: Ref<Class<Doc>>
  /** The query before the filter bar applied its filters. */
  baseQuery: DocumentQuery<Doc>
  /** The filters that produced the query, serialized like `FilteredView.filters`. */
  filters: string
}

/** Enumerable, so object spreads keep it; symbols are never serialized into requests. */
const filterSourceKey = Symbol('tableFilterSource')

/** @public */
export function attachQueryFilterSource<T extends DocumentQuery<Doc>> (query: T, source: QueryFilterSource): T {
  Object.defineProperty(query, filterSourceKey, { value: source, enumerable: true, configurable: true, writable: true })
  return query
}

/** @public */
export function getQueryFilterSource (query: DocumentQuery<Doc> | undefined): QueryFilterSource | undefined {
  if (query === undefined) return undefined
  const source: QueryFilterSource | undefined = Reflect.get(query, filterSourceKey)
  return source
}

/**
 * Whether the active filters, viewlet or view options differ from a saved view.
 * @public
 */
export function savedViewDiffers (
  selected: FilteredView,
  filters: Filter[] | string,
  activeViewlets: Record<string, Ref<Viewlet> | null>,
  viewOptions: Map<string, ViewOptions>
): boolean {
  const key = makeViewletKey(getCurrentLocation())
  if (selected.viewletId !== activeViewlets[key]) return true
  if (selected.filters !== (typeof filters === 'string' ? filters : JSON.stringify(filters))) return true
  if (selected.viewletId !== null) {
    const current = getViewOptions({ _id: selected.viewletId } as unknown as Viewlet, viewOptions)
    if (JSON.stringify(selected.viewOptions) !== JSON.stringify(current)) return true
  }
  return false
}

/**
 * Explicit source of a table query. A saved view is reported only while the table shows it
 * unmodified; otherwise the copy repeats the query it saw.
 * @public
 */
export function getTableFilterSource (
  query: DocumentQuery<Doc> | undefined,
  cardClass: Ref<Class<Doc>>
): { baseQuery: DocumentQuery<Doc>, filteredViewId?: Ref<FilteredView> } | undefined {
  const source = getQueryFilterSource(query)
  if (source === undefined || (source.cardClass !== undefined && source.cardClass !== cardClass)) return undefined
  const selected = get(selectedFilterStore)
  const unchanged =
    selected !== undefined &&
    (selected.filterClass === undefined || selected.filterClass === cardClass) &&
    !savedViewDiffers(selected, source.filters, get(activeViewlet), get(viewOptionStore))
  return { baseQuery: source.baseQuery, ...(unchanged ? { filteredViewId: selected._id } : {}) }
}

/**
 * Keep serialized JSON inside an HTML comment: `<` and `>` are escaped so values such as `-->`
 * cannot close the comment early. `JSON.parse` restores them unchanged.
 * @public
 */
export function escapeCommentJson (json: string): string {
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
}
