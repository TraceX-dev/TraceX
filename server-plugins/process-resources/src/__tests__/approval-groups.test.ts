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

import core, { TxFactory, TxProcessor } from '@hcengineering/core'
import type { DocumentQuery, Ref, TxCreateDoc, TxRemoveDoc } from '@hcengineering/core'
import process from '@hcengineering/process'
import type { ApproveRequest, Execution, ExecutionReason, MethodParams } from '@hcengineering/process'
import type { TriggerControl } from '@hcengineering/server-core'
import type { ProcessControl } from '@hcengineering/server-process'
import time from '@hcengineering/time'
import { ApproveRequestApproved, ApproveRequestRejected, RequestApproval } from '../functions'
import { OnProcessToDoClose, OnProcessToDoRemove } from '../index'

const executionData: Partial<Execution> = {
  _id: 'execution' as Ref<Execution>,
  process: 'process' as Execution['process'],
  card: 'card' as Execution['card']
}
const execution = executionData as Execution
const factory = new TxFactory(core.account.System)

function request (id: string, approved?: boolean, completionMode?: 'all' | 'any'): ApproveRequest {
  const data: Partial<ApproveRequest> = {
    _id: id as Ref<ApproveRequest>,
    _class: process.class.ApproveRequest,
    space: time.space.ToDos,
    execution: execution._id,
    user: id as ApproveRequest['user'],
    group: 'group',
    approved,
    doneOn: approved === undefined ? null : 1,
    completionMode,
    withRollback: true,
    results: []
  }
  return data as ApproveRequest
}

function fixture (requests: ApproveRequest[] = []): {
  control: ProcessControl
  triggerControl: TriggerControl
  reasons: ExecutionReason[]
  send: jest.Mock
} {
  const reasons: ExecutionReason[] = []
  const send = jest.fn(async () => {})
  const findAll = jest.fn(async (query: DocumentQuery<ApproveRequest>) =>
    requests.filter((item) =>
      Object.entries(query).every(([key, value]) => item[key as keyof ApproveRequest] === value)
    )
  )
  const controlData: Record<string, unknown> = {
    diagnostics: (reason: ExecutionReason) => reasons.push(reason),
    client: {
      txFactory: factory,
      getModel: () => ({ findObject: () => ({ bindings: {} }) }),
      findAll: async (clazz: string, query: DocumentQuery<ApproveRequest>) =>
        clazz === process.class.ApproveRequest ? await findAll(query) : []
    }
  }
  const triggerData: Record<string, unknown> = {
    txFactory: factory,
    hierarchy: { isDerived: () => true },
    ctx: { newChild: () => ({}), error: jest.fn() },
    workspace: { uuid: 'workspace' },
    queue: { getProducer: () => ({ send }) },
    removedMap: new Map(requests.map((item) => [item._id, item])),
    findAll: async (_ctx: unknown, _class: unknown, query: DocumentQuery<ApproveRequest>) => await findAll(query)
  }
  return {
    control: controlData as unknown as ProcessControl,
    triggerControl: triggerData as unknown as TriggerControl,
    reasons,
    send
  }
}

