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
  SocialIdType,
  systemAccountUuid,
  type MeasureContext,
  type PersonId,
  type IntegrationKind
} from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverToken, { decodeToken, generateToken } from '@hcengineering/server-token'
import { refreshHulyAssistantToken } from '../operations'
import { exchangeOAuthToken } from '../oauth-exchange'
import type { AccountDB, IntegrationSecret, SocialId } from '../types'
import { account, identityDatabase } from './external-access-fixture'

jest.mock('../audit', () => ({ auditAccountEvent: jest.fn() }))

const logs: Pick<MeasureContext, 'error' | 'warn' | 'info'> = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
const ctx = logs as MeasureContext
const assistant: SocialId = {
  _id: 'assistant-integration' as PersonId,
  type: SocialIdType.HULY_ASSISTANT,
  value: account,
  key: `huly-assistant:${account}`,
  personUuid: account,
  verifiedOn: 1
}
const storedSecret: IntegrationSecret = {
  socialId: assistant._id,
  kind: 'ai-assistant' as IntegrationKind,
  workspaceUuid: null,
  key: 'access_token',
  secret: 'previous-token'
}

function assistantDatabase (existing: boolean): ReturnType<typeof identityDatabase> {
  const fixture = identityDatabase()
  const findIdentity = fixture.db.socialId.findOne
  fixture.db.socialId.findOne = jest.fn(async (query) =>
    query.type === SocialIdType.HULY_ASSISTANT ? assistant : await findIdentity(query)
  )
  const integrationSecret: Partial<AccountDB['integrationSecret']> = {
    findOne: jest.fn().mockResolvedValue(existing ? storedSecret : null),
    insertOne: jest.fn(),
    update: jest.fn()
  }
  fixture.db.integrationSecret = integrationSecret as AccountDB['integrationSecret']
  return fixture
}

beforeEach(() => {
  setMetadata(serverToken.metadata.Secret, 'assistant-token-test-secret')
  setMetadata(serverToken.metadata.Service, undefined)
})

it.each([false, true])('issues an external assistant token when an integration secret exists: %s', async (existing) => {
  const { db, identities } = assistantDatabase(existing)
  const now = Math.floor(Date.now() / 1000)
  const session = generateToken(account, undefined, undefined, undefined, { exp: now + 120, nbf: now - 10 })
  await refreshHulyAssistantToken(ctx, db, null, session)
  const insert = jest.mocked(db.integrationSecret.insertOne)
  const update = jest.mocked(db.integrationSecret.update)
  const token = existing ? update.mock.calls[0][1].secret : insert.mock.calls[0][0].secret
  expect(typeof token).toBe('string')
  const decoded = decodeToken(String(token))
  expect(decoded.account).toBe(account)
  expect(decoded.workspace).toBeUndefined()
  expect(decoded.exp).toBe(now + 120)
  expect(decoded.nbf).toBe(now - 10)
  expect(decoded.extra).toEqual({ externalSource: 'ai-assistant', externalSocialId: 'external-1' })
  expect(identities.size).toBe(1)
  if (existing) {
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ socialId: assistant._id, kind: 'ai-assistant' }), {
      secret: token
    })
    expect(insert).not.toHaveBeenCalled()
  } else {
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ socialId: assistant._id, kind: 'ai-assistant', secret: token })
    )
    expect(update).not.toHaveBeenCalled()
  }
})

it('reuses the assistant author identity when the secret is refreshed', async () => {
  const { db, identities } = assistantDatabase(true)
  const session = generateToken(account)
  await refreshHulyAssistantToken(ctx, db, null, session)
  await refreshHulyAssistantToken(ctx, db, null, session)
  expect(identities.size).toBe(1)
  expect(db.integrationSecret.update).toHaveBeenCalledTimes(2)
})

it('prevents an external credential from issuing a new assistant credential', async () => {
  const { db, identities } = assistantDatabase(false)
  const externalToken = generateToken(account, undefined, {
    externalSource: 'codex',
    externalSocialId: 'external-codex'
  })
  await expect(refreshHulyAssistantToken(ctx, db, null, externalToken)).rejects.toThrow()
  expect(identities.size).toBe(0)
  expect(db.integrationSecret.insertOne).not.toHaveBeenCalled()
})

it('refuses to use an assistant token as an ordinary session in the OAuth exchange', async () => {
  const { db } = assistantDatabase(false)
  await refreshHulyAssistantToken(ctx, db, null, generateToken(account))
  const token = jest.mocked(db.integrationSecret.insertOne).mock.calls[0][0].secret
  const issuer = generateToken(systemAccountUuid, undefined, { service: 'openauth' }, undefined, {
    exp: Math.floor(Date.now() / 1000) + 60
  })
  await expect(
    exchangeOAuthToken(ctx, db, null, issuer, {
      accountToken: String(token),
      source: 'codex',
      connectionId: 'connection-1'
    })
  ).rejects.toThrow()
})
