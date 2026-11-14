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
import core, { TxOperations, TxProcessor } from '@hcengineering/core'
import type { MeasureContext, TxApplyIf, TxUpdateDoc, WorkspaceUuid } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import process, { ExecutionStatus, processError } from '@hcengineering/process'
import type { Execution, Transition } from '@hcengineering/process'
import { reportProcessDiagnostic, type ProcessControl, type ProcessMessage } from '@hcengineering/server-process'
import { getContextValue } from '@hcengineering/server-process-resources'
import { messageHandler } from '../main'
import { getClient, releaseClient } from '../utils'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn()
}))
jest.mock('@hcengineering/kafka', () => ({
  getPlatformQueue: () => ({ getProducer: () => ({ send: jest.fn().mockResolvedValue(undefined) }) })
}))
jest.mock('@hcengineering/server-process-resources', () => ({
  getContextValue: jest.fn(async (value: unknown) => value)
}))
jest.mock('../collaborator', () => ({ createCollaboratorClient: jest.fn() }))
jest.mock('../utils', () => ({ getClient: jest.fn(), releaseClient: jest.fn(), SERVICE_NAME: 'process' }))
jest.mock('../telemetry', () => ({ instrumentClient: (client: unknown) => client }))
jest.mock('../config', () => ({ __esModule: true, default: { QueueRegion: '' } }))

const ctx = {
  with: async (_name: string, _params: object, operation: (ctx: MeasureContext) => Promise<unknown>) =>
    await operation(ctx),
  counter: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
} as unknown as MeasureContext
let sequence = 0
let record: ProcessMessage
let workspace: WorkspaceUuid

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getClient).mockReset()
  jest.mocked(releaseClient).mockResolvedValue(undefined)
  record = {
    _id: `event-${sequence++}`,
    account: core.account.System,
    createdOn: Date.now(),
    event: [process.trigger.OnToDoClose],
    context: {},
    execution: 'execution' as Execution['_id']
  }
  workspace = `workspace-${sequence}` as WorkspaceUuid
})

afterEach(() => {
  jest.restoreAllMocks()
})

function useClient (client: object): void {
  jest.mocked(getClient).mockResolvedValue(client as Awaited<ReturnType<typeof getClient>>)
}

async function handle (event = record, ws = workspace): Promise<void> {
  await messageHandler(event, ws, ctx)
}

describe('event delivery', () => {
  it('retries the same event after client initialization fails and skips it only after success', async () => {
    const failure = new Error('Client unavailable')
    const findOne = jest.fn().mockResolvedValue(undefined)
    useClient({ findOne })
    jest.mocked(getClient).mockRejectedValueOnce(failure)
    await expect(handle()).rejects.toBe(failure)
    await handle()
    await handle()
    expect(getClient).toHaveBeenCalledTimes(2)
    expect(findOne).toHaveBeenCalledTimes(1)
    expect(releaseClient).toHaveBeenCalledTimes(1)
  })

  it('releases the client and permits redelivery after a database failure', async () => {
    const failure = new Error('Database unavailable')
    const findOne = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
    useClient({ findOne })
    await expect(handle()).rejects.toBe(failure)
    await handle()
    expect(findOne).toHaveBeenCalledTimes(2)
    expect(releaseClient).toHaveBeenCalledTimes(2)
  })

  it('scopes duplicate detection to the workspace', async () => {
    const findOne = jest.fn().mockResolvedValue(undefined)
    useClient({ findOne })
    await handle()
    await handle()
    await handle(record, `${workspace}-other` as WorkspaceUuid)
    expect(findOne).toHaveBeenCalledTimes(2)
  })

  it('shares concurrent delivery failures and allows another attempt', async () => {
    let fail: (error: Error) => void = () => {
      throw new Error('Initialization has not started')
    }
    useClient({ findOne: jest.fn().mockResolvedValue(undefined) })
    jest.mocked(getClient).mockImplementationOnce(
      async () =>
        await new Promise((_resolve, reject) => {
          fail = reject
        })
    )
    const outcomes = Promise.allSettled([handle(), handle()])
    const failure = new Error('Connection lost')
    fail(failure)
    expect(await outcomes).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure }
    ])
    expect(getClient).toHaveBeenCalledTimes(1)
    await handle()
    expect(getClient).toHaveBeenCalledTimes(2)
  })

  it('ignores configuration events', async () => {
    await handle({ ...record, account: core.account.ConfigUser })
    expect(getClient).not.toHaveBeenCalled()
  })
})

