/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import type { Class, Doc, Hierarchy, Ref } from '@hcengineering/core'
import contact, { type Person } from '@hcengineering/contact'
import { isPersonAttachedClass, isPersonClass } from './guestPersonUtils'
import type { VisibleSet } from './guestVisibilityCache'

type IsDerived = Pick<Hierarchy, 'isDerived'>

interface BaseRule {
  /** Rule name, for logs and tests. */
  readonly name: string
  /** Whether the rule applies to the queried class. */
  readonly matches: (hierarchy: IsDerived, _class: Ref<Class<Doc>>) => boolean
}

/**
 * Restriction expressed in the query itself: `field` is limited to `allowed(visible)`.
 * Preferred, because the DB does the filtering and limits/totals stay exact.
 */
export interface QueryRule extends BaseRule {
  readonly kind: 'query'
  readonly field: string
  readonly allowed: (visible: VisibleSet) => Iterable<string>
  /** Optional opt-out for queries the rule should not touch. */
  readonly applies?: (query: Record<string, unknown>, hierarchy: IsDerived) => boolean
}

/**
 * Restriction that can't be expressed as a query (e.g. mixed classes); results are filtered after the fetch.
 */
export interface ResultRule extends BaseRule {
  readonly kind: 'result'
  readonly isVisible: (doc: Doc, visible: VisibleSet, hierarchy: IsDerived) => boolean
}

export type PersonVisibilityRule = QueryRule | ResultRule

/**
 * Person visibility rules for guests. The first matching rule wins.
 */
export const PERSON_VISIBILITY_RULES: readonly PersonVisibilityRule[] = [
  {
    name: 'person',
    kind: 'query',
    matches: isPersonClass,
    field: 'personUuid',
    allowed: (visible) => visible.accounts
  },
  {
    name: 'person-attached',
    kind: 'query',
    matches: isPersonAttachedClass,
    field: 'attachedTo',
    allowed: (visible) => visible.personRefs,
    // Channels of non-person contacts (e.g. organizations) are not restricted.
    applies: (query, hierarchy) =>
      typeof query.attachedToClass !== 'string' || isPersonClass(hierarchy, query.attachedToClass as Ref<Class<Doc>>)
  },
  {
    // Contact mixes persons and organizations; `$or` is not supported by adapters, so filter results.
    name: 'contact',
    kind: 'result',
    matches: (_hierarchy, _class) => _class === contact.class.Contact,
    isVisible: (doc, visible, hierarchy) => {
      if (!isPersonClass(hierarchy, doc._class)) return true
      const personUuid = (doc as Person).personUuid
      return personUuid !== undefined && visible.accounts.has(personUuid)
    }
  }
]

export function findPersonVisibilityRule (
  hierarchy: IsDerived,
  _class: Ref<Class<Doc>>,
  rules: readonly PersonVisibilityRule[] = PERSON_VISIBILITY_RULES
): PersonVisibilityRule | undefined {
  return rules.find((rule) => rule.matches(hierarchy, _class))
}
