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

import type { Class, Doc, DocumentQuery, FindOptions, Hierarchy, Ref } from '@hcengineering/core'

interface ClassInclusionFilter {
  query?: DocumentQuery<Doc>
  projection: NonNullable<FindOptions<Doc>['projection']>
  matches: (doc: Doc) => boolean
}

/** Builds an inclusive class condition, with a predicate for unions of independent mixins. */
export function getClassInclusionFilter (hierarchy: Hierarchy, selected: Array<Ref<Class<Doc>>>): ClassInclusionFilter {
  const descendants = new Set<Ref<Class<Doc>>>()
  for (const clazz of selected) {
    if (!hierarchy.hasClass(clazz)) throw new Error('Unavailable class filter')
    for (const child of hierarchy.getDescendants(clazz)) descendants.add(child)
  }
  const classes = new Set([...descendants].filter((clazz) => !hierarchy.isMixin(clazz)))
  const mixins = [...descendants].filter(
    (clazz) => hierarchy.isMixin(clazz) && !classes.has(hierarchy.getBaseClass(clazz))
  )
  const projection: NonNullable<FindOptions<Doc>['projection']> = { _id: 1, _class: 1 }
  Object.assign(projection, Object.fromEntries(mixins.map((mixin) => [mixin, 1])))
  let query: DocumentQuery<Doc> | undefined
  if (mixins.length === 0) query = { _class: { $in: [...classes] } }
  else if (classes.size === 0 && mixins.length === 1) query = { [mixins[0]]: { $exists: true } }
  return {
    query,
    projection,
    matches: (doc) => classes.has(doc._class) || mixins.some((mixin) => hierarchy.hasMixin(doc, mixin))
  }
}
