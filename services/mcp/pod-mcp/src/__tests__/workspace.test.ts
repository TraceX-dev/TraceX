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

import { getClient, type AccountClient } from '@hcengineering/account-client'
import { createRestTxOperations } from '@hcengineering/api-client'
import { getClient as getCollaborator } from '@hcengineering/collaborator-client'
import type { MeasureContext } from '@hcengineering/core'
import type { StorageAdapter } from '@hcengineering/server-core'
import { WorkspaceManager } from '../workspace'
import type { McpConfig } from '../config'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/api-client', () => ({ createRestTxOperations: jest.fn() }))
jest.mock('@hcengineering/collaborator-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({ decodeToken: (value: string) => JSON.parse(value) }))

const ACCOUNT = '00000000-0000-4000-8000-000000000001'
const FIRST = '00000000-0000-4000-8000-000000000002'
const SECOND = '00000000-0000-4000-8000-000000000003'
const ACCOUNT_TOKEN = JSON.stringify({ account: ACCOUNT })
const config: McpConfig = {
  AccountsURL: 'http://accounts.test',
  ServerSecret: 'test-only',
  CollaboratorURL: 'http://collaborator.test',
  Port: 4020,
  ServiceID: 'test',
  WorkspaceClientCacheMs: 60_000,
  OAuthIssuerURL: 'https://auth.test',
  OAuthInternalURL: 'http://auth.test',
  OAuthResourceURL: 'https://mcp.test/mcp',
  OAuthAllowHttp: false
}

describe('MCP workspace exchange', () => {
  const getWorkspaces = jest.fn()
  const selectWorkspace = jest.fn()
  let manager: WorkspaceManager

  beforeEach(() => {
    jest.clearAllMocks()
    getWorkspaces.mockResolvedValue([
      { uuid: FIRST, name: 'Same name', url: 'first' },
      { uuid: SECOND, name: 'Same name', url: 'second' }
    ])
    selectWorkspace.mockImplementation(async (url: string) => ({
      token: JSON.stringify({ account: ACCOUNT, workspace: url === 'first' ? FIRST : SECOND }),
      workspace: url === 'first' ? FIRST : SECOND,
      endpoint: `http://${url}.test`
    }))
    const accountClient: Partial<AccountClient> = { getUserWorkspaces: getWorkspaces, selectWorkspace }
    jest.mocked(getClient).mockReturnValue(accountClient as AccountClient)
    const operations: Partial<Awaited<ReturnType<typeof createRestTxOperations>>> = { close: async () => {} }
    const collaborator: Partial<ReturnType<typeof getCollaborator>> = {}
    const storage: Partial<StorageAdapter> = {}
    jest
      .mocked(createRestTxOperations)
      .mockResolvedValue(operations as Awaited<ReturnType<typeof createRestTxOperations>>)
    jest.mocked(getCollaborator).mockReturnValue(collaborator as ReturnType<typeof getCollaborator>)
    const context: Partial<MeasureContext> = { error: jest.fn() }
    manager = new WorkspaceManager(config, context as MeasureContext, storage as StorageAdapter)
  })
  afterEach(async () => {
    await manager.close()
  })

  it('exchanges the account token for each explicit workspace and uses the returned endpoint', async () => {
    const first = await manager.getConnection(ACCOUNT_TOKEN, FIRST)
    const second = await manager.getConnection(ACCOUNT_TOKEN, SECOND)
    expect(first.workspace).toBe(FIRST)
    expect(second.workspace).toBe(SECOND)
    expect(first).not.toBe(second)
    expect(selectWorkspace).toHaveBeenNthCalledWith(1, 'first', 'byregion', [])
    expect(selectWorkspace).toHaveBeenNthCalledWith(2, 'second', 'byregion', [])
    expect(createRestTxOperations).toHaveBeenCalledWith('http://first.test', FIRST, first.rawToken, true)
    expect(getClient).toHaveBeenCalledWith(config.AccountsURL, ACCOUNT_TOKEN)
  })

  it('does not resolve duplicate names or an absent workspace implicitly', async () => {
    await expect(manager.getConnection(ACCOUNT_TOKEN, 'Same name')).rejects.toThrow('not accessible')
    await expect(manager.getConnection(ACCOUNT_TOKEN, '')).rejects.toThrow('not accessible')
    expect(selectWorkspace).not.toHaveBeenCalled()
    expect(createRestTxOperations).not.toHaveBeenCalled()
  })

  it('limits discovery to the granted workspace and rejects another workspace before exchange or cache use', async () => {
    expect(await manager.getWorkspaces(ACCOUNT_TOKEN, FIRST)).toEqual([{ id: FIRST, name: 'Same name', url: 'first' }])
    await manager.getConnection(ACCOUNT_TOKEN, SECOND)
    const exchanged = selectWorkspace.mock.calls.length
    await expect(manager.getConnection(ACCOUNT_TOKEN, SECOND, FIRST)).rejects.toThrow('not authorized')
    expect(selectWorkspace).toHaveBeenCalledTimes(exchanged)
    const allowed = await manager.getConnection(ACCOUNT_TOKEN, FIRST, FIRST)
    expect(allowed.workspace).toBe(FIRST)
    getWorkspaces.mockResolvedValue([{ uuid: SECOND, name: 'Same name', url: 'second' }])
    expect(await manager.getWorkspaces(ACCOUNT_TOKEN, FIRST)).toEqual([])
    await expect(manager.getConnection(ACCOUNT_TOKEN, FIRST, FIRST)).rejects.toThrow('not accessible')
  })

  it('checks membership again even when a workspace connection is cached', async () => {
    await manager.getConnection(ACCOUNT_TOKEN, FIRST)
    getWorkspaces.mockResolvedValue([{ uuid: SECOND, name: 'Same name', url: 'second' }])
    await expect(manager.getConnection(ACCOUNT_TOKEN, FIRST)).rejects.toThrow('not accessible')
    expect(selectWorkspace).toHaveBeenCalledTimes(1)
    expect(createRestTxOperations).toHaveBeenCalledTimes(1)
  })

  it('rejects an exchange returning a different workspace or account', async () => {
    selectWorkspace.mockResolvedValue({
      workspace: SECOND,
      token: JSON.stringify({ account: ACCOUNT, workspace: SECOND })
    })
    await expect(manager.getConnection(ACCOUNT_TOKEN, FIRST)).rejects.toThrow('exchange failed')
    selectWorkspace.mockResolvedValue({
      workspace: FIRST,
      token: JSON.stringify({ account: 'another-account', workspace: FIRST })
    })
    await expect(manager.getConnection(ACCOUNT_TOKEN, FIRST)).rejects.toThrow('different account or workspace')
    expect(createRestTxOperations).not.toHaveBeenCalled()
  })
})
