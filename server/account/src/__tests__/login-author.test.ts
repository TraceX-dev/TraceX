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

import { NoMetricsContext, SocialIdType, type PersonId, type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverToken, { generateToken } from '@hcengineering/server-token'
import { getLoginWithWorkspaceInfo } from '../operations'
import { accountPlugin } from '../plugin'
import type { AccountDB, ApiKey, SocialId } from '../types'
import { account, identityDatabase } from './external-access-fixture'

const workspace = 'a8a3cc87-17ad-4f38-9008-6388ab1d36ee' as WorkspaceUuid
const emailId = 'email-author' as PersonId
const humanId = 'human-author' as PersonId
const externalId = 'external-author' as PersonId
const ctx = new NoMetricsContext()

function fixture (): AccountDB {
  const { db, identities } = identityDatabase()
  const socialIds: SocialId[] = [
    {
      _id: emailId,
      type: SocialIdType.EMAIL,
      value: 'ben@example.test',
      key: 'email:ben@example.test',
      personUuid: account,
      verifiedOn: 1
    },
    {
      _id: humanId,
      type: SocialIdType.HULY,
      value: account,
      key: `huly:${account}`,
      personUuid: account,
      verifiedOn: 1
    },
    {
      _id: externalId,
      type: SocialIdType.EXTERNAL,
      value: `${account}:codex`,
      key: `external:${account}:codex`,
      personUuid: account,
      verifiedOn: 1
    }
  ]
  for (const identity of socialIds) identities.set(identity.value, identity)
  db.socialId.find = jest.fn().mockImplementation(async () => [...identities.values()])
  const personCollection: Partial<AccountDB['person']> = {
    findOne: jest.fn().mockResolvedValue({ uuid: account, firstName: 'Ben', lastName: 'Liden' })
  }
  db.person = personCollection as AccountDB['person']
  db.getAccountWorkspaces = jest.fn().mockResolvedValue([])
  db.getWorkspaceRoles = jest.fn().mockResolvedValue(new Map())
  const apiKey: ApiKey = {
    id: 'key-1',
    name: 'Codex',
    source: 'codex',
    accountUuid: account,
    workspaceUuid: workspace,
    createdOn: 1
  }
  const apiKeys: Partial<AccountDB['apiKey']> = { findOne: jest.fn().mockResolvedValue(apiKey) }
  db.apiKey = apiKeys as AccountDB['apiKey']
  return db
}

beforeEach(() => {
  setMetadata(serverToken.metadata.Secret, 'login-author-test-secret')
  setMetadata(serverToken.metadata.Service, undefined)
  setMetadata(accountPlugin.metadata.Transactors, 'http://transactor.test;http://transactor.test;')
})

it('chooses the normal primary identity rather than the first returned identity', async () => {
  const login = await getLoginWithWorkspaceInfo(ctx, fixture(), null, generateToken(account, workspace))
  expect(login.socialId).toBe(humanId)
  expect(login.primarySocialId).toBe(humanId)
})

it('returns the credential-bound external identity even when the user has a normal primary identity', async () => {
  const login = await getLoginWithWorkspaceInfo(
    ctx,
    fixture(),
    null,
    generateToken(account, workspace, {
      externalSocialId: externalId,
      externalSource: 'codex'
    })
  )
  expect(login.socialId).toBe(externalId)
  expect(login.primarySocialId).toBe(humanId)
})

it('uses one validated API key lookup to resolve the author', async () => {
  const db = fixture()
  const login = await getLoginWithWorkspaceInfo(ctx, db, null, generateToken(account, workspace, { apiKey: 'key-1' }))
  expect(login.socialId).toBe(externalId)
  expect(login.primarySocialId).toBe(humanId)
  expect(db.apiKey.findOne).toHaveBeenCalledTimes(1)
})

it('rejects a revoked API key before selecting an author', async () => {
  const db = fixture()
  jest.mocked(db.apiKey.findOne).mockResolvedValue(null)
  await expect(
    getLoginWithWorkspaceInfo(ctx, db, null, generateToken(account, workspace, { apiKey: 'key-1' }))
  ).rejects.toThrow()
  expect(db.socialId.find).not.toHaveBeenCalled()
})
