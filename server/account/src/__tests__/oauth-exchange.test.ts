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

import { systemAccountUuid, type MeasureContext } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverToken, { decodeToken, generateToken } from '@hcengineering/server-token'
import { getLoginInfoByToken } from '../operations'
import { exchangeOAuthToken } from '../oauth-exchange'
import { account, identityDatabase } from './external-access-fixture'

jest.mock('../operations', () => ({ getLoginInfoByToken: jest.fn() }))

const secret = 'oauth-exchange-test-secret'
const logs: Pick<MeasureContext, 'error' | 'warn' | 'info'> = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
const ctx = logs as MeasureContext
const login = jest.mocked(getLoginInfoByToken)

function issuerToken (service = 'openauth', lifetime = 60): string {
  return generateToken(systemAccountUuid, undefined, { service }, secret, {
    exp: Math.floor(Date.now() / 1000) + lifetime
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  setMetadata(serverToken.metadata.Secret, secret)
  setMetadata(serverToken.metadata.Service, undefined)
  login.mockResolvedValue({ account, token: 'verified-user-session' })
})

it('exchanges only after verifying the issuer and the complete user session', async () => {
  const { db } = identityDatabase()
  const token = generateToken(account, undefined, undefined, secret)
  const result = await exchangeOAuthToken(ctx, db, null, issuerToken(), {
    accountToken: token,
    source: 'Codex',
    connectionId: 'connection-1'
  })
  expect(login).toHaveBeenCalledWith(ctx, db, null, token)
  expect(decodeToken(result)).toMatchObject({
    account,
    extra: { externalSource: 'codex', externalConnectionId: 'connection-1' }
  })
})

it.each(['user', 'wrong-service', 'long-lived', 'expired', 'missing-expiry'])(
  'rejects %s issuer credentials before accessing the user session',
  async (kind) => {
    const { db, identities } = identityDatabase()
    const service =
      kind === 'user'
        ? generateToken(account, undefined, undefined, secret)
        : kind === 'missing-expiry'
          ? generateToken(systemAccountUuid, undefined, { service: 'openauth' }, secret)
          : issuerToken(
              kind === 'wrong-service' ? 'mcp-oauth' : 'openauth',
              kind === 'long-lived' ? 3600 : kind === 'expired' ? -10 : 60
            )
    await expect(
      exchangeOAuthToken(ctx, db, null, service, {
        accountToken: generateToken(account, undefined, undefined, secret),
        source: 'codex',
        connectionId: 'connection-1'
      })
    ).rejects.toThrow()
    expect(login).not.toHaveBeenCalled()
    expect(identities.size).toBe(0)
  }
)

const restrictedCredentials: Array<Record<string, string>> = [
  { apiKey: 'key-1' },
  { externalSocialId: 'identity-1' },
  { tfaAccount: account },
  { service: 'tool' }
]
it.each(restrictedCredentials)('refuses to exchange a restricted user credential %j', async (extra) => {
  const { db, identities } = identityDatabase()
  await expect(
    exchangeOAuthToken(ctx, db, null, issuerToken(), {
      accountToken: generateToken(account, undefined, extra, secret),
      source: 'codex',
      connectionId: 'connection-1'
    })
  ).rejects.toThrow()
  expect(login).not.toHaveBeenCalled()
  expect(identities.size).toBe(0)
})

it('refuses an incomplete user login', async () => {
  const { db, identities } = identityDatabase()
  login.mockResolvedValue({ account, tfaRequired: true })
  await expect(
    exchangeOAuthToken(ctx, db, null, issuerToken(), {
      accountToken: generateToken(account, undefined, undefined, secret),
      source: 'codex',
      connectionId: 'connection-1'
    })
  ).rejects.toThrow()
  expect(identities.size).toBe(0)
})
