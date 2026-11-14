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

import card from '@hcengineering/card'
import type { Card } from '@hcengineering/card'
import type { Employee } from '@hcengineering/contact'
import { getCurrentEmployee } from '@hcengineering/contact'
import core, { AccountRole, setCurrentAccount, TxFactory } from '@hcengineering/core'
import type { Account, Client, Ref, TxCreateDoc } from '@hcengineering/core'
import { setPlatformStatus } from '@hcengineering/platform'
import process, { ExecutionStatus } from '@hcengineering/process'
import type { EventButton, Execution, Process, State } from '@hcengineering/process'
import { showPopup } from '@hcengineering/ui'
import { AttachmentInput } from '../attachment-input'

jest.mock('@hcengineering/contact', () => ({ getCurrentEmployee: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  setPlatformStatus: jest.fn(),
  unknownError: jest.fn((error: unknown) => error)
}))
jest.mock('@hcengineering/ui', () => ({ showPopup: jest.fn() }))
jest.mock('../components/RequestAttachments.svelte', () => ({ default: 'RequestAttachments' }))

const employee = 'employee' as Ref<Employee>
const processId = 'process' as Ref<Process>
const factory = new TxFactory(core.account.System)
const parent: Execution = {
  _id: 'parent' as Ref<Execution>,
  _class: process.class.Execution,
  space: core.space.Workspace,
  modifiedBy: core.account.System,
  modifiedOn: 0,
  process: processId,
  card: 'parent-card' as Ref<Card>,
  currentState: 'waiting-for-todo' as Ref<State>,
  status: ExecutionStatus.Active,
  context: { __contextId: true },
  rollback: []
}
const targetData: Partial<Card> = { _id: 'target-card' as Ref<Card>, _class: card.class.Card }
const target = targetData as Card
const child = { ...parent, _id: 'child' as Ref<Execution>, parentId: parent._id, card: target._id }
const action: EventButton = {
  _id: 'request' as Ref<EventButton>,
  _class: process.class.EventButton,
  space: core.space.Workspace,
  modifiedBy: core.account.System,
  modifiedOn: 0,
  execution: child._id,
  card: target._id,
  title: 'Upload a document',
  eventType: 'uploaded',
  requireAttachments: true,
  user: employee
}

const findOne = jest.fn()
const findAllSync = jest.fn()
const findObject = jest.fn()
const client = {
  findOne,
  getModel: () => ({ findAllSync, findObject })
} as unknown as Client
let input: AttachmentInput
let closeDialog: () => void
const closePopup = jest.fn()

function createExecution (value: Execution = child): TxCreateDoc<Execution> {
  const { _id, _class, space, modifiedBy, modifiedOn, ...data } = value
  return factory.createTxCreateDoc(process.class.Execution, space, data, _id)
}

function createRequest (value: EventButton = action): TxCreateDoc<EventButton> {
  const { _id, _class, space, modifiedBy, modifiedOn, ...data } = value
  return factory.createTxCreateDoc(process.class.EventButton, space, data, _id)
}

async function flush (): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  const account: Partial<Account> = { role: AccountRole.User }
  setCurrentAccount(account as Account)
  jest.mocked(getCurrentEmployee).mockReturnValue(employee)
  findAllSync.mockReturnValue([])
  findObject.mockReturnValue({ auto: true })
  findOne.mockImplementation(async (classId: string, query: { _id: string }) => {
    if (classId === process.class.EventButton) return { ...action, _id: query._id }
    if (classId === process.class.Execution) return child
    if (classId === card.class.Card) return target
  })
  jest.mocked(showPopup).mockImplementation((_component, _props, _position, onClose) => {
    closeDialog = () => {
      void onClose?.(undefined)
    }
    return { id: 'popup', close: closePopup, update: jest.fn() }
  })
  input = new AttachmentInput(client)
})

afterEach(async () => {
  input.close()
  await flush()
  expect(jest.getTimerCount()).toBe(0)
  jest.useRealTimers()
})

test('opens the actual request on the subprocess card after completion succeeds', async () => {
  const watch = input.watch([parent])
  const request = createRequest()
  input.notify(createExecution(), request)
  await flush()
  expect(showPopup).not.toHaveBeenCalled()

  watch.commit()
  await flush()
  expect(showPopup).toHaveBeenCalledWith(expect.anything(), { action, card: target }, undefined, expect.any(Function))
  expect(findOne).toHaveBeenCalledWith(card.class.Card, { _id: target._id })
})

test('handles requests arriving after the completion response', async () => {
  input.watch([parent]).commit()
  input.notify(createExecution())
  input.notify(createRequest())
  await flush()
  expect(showPopup).toHaveBeenCalledTimes(1)
})

test('handles subprocess requests inside transaction batches', async () => {
  input.watch([parent]).commit()
  const batch = factory.createTxApplyIf(core.space.Tx, 'inner', [], [], [createExecution(), createRequest()], undefined)
  input.notify(batch)
  await flush()
  expect(showPopup).toHaveBeenCalledTimes(1)
})

test('follows nested subprocesses even when the parent moves to a waiting state', async () => {
  input.watch([parent]).commit()
  input.notify(
    factory.createTxUpdateDoc(parent._class, parent.space, parent._id, { currentState: 'waiting' as Ref<State> }),
    createExecution()
  )
  const grandchild = { ...child, _id: 'grandchild' as Ref<Execution>, parentId: child._id }
  input.notify(createExecution(grandchild))
  input.notify(createRequest({ ...action, execution: grandchild._id }))
  await flush()
  expect(showPopup).toHaveBeenCalledTimes(1)
})

