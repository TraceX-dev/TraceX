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

import { getClient, type AccountClient, type LoginInfo } from '@hcengineering/account-client'
import {
  AccountRole,
  docGuestAccountUuid,
  readOnlyGuestAccountUuid,
  systemAccountUuid,
  type PersonId,
  type AccountUuid,
  type WorkspaceUuid
} from '@hcengineering/core'
import { NoMetricsContext } from '@hcengineering/measurements'
import { decodeToken, generateToken } from '@hcengineering/server-token'
import { authenticateOAuthSession, exchangeExternalAccess, InvalidOAuthSessionError } from '../external-token'
import type { OAuthConnection } from '../types'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))

const ctx = new NoMetricsContext()
const secret = 'issuer-to-account-test-secret'
const account = '00000000-0000-4000-8000-000000000001' as AccountUuid
const expiresAt = Math.floor(Date.now() / 1000) + 120
const notBefore = expiresAt - 130
const sessionExtra: Record<string, string> = { authMethod: 'password', readonly: 'true' }
const connection: Pick<OAuthConnection, 'id' | 'account' | 'accountToken' | 'source'> = {
  id: 'connection-1',
  account,
  accountToken: generateToken(account, undefined, sessionExtra, secret, { exp: expiresAt, nbf: notBefore }),
  source: 'Codex'
}
const login = jest.fn<
  ReturnType<AccountClient['getLoginInfoByToken']>,
  Parameters<AccountClient['getLoginInfoByToken']>
>()
const addIdentity = jest.fn<
  ReturnType<AccountClient['addSocialIdToPerson']>,
  Parameters<AccountClient['addSocialIdToPerson']>
>()

beforeEach(() => {
  jest.resetAllMocks()
  const info: LoginInfo = { account, primarySocialId: 'primary-author' as PersonId }
  login.mockResolvedValue(info)
  addIdentity.mockResolvedValue('external-author' as PersonId)
  const client: Partial<AccountClient> = { getLoginInfoByToken: login, addSocialIdToPerson: addIdentity }
  jest.mocked(getClient).mockReturnValue(client as AccountClient)
})

it('resolves an external author using short-lived service RPC credentials and preserves session restrictions', async () => {
  const result = await exchangeExternalAccess(ctx, 'https://accounts.example.test', secret, connection, expiresAt + 240)
  expect(result.expiresAt).toBe(expiresAt)
  expect(decodeToken(result.token, true, secret)).toMatchObject({
    account,
    extra: {
      ...sessionExtra,
      externalSource: 'codex',
      externalSocialId: 'external-author',
      externalConnectionId: connection.id
    },
    exp: expiresAt,
    nbf: notBefore
  })
  expect(addIdentity).toHaveBeenCalledWith(account, 'external', `${account}:codex`, true, 'codex')
  const calls = jest.mocked(getClient).mock.calls
  expect(calls[0][1]).toBe(connection.accountToken)
  const claims = decodeToken(calls[1][1] ?? '', true, secret)
  expect(claims.account).toBe(systemAccountUuid)
  expect(claims.extra?.service).toBe('openauth')
  expect(claims.workspace).toBeUndefined()
  expect(claims.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60)
})

it('caps delegation at the OAuth access expiration', async () => {
  const limit = expiresAt - 60
  const result = await exchangeExternalAccess(ctx, 'https://accounts.example.test', secret, connection, limit)
  expect(result.expiresAt).toBe(limit)
  expect(decodeToken(result.token, true, secret).exp).toBe(limit)
})

it('normalizes a workspace session for consent without extending its lifetime', async () => {
  const token = generateToken(account, '00000000-0000-4000-8000-000000000002' as WorkspaceUuid, sessionExtra, secret, {
    exp: expiresAt,
    nbf: notBefore
  })
  const result = await authenticateOAuthSession(ctx, 'https://accounts.example.test', secret, token, true)
  const claims = decodeToken(result.token, true, secret)
  expect(claims.workspace).toBeUndefined()
  expect(claims).toMatchObject({ account, extra: sessionExtra, exp: expiresAt, nbf: notBefore })
})

