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

import { AccountRole, NoMetricsContext, SocialIdType, type PersonId, type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverToken, { decodeToken, generateToken } from '@hcengineering/server-token'
import { getLoginInfoByToken, getLoginWithWorkspaceInfo } from '../operations'
import { accountPlugin } from '../plugin'
import type { AccountDB, ApiKey, SocialId } from '../types'
import { account, identityDatabase } from './external-access-fixture'
import { selectWorkspace } from '../utils'

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
  db.getWorkspaceRole = jest.fn().mockResolvedValue(AccountRole.User)
  const workspaceCollection: Partial<AccountDB['workspace']> = {
    findOne: jest.fn().mockResolvedValue({ uuid: workspace, url: 'ws1', name: 'Workspace 1' })
  }
  db.workspace = workspaceCollection as AccountDB['workspace']
  const accountCollection: Partial<AccountDB['account']> = { findOne: jest.fn().mockResolvedValue({ uuid: account }) }
  db.account = accountCollection as AccountDB['account']
  const statusCollection: Partial<AccountDB['workspaceStatus']> = { findOne: jest.fn().mockResolvedValue(null) }
  db.workspaceStatus = statusCollection as AccountDB['workspaceStatus']
  const apiKey: ApiKey = {
    id: 'key-1',
    name: 'Codex',
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

it('preserves the first ordinary social identity while selecting the primary identity separately', async () => {
  const login = await getLoginWithWorkspaceInfo(ctx, fixture(), null, generateToken(account, workspace))
  expect(login.socialId).toBe(emailId)
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

it('preserves the ordinary API key author', async () => {
  const db = fixture()
  const login = await getLoginWithWorkspaceInfo(ctx, db, null, generateToken(account, workspace, { apiKey: 'key-1' }))
  expect(login.socialId).toBe(emailId)
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

it.each([false, true])('returns personal and acting identities (API key: %s)', async (apiKey) => {
  const db = fixture()
  const token = generateToken(account, workspace, apiKey ? { apiKey: 'key-1' } : undefined)
  const login = await getLoginInfoByToken(ctx, db, null, token)
  expect(login).toMatchObject({ primarySocialId: humanId, socialId: emailId })
  if (apiKey) expect(db.apiKey.findOne).toHaveBeenCalledTimes(1)
})

it('validates an external OAuth author in the lightweight login response', async () => {
  const db = fixture()
  const login = await getLoginInfoByToken(
    ctx,
    db,
    null,
    generateToken(account, workspace, {
      externalSocialId: externalId,
      externalSource: 'codex'
    })
  )
  expect(login).toMatchObject({ primarySocialId: humanId, socialId: externalId })
})

it('can validate a session without issuing a new login token', async () => {
  const token = generateToken(account)
  const login = await getLoginInfoByToken(ctx, fixture(), null, token, undefined, undefined, false)
  expect(login).toMatchObject({ account, primarySocialId: humanId })
  expect(login).not.toHaveProperty('token')
})

it.each([getLoginInfoByToken, getLoginWithWorkspaceInfo])(
  'ignores external fields on previously issued API keys (%p)',
  async (method) => {
    const db = fixture()
    const login = await method(
      ctx,
      db,
      null,
      generateToken(account, workspace, {
        apiKey: 'key-1',
        externalSocialId: externalId,
        externalSource: 'codex'
      })
    )
    expect(login).toMatchObject({ primarySocialId: humanId, socialId: emailId })
  }
)

it.each([false, true])(
  'selects a workspace for an API key without creating an external author (external fields: %s)',
  async (hasExternalFields) => {
    const db = fixture()
    const extra: Record<string, string> = {
      apiKey: 'key-1',
      ...(hasExternalFields ? { externalSocialId: externalId, externalSource: 'codex' } : {})
    }
    const login = await selectWorkspace(ctx, db, null, generateToken(account, workspace, extra), {
      workspaceUrl: 'ws1',
      kind: 'external'
    })
    if (login.token === undefined) throw new Error('Missing workspace token')
    expect(login.socialId).toBeUndefined()
    expect(decodeToken(login.token).extra?.apiKey).toBe('key-1')
    expect(db.socialId.insertOne).not.toHaveBeenCalled()
  }
)

it.each([getLoginInfoByToken, getLoginWithWorkspaceInfo])(
  'does not select an external identity for ordinary access (%p)',
  async (method) => {
    const db = fixture()
    const identities = await db.socialId.find({ personUuid: account })
    jest
      .mocked(db.socialId.find)
      .mockResolvedValue([
        ...identities.filter((identity) => identity.type === SocialIdType.EXTERNAL),
        ...identities.filter((identity) => identity.type !== SocialIdType.EXTERNAL)
      ])
    const login = await method(ctx, db, null, generateToken(account, workspace))
    expect(login).toMatchObject({ primarySocialId: humanId, socialId: emailId })
  }
)

it('rejects an external identity that is not present for the claimed source', async () => {
  await expect(
    getLoginInfoByToken(
      ctx,
      fixture(),
      null,
      generateToken(account, workspace, {
        externalSocialId: externalId,
        externalSource: 'claude'
      })
    )
  ).rejects.toThrow()
})

it('continues to reject revoked keys and removed workspace memberships', async () => {
  const revoked = fixture()
  jest.mocked(revoked.apiKey.findOne).mockResolvedValue(null)
  await expect(
    getLoginInfoByToken(ctx, revoked, null, generateToken(account, workspace, { apiKey: 'key-1' }))
  ).rejects.toThrow()
  const removed = fixture()
  jest.mocked(removed.getWorkspaceRole).mockResolvedValue(null)
  await expect(
    getLoginInfoByToken(ctx, removed, null, generateToken(account, workspace, { apiKey: 'key-1' }))
  ).rejects.toThrow()
})
