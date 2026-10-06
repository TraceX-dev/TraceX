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

import cardPlugin from '@hcengineering/card'
import core, { TxFactory } from '@hcengineering/core'
import type { Class, Doc, PersonId, Ref, Space, Tx, TxCUD } from '@hcengineering/core'
import process, { ExecutionStatus } from '@hcengineering/process'
import type { Execution, Process } from '@hcengineering/process'
import type { GuestTxValidatorControl } from '@hcengineering/server-core'
import { ValidateGuestTx } from '../guestValidator'

const CARD_CLASS = 'test:class:Card' as Ref<Class<Doc>>
const OTHER_CARD_CLASS = 'test:class:OtherCard' as Ref<Class<Doc>>
const SPACE = 'test:space:Cards' as Ref<Space>
const PROCESS = 'test:process:Intake' as Ref<Process>
const CARD = 'test:card:New' as Ref<Doc>

const factory = new TxFactory('guest' as PersonId)

interface Setup {
  autoStart?: boolean
  masterTag?: Ref<Class<Doc>>
  hasInitTransition?: boolean
}

function makeControl (
  applyTxes: Tx[],
  { autoStart = true, masterTag = CARD_CLASS, hasInitTransition = true }: Setup = {}
): GuestTxValidatorControl {
  const derived: Record<string, string[]> = {
    [CARD_CLASS]: [CARD_CLASS, cardPlugin.class.Card, core.class.Doc],
    [OTHER_CARD_CLASS]: [OTHER_CARD_CLASS, cardPlugin.class.Card, core.class.Doc],
    [process.class.Execution]: [process.class.Execution, core.class.Doc]
  }
  const hierarchy = {
    isDerived: (_class: string, from: string) => derived[_class]?.includes(from) ?? _class === from,
    getAncestors: (_class: string) => derived[_class] ?? [_class]
  }
  const findAll = jest.fn(async (_class: Ref<Class<Doc>>, query: any): Promise<any[]> => {
    if (_class === process.class.Process) {
      return query._id === PROCESS ? [{ _id: PROCESS, masterTag, autoStart }] : []
    }
    if (_class === process.class.Transition) {
      return hasInitTransition && query.process === PROCESS ? [{ _id: 'transition', process: PROCESS, from: null }] : []
    }
    return []
  })
  return {
    ctx: {} as any,
    account: {} as any,
    hierarchy: hierarchy as any,
    findAll: findAll as any,
    person: undefined,
    canRead: async () => true,
    applyTxes
  }
}

function cardCreate (attributes: Record<string, unknown> = {}, _class = CARD_CLASS, space = SPACE): Tx {
  return factory.createTxCreateDoc(_class, space, { title: 'New', ...attributes }, CARD)
}

function executionCreate (attributes: Record<string, unknown> = {}, space = SPACE): TxCUD<Execution> {
  return factory.createTxCreateDoc<Execution>(process.class.Execution, space, {
    process: PROCESS,
    currentState: null as any,
    card: CARD as any,
    rollback: [],
    context: { input: 'value' } as any,
    status: ExecutionStatus.Active,
    ...attributes
  })
}

describe('process guest validator', () => {
  it('allows starting an auto-start process of a card created in the same apply', async () => {
    const execution = executionCreate()
    expect(await ValidateGuestTx(execution, makeControl([cardCreate(), execution]))).toBe('allow')
  })

  it('denies an execution outside of the apply that creates the card', async () => {
    const execution = executionCreate()
    expect(await ValidateGuestTx(execution, makeControl([execution]))).toBe('deny')
    expect(await ValidateGuestTx(execution, makeControl([]))).toBe('deny')
  })

  it('denies an execution in another space than the card', async () => {
    const execution = executionCreate({}, 'test:space:Other' as Ref<Space>)
    expect(await ValidateGuestTx(execution, makeControl([cardCreate(), execution]))).toBe('deny')
  })

  it('denies processes that are not auto-started for the card type', async () => {
    const execution = executionCreate()
    const applyTxes = [cardCreate(), execution]
    expect(await ValidateGuestTx(execution, makeControl(applyTxes, { autoStart: false }))).toBe('deny')
    expect(await ValidateGuestTx(execution, makeControl(applyTxes, { masterTag: OTHER_CARD_CLASS }))).toBe('deny')
    expect(await ValidateGuestTx(execution, makeControl(applyTxes, { hasInitTransition: false }))).toBe('deny')
  })

  it('denies executions that do not start from the beginning', async () => {
    for (const attributes of [
      { currentState: 'test:state:Done' },
      { status: ExecutionStatus.Done },
      { rollback: [{}] },
      { context: [] },
      { parentId: 'test:execution:Parent' }
    ]) {
      const execution = executionCreate(attributes)
      expect(await ValidateGuestTx(execution, makeControl([cardCreate(), execution]))).toBe('deny')
    }
  })

  it('denies starting the same process twice for the card', async () => {
    const first = executionCreate()
    const second = executionCreate()
    expect(await ValidateGuestTx(first, makeControl([cardCreate(), first, second]))).toBe('deny')
  })

  it('denies executions of a new card version', async () => {
    const execution = executionCreate()
    const version = cardCreate({ baseId: 'test:card:Base' })
    expect(await ValidateGuestTx(execution, makeControl([version, execution]))).toBe('deny')
  })

  it('leaves updates of executions to the generic guest rules', async () => {
    const update = factory.createTxUpdateDoc(process.class.Execution, SPACE, 'test:execution' as Ref<Execution>, {
      status: ExecutionStatus.Cancelled
    })
    expect(await ValidateGuestTx(update, makeControl([]))).toBeUndefined()
  })

  it('ignores other classes', async () => {
    expect(await ValidateGuestTx(cardCreate() as TxCUD<Doc>, makeControl([]))).toBeUndefined()
  })
})