it.each([systemAccountUuid, readOnlyGuestAccountUuid, docGuestAccountUuid])(
  'rejects special account %s',
  async (special) => {
    const invalid = { ...connection, accountToken: generateToken(special, undefined, undefined, secret) }
    await expect(
      exchangeExternalAccess(ctx, 'https://accounts.example.test', secret, invalid, expiresAt)
    ).rejects.toThrow(InvalidOAuthSessionError)
    expect(addIdentity).not.toHaveBeenCalled()
  }
)

const restricted: Array<Record<string, string>> = [
  { apiKey: 'key' },
  { externalSocialId: 'author' },
  { service: 'tool' },
  { tfaAccount: account },
  { guest: 'true' },
  { restoreEmail: 'mail' },
  { confirmEmail: 'mail' }
]
it.each(restricted)('rejects restricted credentials %j', async (extra) => {
  const invalid = { ...connection, accountToken: generateToken(account, undefined, extra, secret) }
  await expect(
    exchangeExternalAccess(ctx, 'https://accounts.example.test', secret, invalid, expiresAt)
  ).rejects.toThrow(InvalidOAuthSessionError)
  expect(addIdentity).not.toHaveBeenCalled()
})

it.each(['expired', 'not-active', 'bad-signature', 'subject', 'grant'])('rejects a %s session', async (kind) => {
  const now = Math.floor(Date.now() / 1000)
  const token =
    kind === 'subject'
      ? generateToken(account, undefined, undefined, secret, { sub: account })
      : kind === 'grant'
        ? generateToken(account, undefined, undefined, secret, {
            exp: expiresAt,
            nbf: notBefore,
            grant: { workspace: '00000000-0000-4000-8000-000000000002' as WorkspaceUuid, role: AccountRole.User }
          })
        : generateToken(account, undefined, undefined, kind === 'bad-signature' ? 'wrong-secret' : secret, {
            exp: kind === 'expired' ? now - 60 : now + 60,
            nbf: kind === 'not-active' ? now + 30 : undefined
          })
  const invalid = { ...connection, accountToken: token }
  await expect(
    exchangeExternalAccess(ctx, 'https://accounts.example.test', secret, invalid, expiresAt)
  ).rejects.toThrow(InvalidOAuthSessionError)
  expect(addIdentity).not.toHaveBeenCalled()
})

const incomplete: Array<LoginInfo | null> = [
  null,
  { account },
  { account, tfaRequired: true },
  { account: systemAccountUuid, primarySocialId: 'primary' as PersonId }
]
it.each(incomplete)('rejects an incomplete or mismatched login %j', async (info) => {
  login.mockResolvedValue(info)
  await expect(
    exchangeExternalAccess(ctx, 'https://accounts.example.test', secret, connection, expiresAt)
  ).rejects.toThrow(InvalidOAuthSessionError)
  expect(addIdentity).not.toHaveBeenCalled()
})

it('rejects a connection belonging to a different account', async () => {
  await expect(
    exchangeExternalAccess(
      ctx,
      'https://accounts.example.test',
      secret,
      { ...connection, account: systemAccountUuid },
      expiresAt
    )
  ).rejects.toThrow(InvalidOAuthSessionError)
  expect(addIdentity).not.toHaveBeenCalled()
})

it('rejects an empty identity response', async () => {
  addIdentity.mockResolvedValue('' as PersonId)
  await expect(
    exchangeExternalAccess(ctx, 'https://accounts.example.test', secret, connection, expiresAt)
  ).rejects.toThrow('Invalid OAuth external identity response')
})

it.each(['login', 'identity'])(
  'preserves a temporary %s failure for retry without revoking the session',
  async (step) => {
    const error = new Error('Account service unavailable')
    if (step === 'login') login.mockRejectedValue(error)
    else addIdentity.mockRejectedValue(error)
    await expect(
      exchangeExternalAccess(ctx, 'https://accounts.example.test', secret, connection, expiresAt)
    ).rejects.toBe(error)
  }
)
