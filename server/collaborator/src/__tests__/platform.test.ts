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
import {
  systemAccountUuid,
  type AccountUuid,
  type Client,
  type PersonId,
  type WorkspaceUuid
} from '@hcengineering/core'
import { createClient, getTransactorEndpoint } from '@hcengineering/server-client'
import { generateToken, type Token } from '@hcengineering/server-token'
import {
  simpleClientFactory,
  reusableClientFactory,
  userClientFactory,
  type Controller,
  type WorkspaceClient
} from '../platform'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/server-client', () => ({ createClient: jest.fn(), getTransactorEndpoint: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({ generateToken: jest.fn().mockReturnValue('account-token') }))
jest.mock('../config', () => ({ AccountsUrl: 'http://accounts.test' }))

beforeEach(() => {
  jest.clearAllMocks()
})

it.each(['human-author', 'external-author'])('uses the selected %s from one account lookup', async (selected) => {
  const client: Partial<Client> = { close: jest.fn().mockResolvedValue(undefined) }
  jest.mocked(createClient).mockResolvedValue(client as Client)
  jest.mocked(getTransactorEndpoint).mockResolvedValue('http://transactor.test')
  const accountClient: Partial<AccountClient> = {
    getLoginWithWorkspaceInfo: jest.fn().mockResolvedValue({ socialId: selected, socialIds: [] })
  }
  jest.mocked(getClient).mockReturnValue(accountClient as AccountClient)
  const token: Token = {
    account: '00000000-0000-4000-8000-000000000001' as AccountUuid,
    workspace: '00000000-0000-4000-8000-000000000002' as WorkspaceUuid
  }
  const operations = await userClientFactory('workspace-token', token)()
  expect(operations.user).toBe(selected as PersonId)
  expect(accountClient.getLoginWithWorkspaceInfo).toHaveBeenCalledTimes(1)
  expect(getClient).toHaveBeenCalledWith('http://accounts.test', 'workspace-token')
  expect(generateToken).not.toHaveBeenCalled()
  await operations.close()
})

it.each(['simple', 'reusable'])('uses the original credential for account lookup with the %s factory', async (kind) => {
  const client: Partial<Client> = { close: jest.fn().mockResolvedValue(undefined) }
  jest.mocked(createClient).mockResolvedValue(client as Client)
  jest.mocked(getTransactorEndpoint).mockResolvedValue('http://transactor.test')
  const accountClient: Partial<AccountClient> = {
    getLoginWithWorkspaceInfo: jest.fn().mockResolvedValue({ socialId: 'external-author', socialIds: [] })
  }
  jest.mocked(getClient).mockReturnValue(accountClient as AccountClient)
  const token: Token = {
    account: '00000000-0000-4000-8000-000000000001' as AccountUuid,
    workspace: '00000000-0000-4000-8000-000000000002' as WorkspaceUuid,
    extra: { externalSocialId: 'external-author', externalSource: 'codex' },
    exp: 2000000000,
    nbf: 1900000000
  }
  const workspaceClient: WorkspaceClient = { workspace: token.workspace, client: client as Client, close: jest.fn() }
  const controller: Partial<Controller> = { get: jest.fn().mockResolvedValue(workspaceClient) }
  const factory =
    kind === 'simple'
      ? simpleClientFactory('original-token', token)
      : reusableClientFactory('original-token', token, controller as Controller)
  const operations = await factory()
  expect(getClient).toHaveBeenCalledWith('http://accounts.test', 'original-token')
  expect(operations.user).toBe('external-author')
  if (kind === 'simple') {
    expect(generateToken).toHaveBeenCalledTimes(1)
    expect(generateToken).toHaveBeenCalledWith(systemAccountUuid, token.workspace, { service: 'collaborator' })
  } else {
    expect(generateToken).not.toHaveBeenCalled()
  }
})
