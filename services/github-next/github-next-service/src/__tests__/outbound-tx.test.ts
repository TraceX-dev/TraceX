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

import {
  getClient as getAccountClient,
  type AccountClient,
  type Integration,
  type WorkspaceLoginInfo
} from '@hcengineering/account-client'
import { createMarkupOperations, createRestTxOperations, type MarkupOperations } from '@hcengineering/api-client'
import { getClient as getCollaboratorClient, type CollaboratorClient } from '@hcengineering/collaborator-client'
import core, {
  AccountRole,
  MeasureMetricsContext,
  systemAccountUuid,
  TxFactory,
  type Class,
  type Client,
  type Data,
  type Doc,
  type DocumentUpdate,
  type PersonId,
  type Ref,
  type TxOperations,
  type WorkspaceUuid
} from '@hcengineering/core'
import githubNext, { githubNextIntegrationKind, type GithubNextObjectSyncState } from '@hcengineering/github-next'
import integration from '@hcengineering/integration'
import setting, { type Integration as WorkspaceIntegration } from '@hcengineering/setting'
import {
  clearGithubNextWorkspaceClients,
  invalidateGithubNextWorkspaceClient,
  isGithubNextOutboundRelevantTx,
  syncGithubNextWorkspace,
  syncGithubNextDiscussions,
  syncGithubNextPullRequests,
  syncGithubNextOutboundIssues,
  syncGithubNextOutboundDiscussions,
  syncGithubNextOutboundPullRequests
} from '../index'

jest.mock('../config', () => {
  const config: Record<string, string> = {
    AccountsURL: 'http://accounts',
    FrontURL: 'http://front',
    CollaboratorURL: 'http://collaborator'
  }
  return config
})
jest.mock('@hcengineering/account-client', () => {
  const mock: Partial<typeof import('@hcengineering/account-client')> = { getClient: jest.fn() }
  return mock
})
jest.mock('@hcengineering/api-client', () => {
  const mock: Partial<typeof import('@hcengineering/api-client')> = {
    createMarkupOperations: jest.fn(),
    createRestTxOperations: jest.fn()
  }
  return mock
})
jest.mock('@hcengineering/collaborator-client', () => {
  const mock: Partial<typeof import('@hcengineering/collaborator-client')> = { getClient: jest.fn() }
  return mock
})
jest.mock('@hcengineering/server-token', () => {
  const mock: Partial<typeof import('@hcengineering/server-token')> = { generateToken: jest.fn(() => 'service-token') }
  return mock
})

