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

import type { WorkspaceUuid } from '@hcengineering/core'
import { WorkspaceClientCache } from '../workspace-client-cache'

interface TestWorkspaceClient {
  id: number
}

describe('workspace client cache', () => {
  const accountsUrl = 'http://accounts'
  const workspace = 'workspace-a' as WorkspaceUuid
  const otherWorkspace = 'workspace-b' as WorkspaceUuid
  const thirdWorkspace = 'workspace-c' as WorkspaceUuid
  const first: TestWorkspaceClient = { id: 1 }
  const second: TestWorkspaceClient = { id: 2 }
  let cache: WorkspaceClientCache<TestWorkspaceClient>

  beforeEach(() => {
    jest.useFakeTimers()
    cache = new WorkspaceClientCache(2, 1000)
  })

  afterEach(() => {
    cache.clear()
    jest.useRealTimers()
  })

  it('reuses one client and model across repeated workspace operations', async () => {
    const create = jest.fn(async () => first)
    for (let operation = 0; operation < 70; operation++) {
      expect(await cache.get(accountsUrl, workspace, create)).toBe(first)
    }
    expect(create).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
  })

  it('shares a pending client creation between concurrent callers', async () => {
    let resolveClient: (value: TestWorkspaceClient) => void = () => {}
    const pending = new Promise<TestWorkspaceClient>((resolve) => {
      resolveClient = resolve
    })
    const create = jest.fn(async () => await pending)
    const a = cache.get(accountsUrl, workspace, create)
    const b = cache.get(accountsUrl, workspace, create)
    await Promise.resolve()
    expect(create).toHaveBeenCalledTimes(1)
    resolveClient(first)
    expect(await a).toBe(first)
    expect(await b).toBe(first)
  })

  it('isolates workspaces and account services', async () => {
    const create = jest.fn(async () => first)
    await cache.get(accountsUrl, workspace, create)
    await cache.get(accountsUrl, otherWorkspace, create)
    await cache.get('http://other-accounts', workspace, create)
    expect(create).toHaveBeenCalledTimes(3)
  })

  it('refreshes a busy workspace after the maximum age', async () => {
    const create = jest.fn(async () => first)
    await cache.get(accountsUrl, workspace, create)
    jest.advanceTimersByTime(900)
    await cache.get(accountsUrl, workspace, create)
    jest.advanceTimersByTime(100)
    expect(jest.getTimerCount()).toBe(0)
    await cache.get(accountsUrl, workspace, create)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used workspace and cancels its timer', async () => {
    const create = jest.fn(async () => first)
    await cache.get(accountsUrl, workspace, create)
    await cache.get(accountsUrl, otherWorkspace, create)
    await cache.get(accountsUrl, workspace, create)
    await cache.get(accountsUrl, thirdWorkspace, create)
    expect(jest.getTimerCount()).toBe(2)
    await cache.get(accountsUrl, workspace, create)
    expect(create).toHaveBeenCalledTimes(3)
    await cache.get(accountsUrl, otherWorkspace, create)
    expect(create).toHaveBeenCalledTimes(4)
  })

  it('allows retry after client creation fails', async () => {
    const failure = new Error('Workspace unavailable')
    const create = jest.fn(async () => first).mockRejectedValueOnce(failure)
    await expect(cache.get(accountsUrl, workspace, create)).rejects.toBe(failure)
    expect(jest.getTimerCount()).toBe(0)
    expect(await cache.get(accountsUrl, workspace, create)).toBe(first)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('invalidates pending loads without allowing their failure to evict a replacement', async () => {
    let rejectClient: (error: Error) => void = () => {}
    const pending = new Promise<TestWorkspaceClient>((_resolve, reject) => {
      rejectClient = reject
    })
    const old = cache.get(accountsUrl, workspace, async () => await pending)
    const rejection = expect(old).rejects.toThrow('Old request failed')
    cache.invalidate(accountsUrl, workspace)
    const create = jest.fn(async () => second)
    expect(await cache.get(accountsUrl, workspace, create)).toBe(second)
    rejectClient(new Error('Old request failed'))
    await rejection
    expect(await cache.get(accountsUrl, workspace, create)).toBe(second)
    expect(create).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
  })

  it('keeps invalidated in-flight callers usable without restoring their stale entry', async () => {
    let resolveClient: (value: TestWorkspaceClient) => void = () => {}
    const pending = new Promise<TestWorkspaceClient>((resolve) => {
      resolveClient = resolve
    })
    const old = cache.get(accountsUrl, workspace, async () => await pending)
    cache.invalidate(accountsUrl, workspace)
    const create = jest.fn(async () => second)
    expect(await cache.get(accountsUrl, workspace, create)).toBe(second)
    resolveClient(first)
    expect(await old).toBe(first)
    cache.invalidate(accountsUrl, workspace, first)
    jest.advanceTimersByTime(100)
    expect(await cache.get(accountsUrl, workspace, create)).toBe(second)
    expect(create).toHaveBeenCalledTimes(1)
    cache.invalidate(accountsUrl, workspace, second)
    await cache.get(accountsUrl, workspace, create)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('clears all expiry timers and forces a new load after shutdown', async () => {
    const create = jest.fn(async () => first)
    await cache.get(accountsUrl, workspace, create)
    await cache.get(accountsUrl, otherWorkspace, create)
    cache.clear()
    expect(jest.getTimerCount()).toBe(0)
    await cache.get(accountsUrl, workspace, create)
    expect(create).toHaveBeenCalledTimes(3)
  })
})
