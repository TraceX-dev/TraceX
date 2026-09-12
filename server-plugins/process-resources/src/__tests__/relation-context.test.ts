//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import core, { TxFactory, TxProcessor } from '@hcengineering/core'
import type { Association, Doc, FindResult, Ref, Relation, TxCreateDoc, TxCUD } from '@hcengineering/core'
import type { ContextId, Execution, MethodParams, Process } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'
import { RemoveRelation, SetContext, UpdateContext } from '../functions'
import { FirstValue, RemoveFirst } from '../transform'

const association = 'association' as Ref<Association>
const currentCard = 'new-version' as Ref<Doc>
const originalCard = 'original' as Ref<Doc>
const contextId = 'remaining' as ContextId
const execution = {
  card: currentCard,
  process: 'process' as Ref<Process>,
  context: { [contextId]: [originalCard] }
} as unknown as Execution

interface TestControl {
  control: ProcessControl
  findAll: jest.Mock<Promise<FindResult<Doc>>, unknown[]>
}

function makeControl (): TestControl {
  const findAll = jest.fn<Promise<FindResult<Doc>>, unknown[]>().mockResolvedValue(Object.assign([], { total: 0 }))
  const control = {
    client: {
      txFactory: new TxFactory(core.account.System),
      getModel: () => ({
        findObject: () => ({
          context: {
            [contextId]: { name: 'Remaining', isResult: true, type: { _class: core.class.ArrOf } }
          }
        })
      }),
      findAll
    }
  } as unknown as ProcessControl
  return { control, findAll }
}

describe('RemoveRelation', () => {
  it.each(['A', 'B'] as const)('only removes the selected links on side %s of the current card', async (direction) => {
    const { control, findAll } = makeControl()
    const data = {
      association,
      docA: direction === 'A' ? originalCard : currentCard,
      docB: direction === 'A' ? currentCard : originalCard
    }
    const relation = TxProcessor.createDoc2Doc(
      control.client.txFactory.createTxCreateDoc(core.class.Relation, core.space.Workspace, data)
    )
    findAll.mockResolvedValue(Object.assign([relation], { total: 1 }))
    const result = await RemoveRelation(
      { association, direction, _id: [originalCard, originalCard] } as unknown as MethodParams<Relation>,
      execution,
      control
    )
    expect(findAll).toHaveBeenCalledWith(core.class.Relation, {
      association,
      ...(direction === 'A'
        ? { docA: { $in: [originalCard] }, docB: currentCard }
        : { docA: currentCard, docB: { $in: [originalCard] } })
    })
    if (!('txes' in result)) throw new Error('Expected success')
    expect(result.txes).toHaveLength(1)
    const removeTx = result.txes[0] as TxCUD<Relation>
    expect(removeTx._class).toBe(core.class.TxRemoveDoc)
    expect(removeTx.objectId).toBe(relation._id)
    expect(removeTx.objectClass).toBe(core.class.Relation)
    const restoreTx = result.rollback?.[0] as TxCreateDoc<Relation>
    expect(restoreTx.objectId).toBe(relation._id)
    expect(restoreTx.attributes).toEqual(data)
  })

  it('does nothing when the link has already been removed', async () => {
    const result = await RemoveRelation(
      { association, direction: 'B', _id: originalCard },
      execution,
      makeControl().control
    )
    expect(result).toEqual({ txes: [], rollback: [], context: null })
  })

  it('accepts an empty list without querying or removing any links', async () => {
    const { control, findAll } = makeControl()
    expect(
      await RemoveRelation(
        { association, direction: 'B', _id: [] } as unknown as MethodParams<Relation>,
        execution,
        control
      )
    ).toEqual({ txes: [], rollback: [], context: null })
    expect(findAll).not.toHaveBeenCalled()
  })

  it.each([
    { association, direction: 'wrong', _id: originalCard },
    { association, direction: 'B' },
    { association, direction: 'B', _id: [originalCard, null] }
  ])('rejects invalid parameters before reading links', async (params) => {
    const { control, findAll } = makeControl()
    await expect(RemoveRelation(params as unknown as MethodParams<Relation>, execution, control)).rejects.toThrow()
    expect(findAll).not.toHaveBeenCalled()
  })
})

describe('UpdateContext', () => {
  it.each([{ value: [] }, { value: false }, { value: 0 }, { value: '' }])(
    'writes an empty or falsy value to the existing result',
    async ({ value }) => {
      const result = await UpdateContext({ contextId, value }, execution, makeControl().control)
      expect(result).toEqual({ txes: [], rollback: [], context: null, results: [{ _id: contextId, value }] })
      expect(execution.context[contextId]).toEqual([originalCard])
    }
  )

  it('rejects unknown or uninitialized context', async () => {
    await expect(UpdateContext({ contextId: 'missing', value: [] }, execution, makeControl().control)).rejects.toThrow()
    const context: Execution['context'] = { __contextId: true }
    await expect(
      UpdateContext({ contextId, value: [] }, { ...execution, context }, makeControl().control)
    ).rejects.toThrow()
  })

  it('rejects an omitted value', async () => {
    await expect(UpdateContext({ contextId }, execution, makeControl().control)).rejects.toThrow()
  })

  it('exhausts the saved list without including copies added to the relation', async () => {
    const { control } = makeControl()
    const linkedCards = [originalCard, 'second' as Ref<Doc>]
    const initialized = await SetContext({ value: [...linkedCards] }, execution, control, [
      {
        _id: contextId,
        name: 'Remaining',
        type: { _class: core.class.ArrOf, label: core.string.Object }
      }
    ])
    if (!('results' in initialized) || initialized.results === undefined) throw new Error('Expected saved list')
    let resumedExecution: Execution = {
      ...execution,
      context: { ...execution.context, [contextId]: initialized.results[0].value }
    }
    const processed: Ref<Doc>[] = []
    while (resumedExecution.context[contextId].length > 0) {
      if (processed.length > 2) throw new Error('Loop did not terminate')
      const remaining = resumedExecution.context[contextId] as Array<Ref<Doc>>
      const current = await FirstValue(remaining, {}, control)
      processed.push(current)
      linkedCards.push(('copy-' + current) as Ref<Doc>)
      linkedCards.splice(linkedCards.indexOf(current), 1)
      const result = await UpdateContext({ contextId, value: RemoveFirst(remaining) }, resumedExecution, control)
      if (!('results' in result) || result.results === undefined) throw new Error('Expected updated list')
      // Rehydrate persisted execution context between iterations.
      resumedExecution = JSON.parse(
        JSON.stringify({
          ...resumedExecution,
          context: { [contextId]: result.results[0].value }
        })
      )
    }
    expect(processed).toEqual([originalCard, 'second'])
    expect(linkedCards).toEqual(['copy-original', 'copy-second'])
    expect(resumedExecution.context[contextId]).toEqual([])
  })
})
