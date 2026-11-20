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

import { AccountRole, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverToken, { decodeToken, generateToken } from '@hcengineering/server-token'
import { getMethods } from '../operations'
import type { AccountDB } from '../types'
import { account, identityDatabase } from './external-access-fixture'

jest.mock('../audit', () => ({ auditAccountEvent: jest.fn() }))

const workspace = 'a8a3cc87-17ad-4f38-9008-6388ab1d36ee' as WorkspaceUuid
const logs: Pick<MeasureContext, 'error' | 'warn' | 'info'> = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
const ctx = logs as MeasureContext

beforeEach(() => {
  setMetadata(serverToken.metadata.Secret, 'ui-api-key-test-secret')
  setMetadata(serverToken.metadata.Service, undefined)
})

it('issues a workspace-settings key as external access with source api by default', async () => {
  const { db } = identityDatabase()
  db.getWorkspaceRole = jest.fn().mockResolvedValue(AccountRole.User)
  const apiKeyCollection: Partial<AccountDB['apiKey']> = { insertOne: jest.fn() }
  db.apiKey = apiKeyCollection as AccountDB['apiKey']
  const handler = getMethods().createApiKey
  if (handler === undefined) throw new Error('Missing API key operation')
  const response = await handler(
    ctx,
    db,
    null,
    { id: 1, method: 'createApiKey', params: { name: 'Automation' } },
    generateToken(account, workspace)
  )
  expect(response.error).toBeUndefined()
  const issued = decodeToken(response.result.key)
  expect(issued).toMatchObject({ account, workspace, extra: { externalSource: 'api', externalSocialId: 'external-1' } })
  expect(issued.extra?.externalConnectionId).toBeUndefined()
  expect(apiKeyCollection.insertOne).toHaveBeenCalledWith(
    expect.objectContaining({
      id: issued.extra?.apiKey,
      source: 'api',
      accountUuid: account,
      workspaceUuid: workspace
    })
  )
})

it('does not expose token exchange as a user account RPC', () => {
  const methods = getMethods()
  expect(methods).not.toHaveProperty('createExternalToken')
  expect(methods).not.toHaveProperty('exchangeOAuthToken')
})
