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
import type { Card } from '@hcengineering/card'
import core, { TxFactory, TxProcessor } from '@hcengineering/core'
import type { DocumentQuery, Ref, TxApplyIf, TxCreateDoc, TxRemoveDoc } from '@hcengineering/core'
import process, { createContext } from '@hcengineering/process'
import type { ContextId, Execution, MethodParams, ProcessToDo, UserResult } from '@hcengineering/process'
import type { TriggerControl } from '@hcengineering/server-core'
import type { ProcessControl } from '@hcengineering/server-process'
import time from '@hcengineering/time'
import { CancelToDo, CheckToDoCancelled, CheckToDoDone, CreateToDo } from '../functions'
import { OnCardUpdate, OnProcessToDoClose, OnProcessToDoRemove } from '../index'
import { ToDoCloseRollback } from '../rollback'
import { getContextValue } from '../utils'

const executionData: Partial<Execution> = {
  _id: 'execution' as Ref<Execution>,
  process: 'process' as Execution['process'],
  card: 'card' as Ref<Card>,
  context: { __contextId: true }
}
const execution = executionData as Execution
const factory = new TxFactory(core.account.System)

function todo (id: string, doneOn: number | null, completionMode: 'any' | 'all' = 'all'): ProcessToDo {
  const data: Partial<ProcessToDo> = {
    _id: id as Ref<ProcessToDo>,
    _class: process.class.ProcessToDo,
    space: time.space.ToDos,
    execution: execution._id,
    user: id as ProcessToDo['user'],
    group: 'group',
    completionMode,
    doneOn,
    withRollback: true
  }
  return data as ProcessToDo
}

function createProcessControl (todos: ProcessToDo[]): { control: ProcessControl, findAll: jest.Mock } {
  const findAll = jest.fn(async (_class: unknown, query: DocumentQuery<ProcessToDo>) => {
    expect(Object.keys(query).some((key) => key.startsWith('$'))).toBe(false)
    return todos.filter(
      (item) =>
        item.execution === query.execution &&
        (query._id === undefined || item._id === query._id) &&
        (query.group === undefined || item.group === query.group) &&
        (query.doneOn === undefined || item.doneOn === query.doneOn)
    )
  })
  const control = {
    client: {
      txFactory: factory,
      getModel: () => ({ findObject: () => ({ bindings: {} }) }),
      findAll
    }
  } as unknown as ProcessControl
  return { control, findAll }
}

function processControl (todos: ProcessToDo[] = []): ProcessControl {
  return createProcessControl(todos).control
}

function triggerControl (todos: ProcessToDo[]): { control: TriggerControl, send: jest.Mock } {
  const send = jest.fn(async () => {})
  const control = {
    txFactory: factory,
    hierarchy: { isDerived: () => true },
    ctx: { newChild: () => ({}), error: jest.fn() },
    workspace: { uuid: 'workspace' },
    queue: { getProducer: () => ({ send }) },
    removedMap: new Map(todos.map((item) => [item._id, item])),
    findAll: jest.fn(async (_ctx: unknown, _class: unknown, query: { _id?: string, group?: string, doneOn?: null }) =>
      todos.filter((item) =>
        query._id !== undefined ? item._id === query._id : item.group === query.group && item.doneOn === query.doneOn
      )
    )
  } as unknown as TriggerControl
  return { control, send }
}

