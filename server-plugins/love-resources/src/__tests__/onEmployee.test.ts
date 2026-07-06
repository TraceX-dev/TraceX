//
// Copyright © 2026 TraceX.
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

import { aiBotEmailSocialKey } from '@hcengineering/ai-bot'
import contact, { type Employee, type Person } from '@hcengineering/contact'
import core, {
  generateId,
  TxFactory,
  type Class,
  type Doc,
  type DocumentQuery,
  type Ref,
  type Tx,
  type TxMixin,
  type TxUpdateDoc
} from '@hcengineering/core'
import love, { type Office } from '@hcengineering/love'
import { type TriggerControl } from '@hcengineering/server-core'

import { OnEmployee } from '../index'

interface MockData {
  employees: Array<{ _id: Ref<Employee>, role: string }>
  offices: Array<{ _id: Ref<Office>, person: Ref<Employee> | null }>
  botIdentities: Array<{ attachedTo: Ref<Person>, key: string }>
}

function createControl (data: MockData): TriggerControl {
  const findAll = jest.fn(
    async (_ctx: any, _class: Ref<Class<Doc>>, query: DocumentQuery<Doc>, _options?: any): Promise<any[]> => {
      if (_class === contact.mixin.Employee) {
        return data.employees.filter((it) => it._id === (query as any)._id)
      }
      if (_class === love.class.Office) {
        const person = (query as any).person
        return data.offices
          .filter((it) => (person === null ? it.person === null : it.person === person))
          .map((it) => ({ ...it, _class: love.class.Office, space: core.space.Workspace }))
      }
      if (_class === contact.class.SocialIdentity) {
        return data.botIdentities.filter((it) => it.key === (query as any).key)
      }
      return []
    }
  )
  return {
    ctx: {} as any,
    findAll,
    txFactory: new TxFactory(core.account.System),
    cache: new Map<string, any>()
  } as unknown as TriggerControl
}

function employeeTx (person: Ref<Employee>, active: boolean): Tx {
  const tx: Partial<TxMixin<Person, Employee>> = {
    _id: generateId(),
    _class: core.class.TxMixin,
    space: core.space.Tx,
    objectId: person,
    objectClass: contact.class.Person,
    objectSpace: contact.space.Contacts,
    mixin: contact.mixin.Employee,
    attributes: { active },
    modifiedBy: core.account.System,
    modifiedOn: Date.now()
  }
  return tx as Tx
}

function socialIdentityQueries (control: TriggerControl): number {
  return (control.findAll as jest.Mock).mock.calls.filter((call) => call[1] === contact.class.SocialIdentity).length
}

describe('OnEmployee', () => {
  const person = generateId<Employee>()
  const bot = generateId<Employee>()

  it('assigns a free office to an activated employee', async () => {
    const office = generateId<Office>()
    const control = createControl({
      employees: [{ _id: person, role: 'USER' }],
      offices: [{ _id: office, person: null }],
      botIdentities: []
    })

    const result = await OnEmployee([employeeTx(person, true)], control)

    expect(result).toHaveLength(1)
    const update = result[0] as TxUpdateDoc<Office>
    expect(update._class).toBe(core.class.TxUpdateDoc)
    expect(update.objectId).toBe(office)
    expect(update.operations.person).toBe(person)
  })

  it('does not assign an office if the person already has one', async () => {
    const control = createControl({
      employees: [{ _id: person, role: 'USER' }],
      offices: [
        { _id: generateId(), person },
        { _id: generateId(), person: null }
      ],
      botIdentities: []
    })

    const result = await OnEmployee([employeeTx(person, true)], control)

    expect(result).toHaveLength(0)
  })

  it('does not assign an office to the AI bot', async () => {
    const control = createControl({
      employees: [{ _id: bot, role: 'USER' }],
      offices: [{ _id: generateId(), person: null }],
      botIdentities: [{ attachedTo: bot, key: aiBotEmailSocialKey }]
    })

    const result = await OnEmployee([employeeTx(bot, true)], control)

    expect(result).toHaveLength(0)
  })

  it('skips guests', async () => {
    const control = createControl({
      employees: [{ _id: person, role: 'GUEST' }],
      offices: [{ _id: generateId(), person: null }],
      botIdentities: []
    })

    const result = await OnEmployee([employeeTx(person, true)], control)

    expect(result).toHaveLength(0)
  })

  it('releases all offices held by a deactivated employee', async () => {
    const office1 = generateId<Office>()
    const office2 = generateId<Office>()
    const control = createControl({
      employees: [{ _id: person, role: 'USER' }],
      offices: [
        { _id: office1, person },
        { _id: office2, person }
      ],
      botIdentities: []
    })

    const result = await OnEmployee([employeeTx(person, false)], control)

    expect(result).toHaveLength(2)
    const updates = result as Array<TxUpdateDoc<Office>>
    expect(updates.map((it) => it.objectId).sort()).toEqual([office1, office2].sort())
    for (const update of updates) {
      expect(update.operations.person).toBeNull()
    }
  })

  it('does not assign the same free office twice within one batch', async () => {
    const person2 = generateId<Employee>()
    const office1 = generateId<Office>()
    const office2 = generateId<Office>()
    const control = createControl({
      employees: [
        { _id: person, role: 'USER' },
        { _id: person2, role: 'USER' }
      ],
      offices: [
        { _id: office1, person: null },
        { _id: office2, person: null }
      ],
      botIdentities: []
    })

    const result = await OnEmployee([employeeTx(person, true), employeeTx(person2, true)], control)

    expect(result).toHaveLength(2)
    const updates = result as Array<TxUpdateDoc<Office>>
    expect(new Set(updates.map((it) => it.objectId)).size).toBe(2)
  })

  it('caches the AI bot person between invocations', async () => {
    const control = createControl({
      employees: [{ _id: bot, role: 'USER' }],
      offices: [{ _id: generateId(), person: null }],
      botIdentities: [{ attachedTo: bot, key: aiBotEmailSocialKey }]
    })

    await OnEmployee([employeeTx(bot, true)], control)
    await OnEmployee([employeeTx(bot, true)], control)

    expect(socialIdentityQueries(control)).toBe(1)
  })

  it('does not cache the negative AI bot lookup', async () => {
    const control = createControl({
      employees: [{ _id: person, role: 'USER' }],
      offices: [{ _id: generateId<Office>(), person: null }],
      botIdentities: []
    })

    await OnEmployee([employeeTx(person, true)], control)
    // The bot may join the workspace later, so the lookup should be repeated
    await OnEmployee([employeeTx(person, true)], control)

    expect(socialIdentityQueries(control)).toBe(2)
  })
})