test.each([true, false])('opens required and optional attachment requests: %s', async (requireAttachments) => {
  input.watch([parent]).commit()
  input.notify(createExecution(), createRequest({ ...action, requireAttachments }))
  await flush()
  expect(showPopup).toHaveBeenCalledTimes(1)
})

test('ignores unrelated executions, ordinary events and requests assigned to someone else', async () => {
  input.watch([parent]).commit()
  input.notify(createExecution({ ...child, parentId: 'unrelated' as Ref<Execution> }), createRequest())
  input.notify(createExecution(), createRequest({ ...action, requireAttachments: undefined }))
  input.notify(createRequest({ ...action, user: 'other-employee' as Ref<Employee> }))
  await flush()
  expect(showPopup).not.toHaveBeenCalled()
})

test('does not open event actions for guests', async () => {
  const account: Partial<Account> = { role: AccountRole.Guest }
  setCurrentAccount(account as Account)
  input.watch([parent]).commit()
  input.notify(createExecution(), createRequest())
  await flush()
  expect(showPopup).not.toHaveBeenCalled()
})

test('deduplicates notifications and presents multiple requests sequentially', async () => {
  input.watch([parent]).commit()
  const first = createRequest()
  input.notify(createExecution(), first, first)
  input.notify(createRequest({ ...action, _id: 'second-request' as Ref<EventButton> }))
  await flush()
  expect(showPopup).toHaveBeenCalledTimes(1)
  closeDialog()
  await flush()
  expect(showPopup).toHaveBeenCalledTimes(2)
})

test('cancels requests when the completion transaction fails', async () => {
  const watch = input.watch([parent])
  input.notify(createExecution(), createRequest())
  watch.cancel()
  watch.commit()
  await flush()
  expect(showPopup).not.toHaveBeenCalled()
})

test('keeps tracking through automatic transitions and stops at the next waiting state', async () => {
  findAllSync.mockReturnValue([{ trigger: 'automatic' }])
  input.watch([parent]).commit()
  input.notify(
    factory.createTxUpdateDoc(parent._class, parent.space, parent._id, {
      currentState: 'automatic-state' as Ref<State>
    })
  )
  input.notify(createRequest({ ...action, execution: parent._id }))
  await flush()
  expect(showPopup).toHaveBeenCalledTimes(1)
  closeDialog()
  await flush()

  findAllSync.mockReturnValue([{ trigger: process.trigger.OnSubProcessesDone }])
  input.notify(
    factory.createTxUpdateDoc(parent._class, parent.space, parent._id, {
      currentState: 'waiting' as Ref<State>
    })
  )
  input.notify(createExecution(), createRequest({ ...action, _id: 'later-request' as Ref<EventButton> }))
  await flush()
  expect(showPopup).toHaveBeenCalledTimes(1)
})

test('expires tracking when the server does not finish its transition', async () => {
  input.watch([parent]).commit()
  jest.advanceTimersByTime(60_000)
  input.notify(createExecution(), createRequest())
  await flush()
  expect(showPopup).not.toHaveBeenCalled()
})

test.each([{ error: [] }, { status: ExecutionStatus.Done }, { status: ExecutionStatus.Cancelled }])(
  'stops tracking failed or inactive executions: %p',
  async (operations) => {
    input.watch([parent]).commit()
    input.notify(factory.createTxUpdateDoc(parent._class, parent.space, parent._id, operations))
    input.notify(createExecution(), createRequest())
    await flush()
    expect(showPopup).not.toHaveBeenCalled()
  }
)

test.each([process.class.EventButton, process.class.Execution, card.class.Card])(
  'does not show a request when its current %s is missing or inaccessible',
  async (missingClass) => {
    const resolve = findOne.getMockImplementation()
    findOne.mockImplementation(async (classId: string, query: { _id: string }) => {
      return classId === missingClass ? undefined : await resolve?.(classId, query)
    })
    input.watch([parent]).commit()
    input.notify(createExecution(), createRequest())
    await flush()
    expect(showPopup).not.toHaveBeenCalled()
  }
)

test('does not show a queued request from a failed execution', async () => {
  findOne.mockImplementation(async (classId: string) => {
    if (classId === process.class.EventButton) return action
    if (classId === process.class.Execution) return { ...child, error: [] }
    if (classId === card.class.Card) return target
  })
  input.watch([parent]).commit()
  input.notify(createExecution(), createRequest())
  await flush()
  expect(showPopup).not.toHaveBeenCalled()
})

test('reports loading errors without blocking notifications', async () => {
  const error = new Error('Unable to load the target card')
  findOne.mockRejectedValue(error)
  input.watch([parent]).commit()
  expect(() => {
    input.notify(createExecution(), createRequest())
  }).not.toThrow()
  await flush()
  expect(setPlatformStatus).toHaveBeenCalledWith(error)
})

test('closing the client closes the popup and prevents subsequent requests', async () => {
  input.watch([parent]).commit()
  input.notify(createExecution(), createRequest())
  await flush()
  input.close()
  expect(closePopup).toHaveBeenCalledTimes(1)
  input.notify(createRequest({ ...action, _id: 'later-request' as Ref<EventButton> }))
  await flush()
  expect(showPopup).toHaveBeenCalledTimes(1)
})
