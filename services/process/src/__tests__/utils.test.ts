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

import { createRestTxOperations } from '@hcengineering/api-client'
import type { TxOperations, WorkspaceUuid } from '@hcengineering/core'
import { getClient, releaseClient } from '../utils'

jest.mock('@hcengineering/api-client', () => ({ createRestTxOperations: jest.fn() }))
jest.mock('@hcengineering/account-client', () => ({
  getClient: () => ({
    getLoginInfoByToken: async () => ({ endpoint: 'ws://transactor', workspace: 'workspace', token: 'token' })
  })
}))
jest.mock('@hcengineering/core', () => ({ systemAccountUuid: 'system' }))
jest.mock('@hcengineering/server-token', () => ({ generateToken: () => 'token' }))
jest.mock('../config', () => ({ __esModule: true, default: { AccountsUrl: 'http://accounts' } }))

const createRestClient = jest.mocked(createRestTxOperations)
let workspace: WorkspaceUuid
let sequence = 0
let closeClient: jest.Mock

beforeEach(() => {
  jest.useFakeTimers()
  jest.setSystemTime(0)
  workspace = `workspace-${sequence++}` as WorkspaceUuid
  closeClient = jest.fn().mockResolvedValue(undefined)
  createRestClient.mockReset()
  createRestClient.mockResolvedValue({ close: closeClient } as unknown as TxOperations)
})

afterEach(async () => {
  await jest.runOnlyPendingTimersAsync()
  jest.useRealTimers()
})

it('evicts only after a full minute of idle time since the last release', async () => {
  const client = await getClient(workspace)
  await releaseClient(workspace)
  await jest.advanceTimersByTimeAsync(30000)
  expect(await getClient(workspace)).toBe(client)
  expect(jest.getTimerCount()).toBe(0)
  await releaseClient(workspace)
  expect(jest.getTimerCount()).toBe(1)
  await jest.advanceTimersByTimeAsync(30000)
  expect(closeClient).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(30000)
  expect(closeClient).toHaveBeenCalledTimes(1)
})

it('refreshes an expired model on the next acquisition of an idle client', async () => {
  await getClient(workspace)
  await jest.advanceTimersByTimeAsync(30000)
  await releaseClient(workspace)
  await jest.advanceTimersByTimeAsync(30000)
  const replacementClose = jest.fn().mockResolvedValue(undefined)
  const replacement = { close: replacementClose } as unknown as TxOperations
  createRestClient.mockResolvedValueOnce(replacement)
  expect(await getClient(workspace)).toBe(replacement)
  expect(createRestClient).toHaveBeenCalledTimes(2)
  expect(closeClient).toHaveBeenCalledTimes(1)
  await releaseClient(workspace)
  await jest.advanceTimersByTimeAsync(30000)
  expect(replacementClose).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(30000)
  expect(replacementClose).toHaveBeenCalledTimes(1)
})

it('shares client creation and never replaces a client while it is in use', async () => {
  const [first, second] = await Promise.all([getClient(workspace), getClient(workspace)])
  expect(first).toBe(second)
  expect(createRestClient).toHaveBeenCalledTimes(1)
  await releaseClient(workspace)
  expect(jest.getTimerCount()).toBe(0)
  await jest.advanceTimersByTimeAsync(120000)
  expect(await getClient(workspace)).toBe(first)
  expect(createRestClient).toHaveBeenCalledTimes(1)
  expect(closeClient).not.toHaveBeenCalled()
  await releaseClient(workspace)
  await releaseClient(workspace)
  expect(jest.getTimerCount()).toBe(1)
  await jest.advanceTimersByTimeAsync(60000)
  expect(closeClient).toHaveBeenCalledTimes(1)
})

it('keeps idle timers independent between workspaces', async () => {
  const other = `${workspace}-other` as WorkspaceUuid
  await getClient(workspace)
  await releaseClient(workspace)
  await jest.advanceTimersByTimeAsync(30000)
  await getClient(other)
  await releaseClient(other)
  await jest.advanceTimersByTimeAsync(30000)
  expect(closeClient).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(30000)
  expect(closeClient).toHaveBeenCalledTimes(2)
})

it('allows a new attempt after concurrent callers fail to create a client', async () => {
  createRestClient.mockRejectedValueOnce(new Error('unavailable'))
  const results = await Promise.allSettled([getClient(workspace), getClient(workspace)])
  expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
  expect(createRestClient).toHaveBeenCalledTimes(1)
  await getClient(workspace)
  expect(createRestClient).toHaveBeenCalledTimes(2)
  await releaseClient(workspace)
  await jest.advanceTimersByTimeAsync(60000)
  expect(closeClient).toHaveBeenCalledTimes(1)
})
