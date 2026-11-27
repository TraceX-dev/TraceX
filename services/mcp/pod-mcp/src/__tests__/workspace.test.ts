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
import {
  AccountRole,
  SocialIdType,
  type Account,
  type AccountUuid,
  type PersonId,
  type MeasureContext
} from '@hcengineering/core'
import type { StorageAdapter } from '@hcengineering/server-core'
import { WorkspaceManager } from '../workspace'
import type { McpConfig } from '../config'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/api-client', () => ({ createRestTxOperations: jest.fn() }))
jest.mock('@hcengineering/collaborator-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/contact', () => ({ ensureEmployee: jest.fn().mockResolvedValue('person') }))
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
  let members: Set<string>
  let manager: WorkspaceManager

  beforeEach(() => {
    jest.clearAllMocks()
    getWorkspaces.mockResolvedValue([
      { uuid: FIRST, name: 'Same name', url: 'first' },
      { uuid: SECOND, name: 'Same name', url: 'second' }
    ])
    members = new Set([FIRST, SECOND])
    selectWorkspace.mockImplementation(async (url: string) => {
      const workspaceId = url === 'first' ? FIRST : url === 'second' ? SECOND : ''
      if (!members.has(workspaceId)) throw new Error('Workspace is not accessible')
      return {
        token: JSON.stringify({ account: ACCOUNT, workspace: workspaceId }),
        workspace: workspaceId,
        workspaceName: 'Same name',
        workspaceAvailable: true,
        workspaceUrl: url,
        endpoint: `http://${url}.test`
      }
    })
    const accountClient: Partial<AccountClient> = {
      getUserWorkspaces: getWorkspaces,
      selectWorkspace,
      getPerson: jest.fn()
    }
    jest.mocked(getClient).mockReturnValue(accountClient as AccountClient)
    const account: Account = {
      uuid: ACCOUNT as AccountUuid,
      role: AccountRole.User,
      primarySocialId: 'author' as PersonId,
      socialId: 'author' as PersonId,
      socialIds: ['author' as PersonId],
      fullSocialIds: [{ _id: 'author' as PersonId, type: SocialIdType.HULY, value: ACCOUNT, key: `huly:${ACCOUNT}` }]
    }
    const operations: Partial<Awaited<ReturnType<typeof createRestTxOperations>>> = { account, close: async () => {} }
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

  it('exchanges the account token for the exact workspace URL and uses the returned endpoint', async () => {
    const first = await manager.getConnection(ACCOUNT_TOKEN, 'first')
    const second = await manager.getConnection(ACCOUNT_TOKEN, 'second')
    expect(first.workspace).toBe(FIRST)
    expect(second.workspace).toBe(SECOND)
    expect(first).not.toBe(second)
    expect(selectWorkspace).toHaveBeenNthCalledWith(1, 'first', 'byregion', [])
    expect(selectWorkspace).toHaveBeenNthCalledWith(2, 'second', 'byregion', [])
    expect(getWorkspaces).not.toHaveBeenCalled()
    expect(createRestTxOperations).toHaveBeenCalledWith('http://first.test', FIRST, first.rawToken, true)
    expect(getClient).toHaveBeenCalledWith(config.AccountsURL, ACCOUNT_TOKEN)
  })

  it('requires a workspace URL rather than the display name or UUID', async () => {
    await expect(manager.getConnection(ACCOUNT_TOKEN, 'Same name')).rejects.toThrow('not accessible')
    await expect(manager.getConnection(ACCOUNT_TOKEN, FIRST)).rejects.toThrow('not accessible')
    await expect(manager.getConnection(ACCOUNT_TOKEN, '')).rejects.toThrow('not accessible')
    expect(getWorkspaces).not.toHaveBeenCalled()
    expect(createRestTxOperations).not.toHaveBeenCalled()
  })

  it('limits discovery to the granted workspace and applies the grant before cache use', async () => {
    expect(await manager.getWorkspaces(ACCOUNT_TOKEN, FIRST)).toEqual([{ name: 'Same name', url: 'first' }])
    await manager.getConnection(ACCOUNT_TOKEN, 'second')
    await expect(manager.getConnection(ACCOUNT_TOKEN, 'second', FIRST)).rejects.toThrow('not authorized')
    expect(selectWorkspace).toHaveBeenLastCalledWith('second', 'byregion', [])
    const allowed = await manager.getConnection(ACCOUNT_TOKEN, 'first', FIRST)
    expect(allowed.workspace).toBe(FIRST)
    getWorkspaces.mockResolvedValue([{ uuid: SECOND, name: 'Same name', url: 'second' }])
    members.delete(FIRST)
    expect(await manager.getWorkspaces(ACCOUNT_TOKEN, FIRST)).toEqual([])
    await expect(manager.getConnection(ACCOUNT_TOKEN, 'first', FIRST)).rejects.toThrow('not accessible')
  })

  it('checks membership again even when a workspace connection is cached', async () => {
    await manager.getConnection(ACCOUNT_TOKEN, 'first')
    members.delete(FIRST)
    await expect(manager.getConnection(ACCOUNT_TOKEN, 'first')).rejects.toThrow('not accessible')
    expect(selectWorkspace).toHaveBeenCalledTimes(2)
    expect(getWorkspaces).not.toHaveBeenCalled()
    expect(createRestTxOperations).toHaveBeenCalledTimes(1)
  })

  it('rejects an exchange returning a different workspace or account', async () => {
    selectWorkspace.mockResolvedValue({
      workspace: SECOND,
      workspaceUrl: 'second',
      token: JSON.stringify({ account: ACCOUNT, workspace: SECOND })
    })
    await expect(manager.getConnection(ACCOUNT_TOKEN, 'first')).rejects.toThrow('exchange failed')
    selectWorkspace.mockResolvedValue({
      workspace: FIRST,
      workspaceUrl: 'first',
      token: JSON.stringify({ account: 'another-account', workspace: FIRST })
    })
    await expect(manager.getConnection(ACCOUNT_TOKEN, 'first')).rejects.toThrow('different account or workspace')
    expect(createRestTxOperations).not.toHaveBeenCalled()
  })

  it('rejects a returned workspace UUID outside the OAuth grant', async () => {
    selectWorkspace.mockResolvedValue({
      workspace: SECOND,
      workspaceUrl: 'second',
      token: JSON.stringify({ account: ACCOUNT, workspace: SECOND })
    })
    await expect(manager.getConnection(ACCOUNT_TOKEN, 'second', FIRST)).rejects.toThrow('not authorized')
    expect(createRestTxOperations).not.toHaveBeenCalled()
  })

  it('rejects a workspace marked unavailable even when its client is cached', async () => {
    const connection = await manager.getConnection(ACCOUNT_TOKEN, 'first')
    selectWorkspace.mockResolvedValue({
      workspace: FIRST,
      workspaceUrl: 'first',
      workspaceName: 'Same name',
      workspaceAvailable: false,
      token: connection.rawToken
    })
    await expect(manager.getConnection(ACCOUNT_TOKEN, 'first')).rejects.toThrow('Workspace is not available')
    expect(createRestTxOperations).toHaveBeenCalledTimes(1)
  })
})
