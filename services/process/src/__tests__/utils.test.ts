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

// The following notice applies to modifications made in 2026.
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

import clientPlugin from '@hcengineering/client'
import clientResources from '@hcengineering/client-resources'
import type { TxOperations, WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { closeClients, getClient, releaseClient } from '../utils'

jest.mock('@hcengineering/client', () => ({
  __esModule: true, default: { metadata: { FilterModel: 'filter' } }
}))
jest.mock('@hcengineering/client-resources', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@hcengineering/api-client', () => ({ NodeWebSocketFactory: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({ setMetadata: jest.fn() }))
jest.mock('@hcengineering/account-client', () => ({
  getClient: () => ({
    getLoginInfoByToken: async () => ({ endpoint: 'ws://transactor', workspace: 'workspace', token: 'token' })
  })
}))
jest.mock('@hcengineering/core', () => ({
  __esModule: true, default: { account: { System: 'system-social-id' } },
  systemAccountUuid: 'system',
  TxOperations: jest.fn((client: unknown) => client),
  ClientConnectEvent: { Connected: 0, Reconnected: 1, Maintenance: 4 }
}))
jest.mock('@hcengineering/server-token', () => ({ generateToken: () => 'token' }))
jest.mock('../config', () => ({ __esModule: true, default: {
  AccountsUrl: 'http://accounts', ClientIdleTimeoutMs: 600000,
  ClientCacheMaxSize: 2, ClientConnectionTimeoutMs: 30000
} }))

const createWebSocketClient = jest.fn()
let workspace: WorkspaceUuid
let sequence = 0
let closeClient: jest.Mock

beforeEach(() => {
  jest.useFakeTimers()
  workspace = `workspace-${sequence++}` as WorkspaceUuid
  closeClient = jest.fn().mockResolvedValue(undefined)
  createWebSocketClient.mockReset()
  createWebSocketClient.mockResolvedValue({ close: closeClient } as unknown as TxOperations)
  jest.mocked(clientResources).mockResolvedValue({ function: { GetClient: createWebSocketClient } })
})

afterEach(async () => {
  await closeClients()
  jest.useRealTimers()
})

it('evicts only after ten minutes of idle time since the last release', async () => {
  const client = await getClient(workspace)
  await releaseClient(workspace)
  await jest.advanceTimersByTimeAsync(300000)
  expect(await getClient(workspace)).toBe(client)
  expect(jest.getTimerCount()).toBe(0)
  await releaseClient(workspace)
  expect(jest.getTimerCount()).toBe(1)
  await jest.advanceTimersByTimeAsync(300000)
  expect(closeClient).not.toHaveBeenCalled()
  await jest.advanceTimersByTimeAsync(300000)
  expect(closeClient).toHaveBeenCalledTimes(1)
})

it('reuses the live model across repeated events without a one-minute expiry', async () => {
  const client = await getClient(workspace)
  for (let i = 0; i < 5; i++) {
    await releaseClient(workspace)
    await jest.advanceTimersByTimeAsync(120000)
    expect(await getClient(workspace)).toBe(client)
  }
  expect(createWebSocketClient).toHaveBeenCalledTimes(1)
  expect(closeClient).not.toHaveBeenCalled()
  await releaseClient(workspace)
})

it('shares initialization and never closes a client while it is in use', async () => {
  const [first, second] = await Promise.all([getClient(workspace), getClient(workspace)])
  expect(first).toBe(second)
  expect(createWebSocketClient).toHaveBeenCalledTimes(1)
  await releaseClient(workspace)
  expect(jest.getTimerCount()).toBe(0)
  await jest.advanceTimersByTimeAsync(1200000)
  expect(closeClient).not.toHaveBeenCalled()
  await releaseClient(workspace)
  await jest.advanceTimersByTimeAsync(600000)
  expect(closeClient).toHaveBeenCalledTimes(1)
})

it('keeps idle timers independent between workspaces', async () => {
  const other = `${workspace}-other` as WorkspaceUuid
  await getClient(workspace)
  await releaseClient(workspace)
  await jest.advanceTimersByTimeAsync(300000)
  await getClient(other)
  await releaseClient(other)
  await jest.advanceTimersByTimeAsync(300000)
  expect(closeClient).toHaveBeenCalledTimes(1)
  await jest.advanceTimersByTimeAsync(300000)
  expect(closeClient).toHaveBeenCalledTimes(2)
})

it('allows a new attempt after concurrent callers fail initialization', async () => {
  createWebSocketClient.mockRejectedValueOnce(new Error('unavailable'))
  const results = await Promise.allSettled([getClient(workspace), getClient(workspace)])
  expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
  expect(createWebSocketClient).toHaveBeenCalledTimes(1)
  await getClient(workspace)
  expect(createWebSocketClient).toHaveBeenCalledTimes(2)
  await releaseClient(workspace)
})

it('evicts the least recently used idle workspace when the cache fills', async () => {
  const a = await getClient(workspace)
  await releaseClient(workspace)
  const other = `${workspace}-other` as WorkspaceUuid
  const closeOther = jest.fn().mockResolvedValue(undefined)
  createWebSocketClient.mockResolvedValueOnce({ close: closeOther })
  await getClient(other)
  await releaseClient(other)
  expect(await getClient(workspace)).toBe(a)
  await releaseClient(workspace)
  await getClient(`${workspace}-third` as WorkspaceUuid)
  await Promise.resolve()
  expect(closeOther).toHaveBeenCalledTimes(1)
  expect(closeClient).not.toHaveBeenCalled()
})

it('allows active overflow and trims it as soon as a client is released', async () => {
  await getClient(workspace)
  await getClient(`${workspace}-other` as WorkspaceUuid)
  const third = `${workspace}-third` as WorkspaceUuid
  await getClient(third)
  expect(closeClient).not.toHaveBeenCalled()
  await releaseClient(workspace)
  await Promise.resolve()
  expect(closeClient).toHaveBeenCalledTimes(1)
})

it('requests the full model and a bounded binary WebSocket connection', async () => {
  await getClient(workspace)
  expect(setMetadata).toHaveBeenCalledWith(clientPlugin.metadata.FilterModel, 'none')
  expect(createWebSocketClient).toHaveBeenCalledWith('token', 'ws://transactor', expect.objectContaining({
    socketFactory: expect.any(Function), useBinaryProtocol: true,
    useProtocolCompression: true, connectionTimeout: 30000
  }))
})

it('discards an upgraded client after the current event releases it', async () => {
  await getClient(workspace)
  const options = createWebSocketClient.mock.calls[0][2] as { onUpgrade: () => void }
  options.onUpgrade()
  expect(closeClient).not.toHaveBeenCalled()
  await releaseClient(workspace)
  await Promise.resolve()
  expect(closeClient).toHaveBeenCalledTimes(1)
  await getClient(workspace)
  expect(createWebSocketClient).toHaveBeenCalledTimes(2)
})

it('closes all connections and cancels idle timers on shutdown', async () => {
  await getClient(workspace)
  await releaseClient(workspace)
  await getClient(`${workspace}-other` as WorkspaceUuid)
  await closeClients()
  expect(closeClient).toHaveBeenCalledTimes(2)
  expect(jest.getTimerCount()).toBe(0)
})
