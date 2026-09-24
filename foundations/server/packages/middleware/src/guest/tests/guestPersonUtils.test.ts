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

import core, {
  AccountRole,
  MeasureMetricsContext,
  systemAccountUuid,
  type AccountUuid,
  type MeasureContext,
  type PersonId,
  type SessionData
} from '@hcengineering/core'
import contact from '@hcengineering/contact'
import {
  getRestrictedAccount,
  isDerivedSafe,
  isPersonAttachedClass,
  isPersonClass,
  restrictField
} from '../guestPersonUtils'

const EMPLOYEE = contact.mixin.Employee as unknown as string

const PARENTS: Record<string, string | undefined> = {
  [core.class.Doc]: undefined,
  [core.class.Space]: core.class.Doc,
  [core.class.SystemSpace]: core.class.Space,
  [contact.class.Contact]: core.class.Doc,
  [contact.class.Person]: contact.class.Contact,
  [EMPLOYEE]: contact.class.Person,
  [contact.class.Channel]: core.class.Doc,
  [contact.class.SocialIdentity]: core.class.Doc
}

const hierarchy = {
  isDerived: (_class: string, base: string): boolean => {
    let current: string | undefined = _class
    while (current !== undefined) {
      if (current === base) return true
      if (!(current in PARENTS)) throw new Error(`Unknown class ${current}`)
      current = PARENTS[current]
    }
    return false
  }
}

function makeCtx (uuid: string, role: AccountRole): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account: { uuid: uuid as AccountUuid, role, primarySocialId: 'test' as PersonId, socialIds: [], fullSocialIds: [] }
  } as any
  return ctx
}

describe('guestPersonUtils', () => {
  it('isDerivedSafe treats unknown classes as unrelated', () => {
    expect(isDerivedSafe(hierarchy, 'unknown:class' as any, core.class.Space)).toBe(false)
    expect(isDerivedSafe(hierarchy, undefined, core.class.Space)).toBe(false)
    expect(isDerivedSafe(hierarchy, core.class.SystemSpace, core.class.Space)).toBe(true)
  })

  it('detects person and person-attached classes', () => {
    expect(isPersonClass(hierarchy, contact.class.Person)).toBe(true)
    expect(isPersonClass(hierarchy, EMPLOYEE as any)).toBe(true)
    expect(isPersonClass(hierarchy, contact.class.Contact)).toBe(false)
    expect(isPersonAttachedClass(hierarchy, contact.class.SocialIdentity)).toBe(true)
    expect(isPersonAttachedClass(hierarchy, contact.class.Channel)).toBe(true)
    expect(isPersonAttachedClass(hierarchy, contact.class.Person)).toBe(false)
  })

  it('restricts only guest roles', () => {
    for (const role of [AccountRole.Guest, AccountRole.ReadOnlyGuest, AccountRole.DocGuest]) {
      expect(getRestrictedAccount(makeCtx('guest', role))?.uuid).toBe('guest')
    }
    expect(getRestrictedAccount(makeCtx('user', AccountRole.User))).toBeUndefined()
    expect(getRestrictedAccount(makeCtx('owner', AccountRole.Owner))).toBeUndefined()
    expect(getRestrictedAccount(makeCtx(systemAccountUuid, AccountRole.Guest))).toBeUndefined()
    expect(getRestrictedAccount(new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>)).toBeUndefined()
  })

  it('restrictField adds $in and keeps other operators', () => {
    expect(restrictField(undefined, new Set(['a']))).toEqual({ $in: ['a'] })
    expect(restrictField({ $nin: ['b'] }, ['a'])).toEqual({ $nin: ['b'], $in: ['a'] })
    expect(restrictField({ $ne: 'b', $exists: true }, ['a'])).toEqual({ $ne: 'b', $exists: true, $in: ['a'] })
  })

  it('restrictField intersects point values with allowed values', () => {
    expect(restrictField('a', ['a', 'b'])).toEqual({ $in: ['a'] })
    expect(restrictField('c', ['a', 'b'])).toEqual({ $in: [] })
    expect(restrictField({ $in: ['b', 'c'] }, ['a', 'b'])).toEqual({ $in: ['b'] })
  })
})
