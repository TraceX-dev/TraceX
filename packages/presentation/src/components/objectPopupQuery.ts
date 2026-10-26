//
// Copyright © 2026 Hardcore Engineering Inc.
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
//

import type { Doc, DocumentQuery, Ref } from '@hcengineering/core'

export type ObjectPopupSearchMode = 'field' | 'fulltext' | 'disabled' | 'spotlight'

export interface ObjectPopupQueryParams {
  searchMode: ObjectPopupSearchMode
  search: string
  searchField: string
  docQuery?: DocumentQuery<Doc>
  ignoreObjects: Ref<Doc>[]
  /**
   * Ids found by the spotlight (fulltext service) search.
   * `undefined` means the search result has not arrived yet.
   */
  spotlightIds?: Ref<Doc>[]
}

/**
 * Merge `_id` restrictions of the docQuery with ignored objects and an optional list of allowed ids.
 * Nothing from docQuery._id is dropped: `$nin` lists are united, `$in` lists are intersected.
 */
function mergeIdQuery (docIdQuery: unknown, ignoreObjects: Ref<Doc>[], allowed?: Ref<Doc>[]): Record<string, unknown> {
  const base = typeof docIdQuery === 'object' && docIdQuery !== null ? (docIdQuery as Record<string, any>) : {}
  const nin = [...ignoreObjects, ...((base.$nin as Ref<Doc>[] | undefined) ?? [])]

  let $in = base.$in as Ref<Doc>[] | undefined
  if (allowed !== undefined) {
    const allowedSet = new Set(allowed)
    $in = $in === undefined ? allowed : $in.filter((id) => allowedSet.has(id))
  }

  const result: Record<string, unknown> = { ...base, $nin: nin }
  if ($in !== undefined) result.$in = $in
  return result
}

/**
 * Build the query used by ObjectPopup to load candidates.
 */
export function buildObjectPopupQuery (params: ObjectPopupQueryParams): DocumentQuery<Doc> {
  const { searchMode, search, searchField, docQuery, ignoreObjects, spotlightIds } = params
  const docId = docQuery?._id
  const base: Record<string, any> = { ...(docQuery ?? {}) }
  const hasSearch = search !== ''

  switch (searchMode) {
    case 'disabled':
      return { ...base, _id: mergeIdQuery(docId, ignoreObjects) }
    case 'fulltext':
      return {
        ...base,
        ...(hasSearch ? { $search: search } : {}),
        _id: mergeIdQuery(docId, ignoreObjects)
      }
    case 'spotlight':
      // While a search is active only ids found by the fulltext service are allowed,
      // an empty or pending result must not fall back to the full list.
      return {
        ...base,
        _id: mergeIdQuery(docId, ignoreObjects, hasSearch ? (spotlightIds ?? []) : undefined)
      }
    default:
      return {
        ...base,
        ...(hasSearch ? { [searchField]: { $like: '%' + search + '%' } } : {}),
        _id: mergeIdQuery(docId, ignoreObjects)
      }
  }
}
