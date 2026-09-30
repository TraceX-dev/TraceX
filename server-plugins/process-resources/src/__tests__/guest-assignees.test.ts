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

import type { Card } from '@hcengineering/card'
import contact from '@hcengineering/contact'
import core, { TxFactory } from '@hcengineering/core'
import type { AccountUuid, Class, Doc, Ref, Space } from '@hcengineering/core'
import process from '@hcengineering/process'
import type { ApproveRequest, Execution, MethodParams, ProcessToDo } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'
import { CreateToDo, RequestApproval } from '../functions'

const CARD_CLASS = 'test:class:Card' as Ref<Class<Card>>
const CARD_SPACE = 'test:space:Cards' as Ref<Space>
const GUEST_ACCOUNT = 'guest-account' as AccountUuid
const GUEST = 'test:person:Guest' as Ref<Doc>
const EMPLOYEE = 'test:person:Employee' as Ref<Doc>

const execution = {
  _id: 'execution' as Ref<Execution>,
  process: 'process' as Execution['process'],
  card: 'card' as Ref<Card>,
  context: { __contextId: true }
} as unknown as Execution

function person (_id: Ref<Doc>, role: 'GUEST' | 'USER', personUuid?: AccountUuid): Doc {
  return {
    _id,
    _class: contact.class.Person,
    name: `${_id},Name`,
    [contact.mixin.Employee]: { active: true, role, personUuid }
  } as unknown as Doc
}

interface Setup {
  members?: AccountUuid[]
  spaceClass?: Ref<Class<Space>>
  archived?: boolean
  /** The card class uses collaborator security and the guest is a collaborator of the card. */
  collaborator?: boolean
  collaboratorSecurity?: boolean
}

function makeControl ({
  members = [],
  spaceClass = 'test:class:CardSpace' as Ref<Class<Space>>,
  archived = false,
  collaborator = false,
  collaboratorSecurity = false
}: Setup): ProcessControl {
  const persons = [person(GUEST, 'GUEST', GUEST_ACCOUNT), person(EMPLOYEE, 'USER', 'employee' as AccountUuid)]
  const card = { _id: execution.card, _class: CARD_CLASS, space: CARD_SPACE }
  const space = { _id: CARD_SPACE, _class: spaceClass, members, archived }
  const findAll = async (_class: Ref<Class<Doc>>, query: any): Promise<any[]> => {
    if (_class === contact.class.Person) return persons.filter((it) => query._id.$in.includes(it._id))
    if (_class === core.class.Collaborator) {
      return collaborator && query.attachedTo.$in.includes(card._id) && query.collaborator === GUEST_ACCOUNT
        ? [{ attachedTo: card._id, collaborator: GUEST_ACCOUNT }]
        : []
    }
    return []
  }
  const hierarchy = {
    hasMixin: (doc: any, mixin: string) => doc[mixin] !== undefined,
    as: (doc: any, mixin: string) => ({ ...doc, ...doc[mixin] }),
    getAncestors: (_class: Ref<Class<Doc>>) => [_class]
  }
  return {
    cache: new Map(),
    client: {
      txFactory: new TxFactory(core.account.System),
      getHierarchy: () => hierarchy,
      getModel: () => ({
        findObject: () => ({ bindings: {} }),
        findAllSync: () => (collaboratorSecurity ? [{ attachedTo: CARD_CLASS, fields: [], provideSecurity: true }] : [])
      }),
      findAll,
      findOne: async (_class: Ref<Class<Doc>>) => (_class === core.class.Space ? space : card)
    }
  } as unknown as ProcessControl
}

const createToDo = async (control: ProcessControl, user: Ref<Doc>): Promise<unknown> =>
  await CreateToDo({ title: 'Task', user } as unknown as MethodParams<ProcessToDo>, execution, control, [])

const requestApproval = async (control: ProcessControl, user: Array<Ref<Doc>>): Promise<unknown> =>
  await RequestApproval({ user } as unknown as MethodParams<ApproveRequest>, execution, control, [])

function guestError (): object {
  return expect.objectContaining({ message: process.error.GuestWithoutCardAccess })
}

describe('process steps assigning guests', () => {
  it('assigns a guest who is a member of the card space', async () => {
    const control = makeControl({ members: [GUEST_ACCOUNT] })
    await expect(createToDo(control, GUEST)).resolves.toHaveProperty('txes')
    await expect(requestApproval(control, [GUEST])).resolves.toHaveProperty('txes')
  })

  it('fails the step for a guest without access to the card', async () => {
    const control = makeControl({})
    await expect(createToDo(control, GUEST)).rejects.toEqual(guestError())
    await expect(requestApproval(control, [EMPLOYEE, GUEST])).rejects.toEqual(guestError())
  })

  it('fails the step when the card space is archived', async () => {
    await expect(createToDo(makeControl({ members: [GUEST_ACCOUNT], archived: true }), GUEST)).rejects.toEqual(
      guestError()
    )
  })

  it('accepts cards in a system space', async () => {
    await expect(createToDo(makeControl({ spaceClass: core.class.SystemSpace }), GUEST)).resolves.toHaveProperty('txes')
  })

  it('accepts access through collaborator security, like the guest permissions middleware', async () => {
    await expect(createToDo(makeControl({ collaborator: true }), GUEST)).rejects.toEqual(guestError())
    await expect(
      createToDo(makeControl({ collaborator: true, collaboratorSecurity: true }), GUEST)
    ).resolves.toHaveProperty('txes')
  })

  it('does not check employees', async () => {
    await expect(createToDo(makeControl({}), EMPLOYEE)).resolves.toHaveProperty('txes')
  })
})
