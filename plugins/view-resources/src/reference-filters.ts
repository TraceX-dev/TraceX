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
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import {
  mergeQueries,
  type Class,
  type Doc,
  type Ref,
  type RefTo,
  type DocumentQuery,
  type Hierarchy
} from '@hcengineering/core'
import card from '@hcengineering/card'
import contact from '@hcengineering/contact'
import { createQuery, getClient } from '@hcengineering/presentation'
import type { Filter } from '@hcengineering/view'
import { onDestroy } from 'svelte'
import { writable, type Readable } from 'svelte/store'
import { filtersToQuery } from './filter'
import view from './plugin'
import { getClassInclusionFilter } from './class-filter'

/** Candidate filters are supported by Person and Card attribute editors, including their descendants. */
export function supportsReferenceFilters (hierarchy: Hierarchy, target: Ref<Class<Doc>>): boolean {
  if (!hierarchy.hasClass(target)) return false
  const base = hierarchy.getBaseClass(target)
  return hierarchy.isDerived(base, contact.class.Person) || hierarchy.isDerived(base, card.class.Card)
}

/** Restores stored conditions against the current model; stale definitions remain errors. */
export function parseReferenceFilters (target: Ref<Class<Doc>>, source: string): Filter[] {
  if (!supportsReferenceFilters(getClient().getHierarchy(), target))
    {throw new Error('Unsupported reference filter target')}
  const value: unknown = JSON.parse(source)
  if (!Array.isArray(value)) throw new Error('Expected a filter array')
  const hierarchy = getClient().getHierarchy()
  const keys = new Set<string>()
  return value.map((entry: unknown, index): Filter => {
    if (entry === null || typeof entry !== 'object') throw new Error('Invalid filter')
    const data = entry as Partial<Filter>
    if (
      data.key == null ||
      typeof data.key._class !== 'string' ||
      typeof data.key.key !== 'string' ||
      typeof data.mode !== 'string' ||
      !Array.isArray(data.value) ||
      data.nested !== undefined
    ) {
      throw new Error('Invalid or dynamic reference filter')
    }
    const identity = data.key._class + '.' + data.key.key
    if (keys.has(identity)) throw new Error('Use one condition per field')
    keys.add(identity)
    if (typeof data.key.component !== 'string' || !Array.isArray(data.modes)) throw new Error('Invalid filter metadata')
    if ([view.filter.FilterNestedMatch, view.filter.FilterNestedDontMatch].includes(data.mode)) {
      throw new Error('Nested reference conditions are unsupported')
    }
    if (
      [
        view.filter.FilterValueIn,
        view.filter.FilterValueNin,
        view.filter.FilterArrayAll,
        view.filter.FilterArrayAny
      ].includes(data.mode)
    ) {
      if (data.value.some((pair: unknown) => !Array.isArray(pair) || pair.length !== 2 || !Array.isArray(pair[1]))) {
        throw new Error('Invalid selected filter values')
      }
    }
    if (data.mode === view.filter.FilterContains && (data.value.length !== 1 || typeof data.value[0] !== 'string')) {
      throw new Error('Invalid text condition')
    }
    const owner = hierarchy.getBaseClass(data.key._class)
    if (!hierarchy.isDerived(target, owner) && !hierarchy.isDerived(owner, target)) {
      throw new Error('The filter belongs to another reference type')
    }
    const attribute = hierarchy.getAttribute(data.key._class, data.key.key)
    if (data.key.key === '_class') {
      if (
        ![view.filter.FilterObjectIn, view.filter.FilterObjectNin].includes(data.mode) ||
        data.value.some((id: unknown) => typeof id !== 'string' || !hierarchy.hasClass(id as Ref<Class<Doc>>))
      ) {
        throw new Error('Invalid class condition')
      }
    }
    const filter: Filter = {
      key: { ...data.key, attribute, label: attribute.label },
      mode: data.mode,
      modes: data.key.key === '_class' ? [view.filter.FilterObjectIn, view.filter.FilterObjectNin] : data.modes,
      value: data.value,
      index
    }
    return filter
  })
}

/** Compiles static reference conditions using the normal view-filter modes. */
export async function referenceFilterQuery (target: Ref<Class<Doc>>, source: string): Promise<DocumentQuery<Doc>> {
  const filters = parseReferenceFilters(target, source)
  for (const filter of filters) {
    const mode = await getClient().findOne(view.class.FilterMode, { _id: filter.mode })
    if (mode === undefined || (filter.value.length === 0 && mode.disableValueSelector !== true)) {
      throw new Error('Incomplete or unavailable reference condition')
    }
  }
  return await filtersToQuery(filters, {}, true)
}

/** Removes runtime callbacks and attribute snapshots from persisted filter definitions. */
export function serializeReferenceFilters (filters: Filter[]): string | undefined {
  if (filters.length === 0) return undefined
  return JSON.stringify(filters, (key, value: unknown) =>
    key === 'onRemove' || key === 'attribute' ? undefined : value
  )
}

/** Compiles Person/Card candidate queries, intersecting conflicting field conditions through live IDs. */
export function createReferenceQuery<T extends Doc> (): Readable<DocumentQuery<T>> & {
  update: (type: RefTo<T> | undefined, base?: DocumentQuery<T>) => void
} {
  const store = writable<DocumentQuery<T>>({ _id: { $in: [] } })
  const query = createQuery()
  let revision = 0
  onDestroy(() => {
    revision++
  })
  return {
    subscribe: store.subscribe,
    update: (type, base = {}) => {
      const current = ++revision
      query.unsubscribe()
      if (type?.filters === undefined || !supportsReferenceFilters(getClient().getHierarchy(), type.to)) {
        store.set(base)
        return
      }
      store.set(mergeQueries(base, { _id: { $in: [] } }))
      void (async () => {
        const conditions = parseReferenceFilters(type.to, type.filters ?? '[]')
        const positive = conditions.find(
          (condition) => condition.key.key === '_class' && condition.mode === view.filter.FilterObjectIn
        )
        const inclusion =
          positive === undefined ? undefined : getClassInclusionFilter(getClient().getHierarchy(), positive.value)
        const needsClassUnion = inclusion !== undefined && inclusion.query === undefined
        const source = needsClassUnion
          ? (serializeReferenceFilters(conditions.filter((condition) => condition !== positive)) ?? '[]')
          : (type.filters ?? '[]')
        const filter = await referenceFilterQuery(type.to, source)
        if (current !== revision) return
        // The Person picker searches by name; keep its configured name condition independent.
        const needsIds =
          needsClassUnion ||
          filter.name !== undefined ||
          Object.keys(filter).some((key) => key !== '_id' && key !== '_class' && base[key] !== undefined)
        if (!needsIds) {
          store.set(mergeQueries(base, filter as DocumentQuery<T>))
          return
        }
        query.query(
          type.to,
          filter,
          (matches) => {
            if (current !== revision) return
            const candidates = needsClassUnion ? matches.filter((doc) => inclusion?.matches(doc)) : matches
            const identities: DocumentQuery<Doc> = { _id: { $in: candidates.map((doc) => doc._id) } }
            store.set(mergeQueries(base, identities as DocumentQuery<T>))
          },
          { projection: needsClassUnion ? inclusion?.projection : { _id: 1 } }
        )
      })().catch(() => {
        if (current === revision) store.set(mergeQueries(base, { _id: { $in: [] } }))
      })
    }
  }
}
