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

import type { ArrOf, Class, Doc, PropertyType, Ref, RefTo, Type } from './classes'
import type { Hierarchy } from './hierarchy'
import type { DocumentQuery } from './storage'
import { mergeQueries } from './utils'
import core from './component'

/** Intersects reference candidate exclusions with existing selection constraints. */
export function getReferenceQuery<T extends Doc> (
  hierarchy: Hierarchy,
  type: RefTo<T> | undefined,
  query: DocumentQuery<T> = {}
): DocumentQuery<T> {
  const excluded = new Set<Ref<Class<Doc>>>()
  for (const clazz of type?.excludedClasses ?? []) {
    // A removed or unavailable exclusion must not silently broaden the selection.
    if (!hierarchy.hasClass(clazz)) return mergeQueries(query, { _id: { $in: [] } })
    for (const descendant of hierarchy.getDescendants(clazz)) excluded.add(descendant)
  }

  const constraints: DocumentQuery<T> = {}
  const classes: Ref<Class<Doc>>[] = []
  for (const clazz of excluded) {
    if (hierarchy.isMixin(clazz)) {
      const current = query[clazz]
      // An existing requirement for the mixin and its exclusion cannot both hold.
      if (current !== undefined && (typeof current !== 'object' || current === null || current.$exists !== false)) {
        return mergeQueries(query, { _id: { $in: [] } })
      }
      Object.assign(constraints, { [clazz]: { $exists: false } })
    } else {
      classes.push(clazz)
    }
  }
  if (classes.length > 0) constraints._class = { $nin: classes }
  return mergeQueries(query, constraints)
}

/** Updates candidate exclusions without changing an existing field's stored value type. */
export function updateReferenceExclusions (type: Type<PropertyType>, source: Type<PropertyType>): Type<PropertyType> {
  if (type._class !== source._class) return type
  if (type._class === core.class.ArrOf) {
    const array = type as ArrOf<PropertyType>
    const of = updateReferenceExclusions(array.of, (source as ArrOf<PropertyType>).of)
    if (of === array.of) return type
    const updated: ArrOf<PropertyType> = { ...array, of }
    return updated
  }
  if (type._class !== core.class.RefTo) return type
  const reference = type as RefTo<Doc>
  const updatedReference = source as RefTo<Doc>
  if (reference.to !== updatedReference.to) return type
  const exclusions = updatedReference.excludedClasses ?? []
  const previous = reference.excludedClasses ?? []
  if (exclusions.length === previous.length && exclusions.every((clazz, index) => clazz === previous[index]))
    {return type}
  const updated: RefTo<Doc> = { ...reference }
  if ((updatedReference.excludedClasses?.length ?? 0) > 0) {
    updated.excludedClasses = [...(updatedReference.excludedClasses ?? [])]
  } else {
    delete updated.excludedClasses
  }
  return updated
}
