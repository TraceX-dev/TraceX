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

import type { Class, Doc, Hierarchy, Ref } from '@hcengineering/core'
import type { ObjectSearchCategory } from './types'

/**
 * Check whether the class is covered by a 'spotlight' search category, i.e. whether
 * spotlight search is able to find its documents.
 *
 * @public
 */
export function isSpotlightSearchableClass (
  hierarchy: Pick<Hierarchy, 'isDerived'>,
  categories: Pick<ObjectSearchCategory, 'context' | 'classToSearch' | 'includeChilds'>[],
  _class: Ref<Class<Doc>>
): boolean {
  return categories.some((cat) => {
    if (!cat.context.includes('spotlight') || cat.classToSearch === undefined) return false
    if (cat.classToSearch === _class) return true
    return cat.includeChilds === true && hierarchy.isDerived(_class, cat.classToSearch)
  })
}