function transitionFixture (): {
  execution: Execution
  transition: Transition
  check: jest.Mock
  findObject: jest.Mock
  update: jest.Mock
  tx: jest.Mock
} {
  const execution = {
    _id: record.execution,
    _class: process.class.Execution,
    space: core.space.Workspace,
    process: 'process',
    card: 'card',
    currentState: 'waiting',
    status: ExecutionStatus.Active,
    context: {},
    rollback: []
  } as unknown as Execution
  const transition = {
    _id: 'approved-transition',
    _class: process.class.Transition,
    process: execution.process,
    from: execution.currentState,
    to: 'approved',
    trigger: process.trigger.OnToDoClose,
    triggerParams: { _id: 'approval-group' },
    actions: []
  } as unknown as Transition
  const check = jest.fn().mockResolvedValue(true)
  const findObject = jest.fn((id: string) => ({ _id: id }))
  jest.mocked(getResource).mockResolvedValue(check)
  const update = jest.fn(async (_doc: unknown, changes: Partial<Execution>) => Object.assign(execution, changes))
  jest.spyOn(TxOperations.prototype, 'update').mockImplementation(async (doc, changes) => {
    await update(doc, changes)
    return {}
  })
  const tx = jest.fn(async (apply: TxApplyIf) => {
    for (const change of apply.txes) {
      if (change._class === core.class.TxUpdateDoc && change.objectId === execution._id) {
        TxProcessor.applyUpdate(execution, (change as TxUpdateDoc<Execution>).operations)
      }
    }
    return { success: true }
  })
  useClient({
    findOne: jest.fn(async (clazz: string) =>
      structuredClone(
        clazz === process.class.Execution
          ? execution
          : {
              _id: execution.card,
              _class: card.class.Card
            }
      )
    ),
    tx,
    getHierarchy: () => ({ as: () => ({ serverCheckFunc: 'check' }), clone: structuredClone }),
    getModel: () => ({
      findAllSync: (clazz: string, query: Record<string, unknown>) => {
        if (clazz !== process.class.Transition) return []
        const matches = Object.entries(query).every(([key, value]) => {
          const actual = transition[key as keyof Transition]
          return typeof value === 'object' && value !== null && '$in' in value
            ? (value.$in as unknown[]).includes(actual)
            : actual === value
        })
        return matches ? [transition] : []
      },
      findObject
    })
  })
  return { execution, transition, check, findObject, update, tx }
}

