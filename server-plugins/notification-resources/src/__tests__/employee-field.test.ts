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

import contact, { type Person } from '@hcengineering/contact'
import core, {
  type AnyAttribute,
  type Class,
  type Data,
  type Doc,
  type DocumentUpdate,
  type Mixin,
  type Ref,
  type Space,
  type TxCUD,
  TxFactory,
  TxProcessor
} from '@hcengineering/core'
import notification, { type NotificationType } from '@hcengineering/notification'
import type { TriggerControl } from '@hcengineering/server-core'

import { isUserAddedToEmployeeFieldTypeMatch } from '../employee-field'

interface TestCard extends Doc {
  owner?: Ref<Person> | null
  reviewers?: Ref<Person>[]
  person?: Ref<Person>
  title?: string
}

interface ReviewCard extends TestCard {
  reviewer?: Ref<Person>
}

const CARD = 'test:class:Card' as Ref<Class<TestCard>>
const TAG = 'test:mixin:Review' as Ref<Mixin<ReviewCard>>
const SPACE = 'test:space:Cards' as Ref<Space>
const PERSON = 'test:person:Alice' as Ref<Person>
const OTHER = 'test:person:Bob' as Ref<Person>
const factory = new TxFactory(core.account.System)
const doc: TestCard = TxProcessor.createDoc2Doc(
  factory.createTxCreateDoc(CARD, SPACE, {}, 'test:card' as Ref<TestCard>)
)

function attribute (array = false, employee = true): AnyAttribute {
  const type = { _class: core.class.RefTo, to: employee ? contact.mixin.Employee : contact.class.Person }
  return { type: array ? { _class: core.class.ArrOf, of: type } : type } as unknown as AnyAttribute
}

const control = {
  hierarchy: {
    getAllAttributes: () =>
      new Map([
        ['owner', attribute()],
        ['reviewer', attribute()],
        ['reviewers', attribute(true)],
        ['person', attribute(false, false)],
        ['title', { type: { _class: core.class.TypeString } } as unknown as AnyAttribute]
      ]),
    isDerived: (clazz: Ref<Class<Doc>>, parent: Ref<Class<Doc>>) => clazz === parent
  }
} as unknown as TriggerControl

function matches (tx: TxCUD<Doc>, field?: string, person = PERSON): boolean {
  const type: NotificationType = TxProcessor.createDoc2Doc(
    factory.createTxCreateDoc(notification.class.NotificationType, core.space.Model, {
      label: contact.string.Employee,
      generated: false,
      hidden: false,
      group: 'test:notification-group' as NotificationType['group'],
      defaultEnabled: true,
      txClasses: [core.class.TxCreateDoc, core.class.TxUpdateDoc, core.class.TxMixin],
      objectClass: CARD,
      field
    })
  )
  return isUserAddedToEmployeeFieldTypeMatch(tx, doc, person, [], type, control)
}

function update (operations: DocumentUpdate<TestCard>): TxCUD<TestCard> {
  return factory.createTxUpdateDoc(CARD, SPACE, doc._id, operations)
}

describe('employee field notifications', () => {
  it.each<[Data<TestCard>, boolean]>([
    [{ owner: PERSON }, true],
    [{ reviewers: [OTHER, PERSON] }, true],
    [{ owner: OTHER }, false],
    [{ person: PERSON, title: PERSON }, false]
  ])('matches employee fields on creation: %j', (values, expected) => {
    const tx = factory.createTxCreateDoc(CARD, SPACE, values, doc._id)
    expect(matches(tx)).toBe(expected)
  })

  it.each<[DocumentUpdate<TestCard>, boolean]>([
    [{ owner: PERSON }, true],
    [{ owner: OTHER }, false],
    [{ owner: null }, false],
    [{ reviewers: [OTHER, PERSON] }, true],
    [{ $push: { reviewers: PERSON } }, true],
    [{ $push: { reviewers: { $each: [OTHER, PERSON], $position: 0 } } }, true],
    [{ $pull: { reviewers: PERSON } }, false],
    [{ person: PERSON }, false],
    [{ title: 'New title' }, false]
  ])('checks only assigned or pushed employee values: %j', (operations, expected) => {
    expect(matches(update(operations))).toBe(expected)
  })

  it('limits matching to the field of the current activity message', () => {
    const tx = update({ owner: PERSON, title: 'New title' })
    expect(matches(tx, 'owner')).toBe(true)
    expect(matches(tx, 'title')).toBe(false)
  })

  it('uses ordinary assignee semantics for full array assignments', () => {
    const tx = update({ reviewers: [OTHER, PERSON] })
    expect(matches(tx, 'reviewers', PERSON)).toBe(true)
    expect(matches(tx, 'reviewers', OTHER)).toBe(true)
  })

  it('checks employee fields in mixin transactions', () => {
    const tx = factory.createTxMixin(doc._id, CARD, SPACE, TAG, { reviewer: PERSON })
    expect(matches(tx, 'reviewer')).toBe(true)
  })

  it('does not match an update to a different document', () => {
    const tx = factory.createTxUpdateDoc(CARD, SPACE, 'test:other-card' as Ref<TestCard>, { owner: PERSON })
    expect(matches(tx)).toBe(false)
  })
})
