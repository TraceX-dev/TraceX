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

import card from '@hcengineering/card'
import core, { TxFactory, TxProcessor } from '@hcengineering/core'
import type { Relation, Tx, TxCreateDoc } from '@hcengineering/core'
import process, { ExecutionStatus, ProcessError } from '@hcengineering/process'
import type { Execution, MethodParams } from '@hcengineering/process'
import type { TriggerControl } from '@hcengineering/server-core'
import type { ProcessControl } from '@hcengineering/server-process'
import { ApproveRequestApproved, ApproveRequestRejected, RunSubProcess } from '../functions'
import { OnRelationChange } from '../index'

const factory = new TxFactory(core.account.System)
const execution = {
  _id: 'parent',
  card: 'card',
  process: 'parent-process',
  space: 'space'
} as unknown as Execution

function approvalControl (
  values: Array<boolean | undefined>,
  owner = execution._id
): {
  control: ProcessControl
  findAll: jest.Mock
} {
  const requests = values.map((approved) => ({ group: 'approval-group', execution: owner, approved }))
  const findAll = jest.fn(async (_class: unknown, query: { group: string, execution: string }) =>
    requests.filter((request) => request.group === query.group && request.execution === query.execution)
  )
  return {
    control: { client: { findAll } } as unknown as ProcessControl,
    findAll
  }
}

describe('approval group checks', () => {
  it.each([ApproveRequestApproved, ApproveRequestRejected])(
    'throws a process error for an empty group',
    async (check) => {
      await expect(check(approvalControl([]).control, execution, { _id: 'approval-group' }, {})).rejects.toBeInstanceOf(
        ProcessError
      )
      await expect(check(approvalControl([]).control, execution, { _id: 'approval-group' }, {})).rejects.toMatchObject({
        message: process.error.ObjectNotFound,
        props: { _id: 'approval-group' }
      })
    }
  )

  it.each([ApproveRequestApproved, ApproveRequestRejected])(
    'rejects a group belonging to another execution',
    async (check) => {
      const { control, findAll } = approvalControl([true], 'other-execution' as Execution['_id'])
      await expect(check(control, execution, { _id: 'approval-group' }, {})).rejects.toBeInstanceOf(ProcessError)
      expect(findAll).toHaveBeenCalledWith(process.class.ApproveRequest, {
        execution: execution._id,
        group: 'approval-group'
      })
    }
  )

  it.each([
    { votes: [true, true], approved: true, rejected: false },
    { votes: [true, undefined], approved: false, rejected: false },
    { votes: [true, false], approved: false, rejected: true }
  ])('preserves agreement rules for $votes', async ({ votes, approved, rejected }) => {
    const { control } = approvalControl(votes)
    expect(await ApproveRequestApproved(control, execution, { _id: 'approval-group' }, {})).toBe(approved)
    expect(await ApproveRequestRejected(control, execution, { _id: 'approval-group' }, {})).toBe(rejected)
  })

  it('keeps an unconfigured trigger unmatched', async () => {
    const { control, findAll } = approvalControl([])
    expect(await ApproveRequestApproved(control, execution, {}, {})).toBe(false)
    expect(await ApproveRequestRejected(control, execution, {}, {})).toBe(false)
    expect(findAll).not.toHaveBeenCalled()
  })
})

function relationControl (
  classA = 'card-a',
  classB = 'card-b'
): {
  control: TriggerControl
  send: jest.Mock
  relation: Relation
  created: TxCreateDoc<Relation>
} {
  const created = factory.createTxCreateDoc<Relation>(
    core.class.Relation,
    core.space.Workspace,
    {
      association: 'association' as Relation['association'],
      docA: 'a' as Relation['docA'],
      docB: 'b' as Relation['docB']
    },
    'relation' as Relation['_id']
  )
  const relation = TxProcessor.createDoc2Doc(created)
  const send = jest.fn().mockResolvedValue(undefined)
  const control = {
    txFactory: factory,
    ctx: { newChild: () => ({}), error: jest.fn() },
    workspace: { uuid: 'workspace' },
    queue: { getProducer: () => ({ send }) },
    modelDb: { findObject: () => ({ classA, classB }) },
    hierarchy: {
      isDerived: (clazz: string, base: string) =>
        clazz === base || (base === card.class.Card && ['card-a', 'card-b'].includes(clazz))
    },
    removedMap: new Map([[relation._id, relation]]),
    findAll: jest.fn().mockResolvedValue([relation])
  } as unknown as TriggerControl
  return { control, send, relation, created }
}

describe('relation change events', () => {
  it.each(['added', 'removed', 'changed'] as const)('queues %s for both card endpoints', async (change) => {
    const { control, send, relation, created } = relationControl()
    const tx: Tx =
      change === 'added'
        ? created
        : change === 'removed'
          ? factory.createTxRemoveDoc(relation._class, relation.space, relation._id)
          : factory.createTxUpdateDoc(relation._class, relation.space, relation._id, {})
    await OnRelationChange([tx], control)
    expect(send).toHaveBeenCalledTimes(2)
    const events = send.mock.calls.map((call) => call[2][0])
    expect(events.map((event) => event.card)).toEqual(['a', 'b'])
    expect(events.map((event) => event._id)).toEqual([`${tx._id}_a`, `${tx._id}_b`])
    for (const event of events) {
      expect(event.event).toEqual([process.trigger.WhenRelationChanges])
      expect(event.context).toEqual({ relation, relationChange: change })
    }
  })

  it.each([
    { a: 'card-a', b: 'other-class', expected: ['a'] },
    { a: 'other-class', b: 'card-b', expected: ['b'] },
    { a: 'other-class', b: 'other-class', expected: [] }
  ])('queues events only for card endpoints: $a / $b', async ({ a, b, expected }) => {
    const { control, send, created } = relationControl(a, b)
    await OnRelationChange([created], control)
    expect(send.mock.calls.map((call) => call[2][0].card)).toEqual(expected)
  })

  it('propagates queue failures instead of reporting successful delivery', async () => {
    const { control, send, created } = relationControl()
    const failure = new Error('Queue unavailable')
    send.mockRejectedValueOnce(failure)
    await expect(OnRelationChange([created], control)).rejects.toBe(failure)
  })
})

describe('parallel subprocess prevention', () => {
  it.each([ExecutionStatus.Active, ExecutionStatus.Done, ExecutionStatus.Cancelled])(
    'checks status %s using the current execution contract',
    async (status) => {
      const existing = { process: 'subprocess', card: execution.card, status }
      const findAll = jest.fn(async (_class: unknown, query: Record<string, unknown>) =>
        Object.entries(query).every(([key, value]) => existing[key as keyof typeof existing] === value)
          ? [existing]
          : []
      )
      const control = {
        client: {
          txFactory: factory,
          findAll,
          getModel: () => ({ findObject: () => ({ _id: 'subprocess', parallelExecutionForbidden: true }) })
        }
      } as unknown as ProcessControl
      const params = { _id: 'subprocess' } as unknown as MethodParams<Execution>
      const result = await RunSubProcess(params, execution, control)
      expect(findAll).toHaveBeenCalledWith(process.class.Execution, {
        process: 'subprocess',
        card: execution.card,
        status: ExecutionStatus.Active
      })
      if (!('txes' in result)) throw new Error('Expected subprocess result')
      expect(result.txes).toHaveLength(status === ExecutionStatus.Active ? 0 : 1)
      for (const tx of result.txes as Array<TxCreateDoc<Execution>>) {
        expect(tx.attributes).toMatchObject({ status: ExecutionStatus.Active, parentId: execution._id })
      }
    }
  )
})