describe('approval trigger failures', () => {
  it('persists an empty-group error, stops the transition and acknowledges the event', async () => {
    const { execution, transition, check, tx } = transitionFixture()
    check.mockRejectedValue(processError(process.error.ObjectNotFound, { _id: 'approval-group' }))
    await handle()
    expect(execution.error).toEqual([
      expect.objectContaining({
        error: process.error.ObjectNotFound,
        props: { _id: 'approval-group' },
        transition: transition._id,
        phase: 'trigger'
      })
    ])
    expect(execution.currentState).toBe('waiting')
    expect(tx).not.toHaveBeenCalled()
    await handle()
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('propagates infrastructure errors from trigger checks and retries the event', async () => {
    const { execution, check, tx } = transitionFixture()
    const failure = new Error('Approval lookup unavailable')
    check.mockRejectedValueOnce(failure).mockResolvedValue(false)
    await expect(handle()).rejects.toBe(failure)
    await handle()
    expect(check).toHaveBeenCalledTimes(2)
    expect(execution.error).toBeUndefined()
    expect(tx).not.toHaveBeenCalled()
  })

  it('persists evidence from the actual check without evaluating it twice', async () => {
    const { execution, check, tx } = transitionFixture()
    check.mockImplementation(async (control: ProcessControl) => {
      reportProcessDiagnostic(control, {
        code: 'custom-wait',
        message: process.string.DiagnosticSubprocesses,
        params: { total: 2, matched: 1 },
        dependencies: [{ _id: 'child' as Execution['_id'], _class: process.class.Execution }]
      })
      return false
    })
    await handle()
    expect(check).toHaveBeenCalledTimes(1)
    expect(tx).not.toHaveBeenCalled()
    expect(execution.diagnostics).toMatchObject({
      state: 'waiting',
      checks: [{ status: 'waiting', reasons: [{ code: 'custom-wait' }] }]
    })
  })

  it('allows a transition to complete when optional diagnostic storage fails', async () => {
    const { execution, update, tx } = transitionFixture()
    update.mockImplementation(async (_doc: unknown, changes: Partial<Execution>) => {
      if (changes.diagnostics !== undefined) throw new Error('Diagnostic storage unavailable')
      return Object.assign(execution, changes)
    })
    await handle()
    expect(tx).toHaveBeenCalledTimes(1)
    expect(execution.status).toBe(ExecutionStatus.Done)
    expect(execution.error).toBeNull()
  })

  it('records the exact failing action and input parameter', async () => {
    const { execution, transition, tx } = transitionFixture()
    const action = {
      _id: 'approval-step',
      methodId: process.method.RequestApproval,
      params: { user: 'missing-user' },
      context: null
    } as unknown as Transition['actions'][number]
    transition.actions = [action]
    jest.mocked(getContextValue).mockRejectedValueOnce(processError(process.error.EmptyAttributeContextValue, {}, {}))
    // The trigger has no inputs; the first resolved value belongs to this action.
    transition.triggerParams = {}
    await handle()
    expect(tx).not.toHaveBeenCalled()
    expect(execution.error).toEqual([
      expect.objectContaining({
        step: action._id,
        method: process.method.RequestApproval,
        parameter: 'user'
      })
    ])
    jest.mocked(getContextValue).mockImplementation(async (value: unknown) => value)
  })

  it('releases the execution guard after transition preparation fails and allows redelivery', async () => {
    const { execution, findObject, tx } = transitionFixture()
    const failure = new Error('Process model unavailable')
    findObject.mockImplementation((id: string) => {
      if (id === execution.process) throw failure
      return { _id: id }
    })
    await expect(handle()).rejects.toBe(failure)
    findObject.mockImplementation((id: string) => ({ _id: id }))
    await handle()
    expect(execution.currentState).toBe('approved')
    expect(tx).toHaveBeenCalledTimes(1)
  })

  it.each(['missing', 'pending', 'approved'] as const)(
    'rechecks approval on Continue when the group is %s',
    async (state) => {
      const { execution, check, tx } = transitionFixture()
      check.mockRejectedValue(processError(process.error.ObjectNotFound, { _id: 'approval-group' }))
      await handle()
      if (state !== 'missing') check.mockResolvedValue(state === 'approved')
      await handle({ ...record, _id: `${record._id}-continue`, event: [process.trigger.OnExecutionContinue] })
      expect(check).toHaveBeenCalledTimes(2)
      expect(execution.currentState).toBe(state === 'approved' ? 'approved' : 'waiting')
      if (state === 'missing') expect(execution.error).not.toBeNull()
      else expect(execution.error).toBeNull()
      expect(tx).toHaveBeenCalledTimes(state === 'approved' ? 1 : 0)
    }
  )
})