describe('process to-do groups', () => {
  it.each(['any', 'all'] as const)('creates one to-do per distinct assignee in %s mode', async (completionMode) => {
    const params = {
      title: 'Task',
      user: ['alice', 'bob', 'alice'],
      completionMode
    } as unknown as MethodParams<ProcessToDo>
    const result = await CreateToDo(params, execution, processControl(), [])
    if (!('txes' in result)) throw new Error('Expected successful creation')
    const todos = result.txes.map((tx) => TxProcessor.createDoc2Doc(tx as TxCreateDoc<ProcessToDo>))
    expect(todos.map((item) => item.user)).toEqual(['alice', 'bob'])
    expect(new Set(todos.map((item) => item._id)).size).toBe(2)
    expect(todos.every((item) => item.group === todos[0]._id && item.completionMode === completionMode)).toBe(true)
    expect(result.context?.[0]._id).toBe(todos[0]._id)
  })

  it('keeps scalar assignees supported', async () => {
    const result = await CreateToDo(
      { title: 'Task', user: 'alice' as ProcessToDo['user'] },
      execution,
      processControl(),
      []
    )
    if (!('txes' in result)) throw new Error('Expected successful creation')
    expect(result.txes).toHaveLength(1)
    expect((result.txes[0] as TxCreateDoc<ProcessToDo>).attributes.user).toBe('alice')
  })

  it('rejects an empty assignee list', async () => {
    await expect(
      CreateToDo({ title: 'Task', user: [] } as unknown as MethodParams<ProcessToDo>, execution, processControl(), [])
    ).rejects.toThrow()
  })

  it.each([
    { mode: 'all' as const, done: [1, null], expected: false },
    { mode: 'all' as const, done: [1, 2], expected: true },
    { mode: 'any' as const, done: [1, null], expected: true },
    { mode: 'any' as const, done: [null, null], expected: false }
  ])('checks $mode completion for $done', async ({ mode, done, expected }) => {
    const todos = done.map((date, index) => todo(String(index), date, mode))
    const { control, findAll } = createProcessControl(todos)
    expect(await CheckToDoDone(control, execution, { _id: 'group' }, { todo: todos[0] })).toBe(expected)
    expect(await CheckToDoDone(control, execution, { _id: 'group' }, {})).toBe(expected)
    expect(findAll).toHaveBeenCalledWith(process.class.ProcessToDo, {
      execution: execution._id,
      group: 'group'
    })
  })

  it('does not complete an empty or unrelated group', async () => {
    expect(await CheckToDoDone(processControl(), execution, { _id: 'group' }, {})).toBe(false)
    expect(
      await CheckToDoDone(
        processControl([todo('a', 1)]),
        execution,
        { _id: 'other' },
        {
          todo: todo('a', 1)
        }
      )
    ).toBe(false)
  })

  it('keeps result conditions and legacy completion events supported', async () => {
    const legacy = todo('legacy', 1)
    delete legacy.group
    expect(await CheckToDoDone(processControl(), execution, { _id: 'legacy' }, { todo: legacy })).toBe(true)
    expect(
      await CheckToDoDone(
        processControl([todo('a', 1, 'any')]),
        execution,
        {
          _id: 'group',
          result: { missing: 'value' }
        },
        {}
      )
    ).toBe(false)
  })

  it('cancels pending siblings after the first completion and restores them on rollback', async () => {
    const winner = todo('winner', 1, 'any')
    const pending = todo('pending', null, 'any')
    const { control, send } = triggerControl([winner, pending, todo('already-done', 2, 'any')])
    const close = factory.createTxUpdateDoc(winner._class, winner.space, winner._id, { doneOn: 1 })
    const txes = await OnProcessToDoClose([close], control)
    expect(txes).toHaveLength(1)
    expect((txes[0] as TxRemoveDoc<ProcessToDo>).objectId).toBe(pending._id)
    expect(txes[0].space).toBe(core.space.DerivedTx)
    const event = send.mock.calls[0][2][0]
    expect(event.context.cancelledToDos).toEqual([pending])
    const rollback = ToDoCloseRollback(event.context, processControl()) as TxApplyIf
    expect(rollback.txes).toHaveLength(2)
    expect(rollback.txes[0].objectId).toBe(winner._id)
    expect(rollback.txes[1].objectId).toBe(pending._id)
    send.mockClear()
    await OnProcessToDoRemove(txes, control)
    expect(send).not.toHaveBeenCalled()
  })

  it('leaves other participants active in all mode', async () => {
    const completed = todo('first', 1)
    const { control } = triggerControl([completed, todo('second', null)])
    expect(
      await OnProcessToDoClose(
        [factory.createTxUpdateDoc(completed._class, completed.space, completed._id, { doneOn: 1 })],
        control
      )
    ).toEqual([])
  })

  it('cancels the entire pending group and records restoration transactions', async () => {
    const pending = [todo('first', null), todo('second', null)]
    const { control, findAll } = createProcessControl(pending)
    const result = await CancelToDo({ _id: 'group' }, execution, control)
    if (!('txes' in result)) throw new Error('Expected successful cancellation')
    expect(result.txes).toHaveLength(2)
    expect(result.rollback).toHaveLength(2)
    expect(findAll).toHaveBeenCalledWith(process.class.ProcessToDo, {
      execution: execution._id,
      group: 'group',
      doneOn: null
    })
    expect(await CheckToDoCancelled(control, execution, { _id: 'group' }, { todo: pending[1] })).toBe(true)
  })

  it('synchronizes group assignees without recreating completed participants', async () => {
    const completed = todo('alice', 1)
    const removed = { ...todo('bob', null), field: 'assignees' }
    const kept = { ...todo('carol', null), field: 'assignees' }
    const card = { _id: execution.card, assignees: ['alice', 'carol', 'dave', 'dave'] }
    const control = {
      txFactory: factory,
      hierarchy: { isDerived: () => true, isMixin: () => false },
      modelDb: { findObject: () => ({ masterTag: cardPlugin.class.Card }) },
      findAll: async (_ctx: unknown, _class: string, query: { group?: string }) => {
        if (_class === cardPlugin.class.Card) return [card]
        if (_class === process.class.Execution) return [execution]
        return query.group === undefined ? [removed, kept] : [completed, removed, kept]
      }
    } as unknown as TriggerControl
    const update = factory.createTxUpdateDoc<Card>(cardPlugin.class.Card, time.space.ToDos, execution.card, {
      assignees: card.assignees
    } as unknown as Partial<Card>)
    const txes = await OnCardUpdate([update], control)
    expect(txes).toHaveLength(2)
    expect((txes[0] as TxRemoveDoc<ProcessToDo>).objectId).toBe(removed._id)
    expect((txes[1] as TxCreateDoc<ProcessToDo>).attributes).toMatchObject({
      user: 'dave',
      group: 'group',
      completionMode: 'all',
      doneOn: null
    })
  })

  it('resolves context attributes after the original group member was cancelled', async () => {
    const contextId = 'created-todo' as ContextId
    const currentExecution: Execution = { ...execution, context: { ...execution.context, [contextId]: 'group' } }
    const findOne = jest.fn(async (_class: unknown, query: { group?: string }) =>
      query.group === 'group' ? { ...todo('winner', 1, 'any'), title: 'Group task' } : undefined
    )
    const definition = { context: { [contextId]: { _class: process.class.ProcessToDo } } }
    const control = {
      cache: new Map(),
      client: {
        findOne,
        getModel: () => ({ findObject: () => definition }),
        getHierarchy: () => ({})
      }
    } as unknown as ProcessControl
    const value = createContext({ type: 'context', id: contextId, key: 'title' })
    expect(await getContextValue(value, control, currentExecution)).toBe('Group task')
    expect(findOne).toHaveBeenLastCalledWith(process.class.ProcessToDo, {
      execution: execution._id,
      group: 'group'
    })
  })

  it('discards configured results and required fields when everyone must complete', async () => {
    const results = [{ _id: 'answer', name: 'Answer', key: 'title' }] as UserResult[]
    const params = {
      title: 'Task',
      user: ['alice', 'bob'],
      completionMode: 'all',
      askRequired: true
    } as unknown as MethodParams<ProcessToDo>
    const result = await CreateToDo(params, execution, processControl(), results)
    if (!('txes' in result)) throw new Error('Expected successful creation')
    for (const tx of result.txes as TxCreateDoc<ProcessToDo>[]) {
      expect(tx.attributes.results).toEqual([])
      expect(tx.attributes.askRequired).toBe(false)
    }
    expect(results).toHaveLength(1)
  })

  it.each(['any', undefined] as const)('preserves results for mode %s', async (completionMode) => {
    const results = [{ _id: 'answer', name: 'Answer', key: 'title' }] as UserResult[]
    const result = await CreateToDo(
      {
        title: 'Task',
        user: 'alice' as ProcessToDo['user'],
        completionMode
      },
      execution,
      processControl(),
      results
    )
    if (!('txes' in result)) throw new Error('Expected successful creation')
    const attributes = (result.txes[0] as TxCreateDoc<ProcessToDo>).attributes
    expect(attributes.results).toEqual(results)
    expect(attributes.completionMode).toBe('any')
  })

  it('ignores stale result conditions when everyone must complete', async () => {
    expect(
      await CheckToDoDone(
        processControl([todo('alice', 1), todo('bob', 2)]),
        execution,
        {
          _id: 'group',
          result: { missing: 'value' }
        },
        {}
      )
    ).toBe(true)
  })

  it('does not forward results from existing all-mode to-dos to the process service', async () => {
    const completed = { ...todo('first', 1), results: [{ _id: 'answer', key: 'title' }] as UserResult[] }
    const { control, send } = triggerControl([completed])
    await OnProcessToDoClose(
      [factory.createTxUpdateDoc(completed._class, completed.space, completed._id, { doneOn: 1 })],
      control
    )
    expect(send.mock.calls[0][2][0].context.todo.results).toEqual([])
  })

  it('finds legacy to-dos by id without a group', async () => {
    const legacy = todo('legacy', 1)
    delete legacy.group
    delete legacy.completionMode
    const control = processControl([legacy])
    expect(await CheckToDoDone(control, execution, { _id: 'legacy' }, {})).toBe(true)
    legacy.doneOn = null
    const result = await CancelToDo({ _id: 'legacy' }, execution, control)
    if (!('txes' in result)) throw new Error('Expected successful cancellation')
    expect(result.txes).toHaveLength(1)
    expect((result.txes[0] as TxRemoveDoc<ProcessToDo>).objectId).toBe(legacy._id)
  })

  it('deduplicates id and group matches and excludes completed or unrelated to-dos', async () => {
    const root = todo('group', null)
    const pending = todo('pending', null)
    const completed = todo('completed', 1)
    const foreign = { ...todo('foreign', null), execution: 'another-execution' as Ref<Execution> }
    const unrelated = { ...todo('unrelated', null), group: 'another-group' }
    const { control, findAll } = createProcessControl([root, pending, completed, foreign, unrelated])
    expect(await CheckToDoDone(control, execution, { _id: 'group' }, {})).toBe(false)
    const result = await CancelToDo({ _id: 'group' }, execution, control)
    if (!('txes' in result)) throw new Error('Expected successful cancellation')
    expect(result.txes.map((tx) => (tx as TxRemoveDoc<ProcessToDo>).objectId)).toEqual(['group', 'pending'])
    expect(result.rollback).toHaveLength(2)
    expect(findAll).toHaveBeenCalledWith(process.class.ProcessToDo, {
      execution: execution._id,
      _id: 'group',
      doneOn: null
    })
  })
})