describe('outbound transaction client reuse', () => {
  const accountsUrl = 'http://accounts'
  const workspace = 'workspace-a' as WorkspaceUuid
  const accountIntegration: Integration = {
    socialId: core.account.System,
    kind: githubNextIntegrationKind,
    workspaceUuid: workspace
  }
  const workspaceIntegration: Pick<WorkspaceIntegration, '_id'> = { _id: 'integration' as Ref<WorkspaceIntegration> }
  const operations: DocumentUpdate<Doc> = {}
  const tx = new TxFactory('user' as PersonId).createTxUpdateDoc(
    core.class.Doc,
    core.space.Workspace,
    'document' as Ref<Doc>,
    operations
  )
  const findOne = jest.fn()
  const account: Pick<AccountClient, 'getLoginInfoByToken' | 'listIntegrations'> = {
    getLoginInfoByToken: jest.fn(),
    listIntegrations: jest.fn()
  }

  beforeEach(() => {
    jest.clearAllMocks()
    const loginInfo: WorkspaceLoginInfo = {
      account: systemAccountUuid,
      workspace,
      workspaceUrl: 'test-workspace',
      endpoint: 'http://transactor',
      token: 'workspace-token',
      role: AccountRole.Owner
    }
    const client: Pick<Client, 'findOne'> = { findOne }
    const restOperations: Pick<TxOperations, 'client' | 'user'> = {
      client: client as Client,
      user: core.account.System
    }
    const markup: MarkupOperations = {
      fetchMarkup: jest.fn(),
      uploadMarkup: jest.fn()
    }
    const collaborator: Partial<CollaboratorClient> = {}
    jest.mocked(getAccountClient).mockReturnValue(account as AccountClient)
    jest.mocked(account.listIntegrations).mockResolvedValue([accountIntegration])
    jest.mocked(account.getLoginInfoByToken).mockResolvedValue(loginInfo)
    jest.mocked(createRestTxOperations).mockResolvedValue(restOperations as TxOperations)
    jest.mocked(createMarkupOperations).mockReturnValue(markup)
    jest.mocked(getCollaboratorClient).mockReturnValue(collaborator as CollaboratorClient)
    findOne.mockImplementation(async (objectClass: Ref<Class<Doc>>) =>
      objectClass === setting.class.Integration ? workspaceIntegration : undefined
    )
    jest.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    clearGithubNextWorkspaceClients()
    jest.restoreAllMocks()
  })

  it('loads the model once and avoids provider queries for unrelated updates', async () => {
    for (let message = 0; message < 20; message++) {
      expect(await isGithubNextOutboundRelevantTx(accountsUrl, workspace, tx)).toBe(false)
    }
    expect(createRestTxOperations).toHaveBeenCalledTimes(1)
    expect(account.getLoginInfoByToken).toHaveBeenCalledTimes(1)
    expect(findOne).toHaveBeenCalledTimes(40)
    expect(
      findOne.mock.calls.every(
        ([objectClass]) =>
          objectClass === setting.class.Integration || objectClass === githubNext.class.GithubNextObjectSyncState
      )
    ).toBe(true)
  })

  it('reloads the model after workspace invalidation', async () => {
    await isGithubNextOutboundRelevantTx(accountsUrl, workspace, tx)
    invalidateGithubNextWorkspaceClient(accountsUrl, workspace)
    await isGithubNextOutboundRelevantTx(accountsUrl, workspace, tx)
    expect(createRestTxOperations).toHaveBeenCalledTimes(2)
  })

  it('shares the client across inbound, outbound and transaction checks', async () => {
    const ctx = new MeasureMetricsContext('test', {})
    await isGithubNextOutboundRelevantTx(accountsUrl, workspace, tx)
    for (const sync of [
      syncGithubNextWorkspace,
      syncGithubNextDiscussions,
      syncGithubNextPullRequests,
      syncGithubNextOutboundIssues,
      syncGithubNextOutboundDiscussions,
      syncGithubNextOutboundPullRequests
    ]) {
      await sync(ctx, accountsUrl, workspace)
    }
    expect(createRestTxOperations).toHaveBeenCalledTimes(1)
    expect(account.getLoginInfoByToken).toHaveBeenCalledTimes(1)
  })

  it('continues accepting updates to already synced objects', async () => {
    const state: Pick<GithubNextObjectSyncState, '_id'> = { _id: 'state' as Ref<GithubNextObjectSyncState> }
    findOne.mockImplementation(async (objectClass: Ref<Class<Doc>>) =>
      objectClass === setting.class.Integration ? workspaceIntegration : state
    )
    expect(await isGithubNextOutboundRelevantTx(accountsUrl, workspace, tx)).toBe(true)
  })

  it('still evaluates create routes for objects without sync states', async () => {
    const attributes: Data<Doc> = {}
    const createTx = new TxFactory('user' as PersonId).createTxCreateDoc(
      core.class.Doc,
      core.space.Workspace,
      attributes
    )
    expect(await isGithubNextOutboundRelevantTx(accountsUrl, workspace, createTx)).toBe(false)
    expect(
      findOne.mock.calls.filter(([objectClass]) => objectClass === integration.class.IntegrationSlotProvider)
    ).toHaveLength(3)
  })

  it('reads current integration configuration on every check', async () => {
    await isGithubNextOutboundRelevantTx(accountsUrl, workspace, tx)
    findOne.mockResolvedValue(undefined)
    expect(await isGithubNextOutboundRelevantTx(accountsUrl, workspace, tx)).toBe(false)
    expect(findOne).toHaveBeenCalledTimes(3)
    expect(createRestTxOperations).toHaveBeenCalledTimes(1)
  })

  it('evicts a failed context and retries with a fresh model', async () => {
    const error = new Error('Transactor restarted')
    findOne.mockRejectedValueOnce(error)
    await expect(isGithubNextOutboundRelevantTx(accountsUrl, workspace, tx)).rejects.toBe(error)
    expect(await isGithubNextOutboundRelevantTx(accountsUrl, workspace, tx)).toBe(false)
    expect(createRestTxOperations).toHaveBeenCalledTimes(2)
  })
})
