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
  AccountRole,
  externalIdentityValue,
  SocialIdType,
  systemAccountUuid,
  type MeasureContext,
  type PersonId,
  type WorkspaceUuid
} from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverToken, { generateToken } from '@hcengineering/server-token'
import { addSocialIdToPerson } from '../serviceOperations'
import type { SocialId } from '../types'
import { account, identityDatabase } from './external-access-fixture'

const secret = 'external-identity-rpc-test-secret'
const logs: Pick<MeasureContext, 'error' | 'warn' | 'info'> = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
const ctx = logs as MeasureContext
const params = {
  person: account,
  type: SocialIdType.EXTERNAL,
  value: externalIdentityValue(account, 'codex'),
  confirmed: true
}

function issuerToken (service = 'openauth', lifetime = 60): string {
  return generateToken(systemAccountUuid, undefined, { service }, secret, {
    exp: Math.floor(Date.now() / 1000) + lifetime
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  setMetadata(serverToken.metadata.Secret, secret)
  setMetadata(serverToken.metadata.Service, undefined)
})

it('resolves one stable external identity through the service RPC', async () => {
  const { db, identities } = identityDatabase()
  const first = await addSocialIdToPerson(ctx, db, null, issuerToken(), params)
  const second = await addSocialIdToPerson(ctx, db, null, issuerToken(), params)
  expect(second).toBe(first)
  expect(identities.size).toBe(1)
  expect(identities.get(params.value)).toMatchObject({
    personUuid: account,
    type: SocialIdType.EXTERNAL,
    displayValue: 'codex'
  })
})

it.each(['user', 'long-lived', 'expired', 'missing-expiry', 'workspace', 'subject', 'grant'])(
  'rejects %s OpenAuth issuer credentials',
  async (kind) => {
    const { db, identities } = identityDatabase()
    const options = { exp: Math.floor(Date.now() / 1000) + 60 }
    const token =
      kind === 'user'
        ? generateToken(account, undefined, { service: 'openauth' }, secret, options)
        : kind === 'missing-expiry'
          ? generateToken(systemAccountUuid, undefined, { service: 'openauth' }, secret)
          : kind === 'workspace'
            ? generateToken(
                systemAccountUuid,
                '00000000-0000-4000-8000-000000000002' as WorkspaceUuid,
                { service: 'openauth' },
                secret,
                options
              )
            : kind === 'subject'
              ? generateToken(systemAccountUuid, undefined, { service: 'openauth' }, secret, {
                  ...options,
                  sub: account
                })
              : kind === 'grant'
                ? generateToken(systemAccountUuid, undefined, { service: 'openauth' }, secret, {
                    ...options,
                    nbf: Math.floor(Date.now() / 1000) - 1,
                    grant: {
                      workspace: '00000000-0000-4000-8000-000000000002' as WorkspaceUuid,
                      role: AccountRole.User
                    }
                  })
                : issuerToken('openauth', kind === 'long-lived' ? 3600 : -10)
    await expect(addSocialIdToPerson(ctx, db, null, token, params)).rejects.toThrow()
    expect(identities.size).toBe(0)
  }
)

it.each([
  { ...params, type: SocialIdType.EMAIL },
  { ...params, confirmed: false },
  { ...params, value: 'another-account:codex' },
  { ...params, value: `${account}:Codex` },
  { ...params, displayValue: 'claude' },
  { ...params, value: `${account}:invalid source` }
])('limits OpenAuth to confirmed canonical external identities %j', async (input) => {
  const { db, identities } = identityDatabase()
  await expect(addSocialIdToPerson(ctx, db, null, issuerToken(), input)).rejects.toThrow()
  expect(identities.size).toBe(0)
})

it.each(['owner', 'deleted', 'unverified'])('rejects a conflicting %s identity', async (kind) => {
  const { db, identities } = identityDatabase()
  const identity: SocialId = {
    _id: 'external-author' as PersonId,
    key: `external:${params.value}`,
    type: SocialIdType.EXTERNAL,
    value: params.value,
    personUuid: kind === 'owner' ? systemAccountUuid : account,
    isDeleted: kind === 'deleted',
    verifiedOn: kind === 'unverified' ? undefined : Date.now()
  }
  identities.set(identity.value, identity)
  await expect(addSocialIdToPerson(ctx, db, null, issuerToken(), params)).rejects.toThrow()
})

it('resolves the identity created by a competing request', async () => {
  const { db, identities } = identityDatabase()
  const insert = db.socialId.insertOne.bind(db.socialId)
  jest.spyOn(db.socialId, 'insertOne').mockImplementationOnce(async (data) => {
    await insert(data)
    throw new Error('Unique identity conflict')
  })
  const id = await addSocialIdToPerson(ctx, db, null, issuerToken(), params)
  expect(id).toBe(identities.get(params.value)?._id)
  expect(identities.size).toBe(1)
})
