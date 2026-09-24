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

import core, { type Doc } from '@hcengineering/core'
import contact from '@hcengineering/contact'
import { findPersonVisibilityRule, PERSON_VISIBILITY_RULES, type QueryRule, type ResultRule } from '../guestPersonRules'
import type { VisibleSet } from '../guestVisibilityCache'

const EMPLOYEE = contact.mixin.Employee as unknown as string
const ORGANIZATION = 'contact:class:Organization'

const PARENTS: Record<string, string | undefined> = {
  [core.class.Doc]: undefined,
  [core.class.Space]: core.class.Doc,
  [contact.class.Contact]: core.class.Doc,
  [contact.class.Person]: contact.class.Contact,
  [EMPLOYEE]: contact.class.Person,
  [ORGANIZATION]: contact.class.Contact,
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

const visible: VisibleSet = {
  accounts: new Set(['guest', 'member']),
  personRefs: new Set(['person:guest', 'person:member'] as any[])
}

const ruleFor = (_class: string): string | undefined => findPersonVisibilityRule(hierarchy, _class as any)?.name

describe('guestPersonRules', () => {
  it('selects a rule by class', () => {
    expect(ruleFor(contact.class.Person)).toBe('person')
    expect(ruleFor(EMPLOYEE)).toBe('person')
    expect(ruleFor(contact.class.SocialIdentity)).toBe('person-attached')
    expect(ruleFor(contact.class.Channel)).toBe('person-attached')
    expect(ruleFor(contact.class.Contact)).toBe('contact')
    expect(ruleFor(ORGANIZATION)).toBeUndefined()
    expect(ruleFor(core.class.Space)).toBeUndefined()
    expect(ruleFor('unknown:class')).toBeUndefined()
  })

  it('has unique rule names', () => {
    const names = PERSON_VISIBILITY_RULES.map((it) => it.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('person rule restricts personUuid to visible accounts', () => {
    const rule = findPersonVisibilityRule(hierarchy, contact.class.Person) as QueryRule
    expect(rule.field).toBe('personUuid')
    expect(new Set(rule.allowed(visible))).toEqual(visible.accounts)
  })

  it('person-attached rule restricts attachedTo and skips non-person owners', () => {
    const rule = findPersonVisibilityRule(hierarchy, contact.class.Channel) as QueryRule
    expect(rule.field).toBe('attachedTo')
    expect(new Set(rule.allowed(visible))).toEqual(visible.personRefs)
    expect(rule.applies?.({}, hierarchy)).toBe(true)
    expect(rule.applies?.({ attachedToClass: contact.class.Person }, hierarchy)).toBe(true)
    expect(rule.applies?.({ attachedToClass: ORGANIZATION }, hierarchy)).toBe(false)
  })

  it('contact rule keeps organizations and visible persons', () => {
    const rule = findPersonVisibilityRule(hierarchy, contact.class.Contact) as ResultRule
    const doc = (_class: string, personUuid?: string): Doc => ({ _id: 'x', _class, personUuid }) as any
    expect(rule.isVisible(doc(ORGANIZATION), visible, hierarchy)).toBe(true)
    expect(rule.isVisible(doc(contact.class.Person, 'member'), visible, hierarchy)).toBe(true)
    expect(rule.isVisible(doc(EMPLOYEE, 'stranger'), visible, hierarchy)).toBe(false)
    expect(rule.isVisible(doc(contact.class.Person), visible, hierarchy)).toBe(false)
  })
})
