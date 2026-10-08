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

import core from '@hcengineering/core'
import type { MeasureContext, Ref, TxOperations, WorkspaceUuid } from '@hcengineering/core'
import { getPlatformQueue } from '@hcengineering/kafka'
import process, { ExecutionStatus } from '@hcengineering/process'
import type { Execution, Transition } from '@hcengineering/process'
import type { PlatformQueueProducer } from '@hcengineering/server-core'
import type { ProcessMessage, TimeMachineMessage } from '@hcengineering/server-process'
import { getContextValue } from '@hcengineering/server-process-resources'
import { configureTimerProducer, messageHandler } from '../main'
import { getClient, releaseClient } from '../utils'

jest.mock('@hcengineering/core', () => ({
  __esModule: true,
  default: { account: { ConfigUser: 'config', System: 'system' }, class: {} },
  TxOperations: jest.fn((client: unknown) => client),
  SortingOrder: { Ascending: 1 }
}))
jest.mock('@hcengineering/card', () => ({ __esModule: true, default: { class: { Card: 'card' } } }))
jest.mock('@hcengineering/process', () => ({
  __esModule: true,
  default: {
    class: { Execution: 'execution', Transition: 'transition', Trigger: 'trigger' },
    trigger: {
      OnExecutionContinue: 'continue',
      OnToDoClose: 'todo-close',
      OnTime: 'time',
      OnCardUpdate: 'card-update'
    }
  },
  ExecutionStatus: { Active: 'active' },
  parseContext: (value: unknown) => value
}))
jest.mock('@hcengineering/server-process', () => ({
  __esModule: true,
  default: { mixin: { TriggerImpl: 'trigger-impl' } }
}))
jest.mock('@hcengineering/server-core', () => ({ QueueTopic: { TimeMachine: 'time-machine', Process: 'process' } }))
jest.mock('@hcengineering/kafka', () => ({ getPlatformQueue: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({ getResource: jest.fn() }))
jest.mock('@hcengineering/server-process-resources', () => ({ getContextValue: jest.fn() }))
jest.mock('../collaborator', () => ({ createCollaboratorClient: jest.fn() }))
jest.mock('../telemetry', () => ({ instrumentClient: (client: unknown) => client }))
jest.mock('../utils', () => ({ getClient: jest.fn(), releaseClient: jest.fn() }))

const ctx = {
  with: jest.fn(
    async (_name: string, _params: object, op: (ctx: MeasureContext) => unknown): Promise<unknown> =>
      await op(ctx as unknown as MeasureContext)
  ),
  counter: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}
const model = { findAllSync: jest.fn(), findObject: jest.fn() }
const client = {
  findOne: jest.fn(),
  findAll: jest.fn(),
  getModel: () => model,
  getHierarchy: () => ({ clone: (value: unknown) => value, as: (value: unknown) => value })
}
let sequence = 0
let workspace: WorkspaceUuid
let record: ProcessMessage

beforeEach(() => {
  jest.clearAllMocks()
  workspace = `workspace-${sequence++}` as WorkspaceUuid
  record = {
    _id: 'event',
    account: core.account.System,
    createdOn: Date.now(),
    event: [],
    context: {},
    execution: 'execution-1' as Ref<Execution>
  }
  model.findAllSync.mockReset().mockReturnValue([])
  model.findObject.mockReset()
  client.findOne.mockReset().mockResolvedValue(undefined)
  client.findAll.mockReset().mockResolvedValue([])
  jest
    .mocked(getClient)
    .mockReset()
    .mockResolvedValue(client as unknown as TxOperations)
  jest.mocked(releaseClient).mockReset().mockResolvedValue(undefined)
})

it('propagates a connection failure and retries the same event before deduplicating success', async () => {
  const error = new Error('transactor unavailable')
  jest.mocked(getClient).mockRejectedValueOnce(error)
  await expect(messageHandler(record, workspace, ctx as unknown as MeasureContext)).rejects.toBe(error)
  expect(releaseClient).not.toHaveBeenCalled()
  await messageHandler(record, workspace, ctx as unknown as MeasureContext)
  await messageHandler(record, workspace, ctx as unknown as MeasureContext)
  expect(getClient).toHaveBeenCalledTimes(2)
  expect(client.findOne).toHaveBeenCalledTimes(1)
  expect(releaseClient).toHaveBeenCalledTimes(1)
})

it('releases the client on a read failure and allows the queue to retry', async () => {
  const error = new Error('read failed')
  client.findOne.mockRejectedValueOnce(error)
  await expect(messageHandler(record, workspace, ctx as unknown as MeasureContext)).rejects.toBe(error)
  expect(releaseClient).toHaveBeenCalledTimes(1)
  await messageHandler(record, workspace, ctx as unknown as MeasureContext)
  expect(client.findOne).toHaveBeenCalledTimes(2)
  expect(releaseClient).toHaveBeenCalledTimes(2)
})

it('deduplicates message IDs separately in each workspace', async () => {
  await messageHandler(record, workspace, ctx as unknown as MeasureContext)
  await messageHandler(record, `${workspace}-other` as WorkspaceUuid, ctx as unknown as MeasureContext)
  await messageHandler(record, workspace, ctx as unknown as MeasureContext)
  expect(client.findOne).toHaveBeenCalledTimes(2)
})

it('keeps processing events that have no message ID', async () => {
  record._id = undefined
  await messageHandler(record, workspace, ctx as unknown as MeasureContext)
  await messageHandler(record, workspace, ctx as unknown as MeasureContext)
  expect(client.findOne).toHaveBeenCalledTimes(2)
})

it('leaves an execution error intact when its failed transition was deleted', async () => {
  const execution = {
    _id: record.execution,
    process: 'process-1',
    currentState: 'state-1',
    status: ExecutionStatus.Active,
    error: [{ transition: 'deleted-transition' }]
  }
  client.findOne.mockResolvedValue(execution)
  record.event = [process.trigger.OnExecutionContinue]
  await expect(messageHandler(record, workspace, ctx as unknown as MeasureContext)).resolves.toBeUndefined()
  expect(execution.error).toEqual([{ transition: 'deleted-transition' }])
  expect(ctx.warn).toHaveBeenCalledWith(expect.any(String), {
    execution: record.execution,
    transition: 'deleted-transition'
  })
  expect(ctx.error).not.toHaveBeenCalled()
})

it('handles an empty execution error list when continuing', async () => {
  client.findOne.mockResolvedValue({ _id: record.execution, status: ExecutionStatus.Active, error: [] })
  record.event = [process.trigger.OnExecutionContinue]
  await expect(messageHandler(record, workspace, ctx as unknown as MeasureContext)).resolves.toBeUndefined()
  expect(ctx.error).not.toHaveBeenCalled()
})

it('schedules timers through the same configured producer across workspaces', async () => {
  const producer: PlatformQueueProducer<TimeMachineMessage> = {
    send: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
    getQueue: jest.fn()
  }
  configureTimerProducer(producer)
  const targetDate = Date.now() + 60000
  const transition = { _id: 'transition-1', from: 'state-1', triggerParams: { value: { type: 'attribute' } } }
  model.findAllSync.mockImplementation((_class: unknown, query: { trigger?: unknown }) =>
    query.trigger === process.trigger.OnTime ? [transition] : []
  )
  client.findAll.mockResolvedValue([
    { _id: 'execution-1', card: 'card-1', currentState: 'state-1', process: 'process-1' }
  ])
  client.findOne.mockResolvedValue({ _id: 'card-1' })
  jest.mocked(getContextValue).mockResolvedValue(targetDate)
  record = {
    ...record,
    execution: undefined,
    card: 'card-1' as ProcessMessage['card'],
    event: [process.trigger.OnCardUpdate]
  }
  await messageHandler(record, workspace, ctx as unknown as MeasureContext)
  const other = `${workspace}-other` as WorkspaceUuid
  await messageHandler(record, other, ctx as unknown as MeasureContext)
  expect(producer.send).toHaveBeenCalledTimes(2)
  for (const ws of [workspace, other]) {
    expect(producer.send).toHaveBeenCalledWith(ctx, ws, [expect.objectContaining({ type: 'schedule', targetDate })])
  }
  expect(getPlatformQueue).not.toHaveBeenCalled()
  expect(producer.close).not.toHaveBeenCalled()
})

it('propagates transition preparation failures instead of acknowledging the event', async () => {
  const execution = {
    _id: record.execution,
    process: 'process-1',
    currentState: 'state-1',
    status: ExecutionStatus.Active
  }
  const transition = { _id: 'transition-1', trigger: 'trigger-1' } as unknown as Transition
  const error = new Error('model read failed')
  client.findOne.mockResolvedValue(execution)
  model.findAllSync.mockReturnValue([transition])
  model.findObject
    .mockImplementationOnce(() => ({}))
    .mockImplementationOnce(() => {
      throw error
    })
    .mockImplementationOnce(() => ({}))
    .mockImplementationOnce(() => {
      throw error
    })
  await expect(messageHandler(record, workspace, ctx as unknown as MeasureContext)).rejects.toBe(error)
  await expect(messageHandler(record, workspace, ctx as unknown as MeasureContext)).rejects.toBe(error)
  expect(getClient).toHaveBeenCalledTimes(2)
  expect(releaseClient).toHaveBeenCalledTimes(2)
})