describe('approval completion modes', () => {
  it.each(['all', 'any', undefined] as const)('stores the %s mode on every created request', async (completionMode) => {
    const params: { user: Array<ApproveRequest['user']>, completionMode?: 'all' | 'any' } = {
      user: ['alice', 'bob'] as Array<ApproveRequest['user']>,
      completionMode
    }
    const { control } = fixture()
    const result = await RequestApproval(params as unknown as MethodParams<ApproveRequest>, execution, control, [])
    if (!('txes' in result)) throw new Error('Expected successful creation')
    const requests = result.txes.map((tx) => TxProcessor.createDoc2Doc(tx as TxCreateDoc<ApproveRequest>))
    expect(requests).toHaveLength(2)
    expect(requests.map((item) => item.completionMode)).toEqual([completionMode ?? 'all', completionMode ?? 'all'])
    expect(requests.every((item) => item.group === result.context?.[0]._id)).toBe(true)
  })

  it.each(['all', 'any', undefined] as const)('waits for a decision in %s mode', async (mode) => {
    const { control } = fixture([request('alice', undefined, mode), request('bob', undefined, mode)])
    expect(await ApproveRequestApproved(control, execution, { _id: 'group' }, {})).toBe(false)
    expect(await ApproveRequestRejected(control, execution, { _id: 'group' }, {})).toBe(false)
  })

  it.each(['all', 'any', undefined] as const)('checks one approval in %s mode and reports its rule', async (mode) => {
    const { control, reasons } = fixture([request('alice', true, mode), request('bob', undefined, mode)])
    expect(await ApproveRequestApproved(control, execution, { _id: 'group' }, {})).toBe(mode === 'any')
    expect(reasons[0]).toMatchObject({ code: 'approvals', mode: mode ?? 'all', total: 2, matched: 1 })
  })

  it.each(['all', 'any', undefined] as const)('accepts all approvals in %s mode', async (mode) => {
    const { control } = fixture([request('alice', true, mode), request('bob', true, mode)])
    expect(await ApproveRequestApproved(control, execution, { _id: 'group' }, {})).toBe(true)
    expect(await ApproveRequestRejected(control, execution, { _id: 'group' }, {})).toBe(false)
  })

  it.each(['all', 'any', undefined] as const)('keeps rejection decisive in %s mode', async (mode) => {
    const { control } = fixture([request('alice', true, mode), request('bob', false, mode)])
    expect(await ApproveRequestApproved(control, execution, { _id: 'group' }, {})).toBe(false)
    expect(await ApproveRequestRejected(control, execution, { _id: 'group' }, {})).toBe(true)
  })

  it('cancels only pending requests in the approved any-mode group without rolling back', async () => {
    const approved = request('approved', true, 'any')
    const pending = request('pending', undefined, 'any')
    const otherGroup: ApproveRequest = { ...pending, _id: 'other-group' as Ref<ApproveRequest>, group: 'other' }
    const otherExecution: ApproveRequest = {
      ...pending,
      _id: 'other-execution' as Ref<ApproveRequest>,
      execution: 'other' as Ref<Execution>
    }
    const { triggerControl, send } = fixture([approved, pending, otherGroup, otherExecution])
    const txes = await OnProcessToDoClose(
      [factory.createTxUpdateDoc(approved._class, approved.space, approved._id, { doneOn: 1, approved: true })],
      triggerControl
    )
    expect(txes).toHaveLength(1)
    expect((txes[0] as TxRemoveDoc<ApproveRequest>).objectId).toBe(pending._id)
    expect(txes[0].space).toBe(core.space.DerivedTx)
    expect(await OnProcessToDoRemove(txes, triggerControl)).toEqual([])
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][2][0]).toMatchObject({
      event: [process.trigger.OnToDoClose, process.trigger.OnApproveRequestApproved],
      context: { cancelledToDos: [pending] }
    })
  })

  it.each(['all', undefined] as const)('keeps pending requests after one approval in %s mode', async (mode) => {
    const approved = request('approved', true, mode)
    const { triggerControl } = fixture([approved, request('pending', undefined, mode)])
    expect(
      await OnProcessToDoClose(
        [factory.createTxUpdateDoc(approved._class, approved.space, approved._id, { doneOn: 1, approved: true })],
        triggerControl
      )
    ).toEqual([])
  })

  it('preserves configured approval results when every approver is required', async () => {
    const approved = request('approved', true, 'all')
    const { triggerControl, send } = fixture([approved])
    await OnProcessToDoClose(
      [factory.createTxUpdateDoc(approved._class, approved.space, approved._id, { doneOn: 1, approved: true })],
      triggerControl
    )
    expect(send.mock.calls[0][2][0].context.todo).toBe(approved)
  })
})
