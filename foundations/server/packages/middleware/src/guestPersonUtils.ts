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

import {
  type Account,
  type Class,
  type Doc,
  type Hierarchy,
  type MeasureContext,
  type Ref,
  type SessionData,
  isGuestRole
} from '@hcengineering/core'
import contact from '@hcengineering/contact'
import { isSystem } from './utils'

type IsDerived = Pick<Hierarchy, 'isDerived'>

/**
 * Hierarchy check that treats unknown classes (e.g. removed from model) as unrelated.
 */
export function isDerivedSafe (hierarchy: IsDerived, _class: Ref<Class<Doc>> | undefined, base: Ref<Class<Doc>>): boolean {
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
 * Returns the session account if person visibility must be restricted for it (any guest role), otherwise undefined.
 */
export function getRestrictedAccount (ctx: MeasureContext<SessionData>): Account | undefined {
  const account = ctx.contextData?.account
  if (account === undefined) return undefined
  if (!isGuestRole(account.role) || isSystem(account, ctx)) return undefined
  return account
}

/**
 * Value addresses concrete documents: a single id or a plain `$in` list.
 * Such lookups are allowed for guests, so references in visible documents keep resolving.
 */
export function isPointValue (value: unknown): boolean {
  if (typeof value === 'string') return true
  if (value === null || typeof value !== 'object') return false
  const keys = Object.keys(value)
  return keys.length === 1 && Array.isArray((value as { $in?: unknown }).$in)
}

/**
 * Restricts a query field to `allowed`, keeping other operators already set on the field (`$nin`, `$ne`, `$exists`, ...).
 */
export function restrictField (existing: unknown, allowed: Iterable<string>): Record<string, unknown> {
  const list = Array.from(allowed)
  if (existing === undefined || existing === null || typeof existing !== 'object') {
    return { $in: list }
  }
  return { ...(existing as Record<string, unknown>), $in: list }
}
