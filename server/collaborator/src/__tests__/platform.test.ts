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
import { type AccountUuid, type Client, type PersonId, type WorkspaceUuid } from '@hcengineering/core'
import { createClient, getTransactorEndpoint } from '@hcengineering/server-client'
import type { Token } from '@hcengineering/server-token'
import { userClientFactory } from '../platform'

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
  await operations.close()
})
