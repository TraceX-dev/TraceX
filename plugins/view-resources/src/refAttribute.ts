//
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
//

import core, {
  type AnyAttribute,
  type Class,
  type Doc,
  type DocumentQuery,
  type Hierarchy,
  type Ref,
  type RefTo,
  type Space
} from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import { type Filter, type RefAttributeOptions } from '@hcengineering/view'

import { filtersToQuery } from './filter'

/**
 * Parses the serialized filters of a reference attribute. Invalid data gives no filters.
 *
 * @public
 */
export function parseRefAttributeFilters (value: string | undefined): Filter[] {
  if (value == null || value === '') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as Filter[]) : []
  } catch (e) {
    console.error('Failed to parse reference attribute filter', e)
    return []
  }
}

/**
 * Serializes filters of a reference attribute. No filters are stored as an empty string, so
 * removing the last filter overrides a filter set in the model.
 *
 * @public
 */
export function serializeRefAttributeFilters (filters: Filter[]): string {
  if (filters.length === 0) return ''
  return JSON.stringify(filters, (k, v) => (k === 'onRemove' ? undefined : v))
}

/**
 * Returns the class referenced by a reference attribute, undefined for other attribute types.
 *
 * @public
 */
export function getRefAttributeClass (hierarchy: Hierarchy, attribute: AnyAttribute): Ref<Class<Doc>> | undefined {
  if (!hierarchy.isDerived(attribute.type._class, core.class.RefTo)) return undefined
  return (attribute.type as RefTo<Doc>).to
}

/**
 * Keeps only filters that apply to the referenced class. Filters left from a previous class of the
 * attribute would otherwise match nothing.
 *
 * @public
 */
export function getApplicableRefFilters (hierarchy: Hierarchy, _class: Ref<Class<Doc>>, filters: Filter[]): Filter[] {
  return filters.filter((filter) => {
    const filterClass = filter.key?._class
    if (filterClass === undefined) return false
    try {
      return hierarchy.isDerived(_class, filterClass)
    } catch {
      return false
    }
  })
}

/**
 * Builds the query of documents that can be selected as the value of a reference attribute: the
 * attribute filters, the space restriction and, for versionable classes, the latest version only.
 *
 * @public
 */
export async function buildRefAttributeQuery (
  attribute: AnyAttribute,
  context: { space?: Ref<Space> } = {}
): Promise<DocumentQuery<Doc>> {
  const hierarchy = getClient().getHierarchy()
  const _class = getRefAttributeClass(hierarchy, attribute)
  if (_class === undefined) return {}

  const options = attribute as AnyAttribute & RefAttributeOptions
  let query: DocumentQuery<Doc> = {}

  if (hierarchy.classHierarchyMixin(_class, core.mixin.VersionableClass) !== undefined) {
    query = { isLatest: true }
  }
  if (options.refSameSpace === true && context.space !== undefined) {
    query = { ...query, space: context.space }
  }

  const filters = getApplicableRefFilters(hierarchy, _class, parseRefAttributeFilters(options.refFilter))
  if (filters.length > 0) {
    query = await filtersToQuery(filters, query)
  }
  return query
}
