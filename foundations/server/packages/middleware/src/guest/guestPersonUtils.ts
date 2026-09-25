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
import contact from '@hcengineering/contact'

type IsDerived = Pick<Hierarchy, 'isDerived'>

/**
 * Hierarchy check that treats unknown classes (e.g. removed from model) as unrelated.
 */
export function isDerivedSafe (
  hierarchy: IsDerived,
  _class: Ref<Class<Doc>> | undefined,
  base: Ref<Class<Doc>>
): boolean {
  if (_class === undefined) return false
  try {
    return hierarchy.isDerived(_class, base)
  } catch {
    return false
  }
}

/**
 * Person or any of its mixins/subclasses (e.g. Employee).
 */
export function isPersonClass (hierarchy: IsDerived, _class: Ref<Class<Doc>> | undefined): boolean {
  return isDerivedSafe(hierarchy, _class, contact.class.Person)
}

/**
 * Docs attached to a contact that expose personal data (emails, phones, social ids).
 */
export function isPersonAttachedClass (hierarchy: IsDerived, _class: Ref<Class<Doc>> | undefined): boolean {
  return (
    isDerivedSafe(hierarchy, _class, contact.class.SocialIdentity) ||
    isDerivedSafe(hierarchy, _class, contact.class.Channel)
  )
}

/**
 * Restricts a query field to `allowed`, intersecting scalar and `$in` point values while keeping other operators.
 */
export function restrictField (existing: unknown, allowed: Iterable<string>): Record<string, unknown> {
  const allowedSet = new Set(allowed)
  const list = Array.from(allowedSet)
  if (existing === undefined || existing === null) {
    return { $in: list }
  }
  if (typeof existing !== 'object') {
    return { $in: list.filter((value) => value === existing) }
  }
  const operators = existing as Record<string, unknown>
  const requested = operators.$in
  return {
    ...operators,
    $in: Array.isArray(requested)
      ? requested.filter((value): value is string => typeof value === 'string' && allowedSet.has(value))
      : list
  }
}
