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
  externalIdentityValue,
  SocialIdType,
  systemAccountUuid,
  type MeasureContext,
  type PersonId
} from '@hcengineering/core'
import platform, { setMetadata, PlatformError } from '@hcengineering/platform'
import serverToken, { generateToken } from '@hcengineering/server-token'
import { addSocialIdToPerson } from '../serviceOperations'
import type { AccountDB, SocialId } from '../types'
import { account, identityDatabase } from './external-access-fixture'

const secret = 'external-identity-rpc-test-secret'
const logs: Pick<MeasureContext, 'error' | 'warn' | 'info'> = { error: jest.fn(), warn: jest.fn(), info: jest.fn() }
const ctx = logs as MeasureContext
const params: Parameters<typeof addSocialIdToPerson>[4] = {
  person: account,
  type: SocialIdType.EXTERNAL,
  value: externalIdentityValue(account, 'codex'),
  confirmed: true,
  displayValue: 'codex'
}

function database (): ReturnType<typeof identityDatabase> {
  const fixture = identityDatabase()
  const person: Partial<AccountDB['person']> = {
    findOne: jest.fn(async () => ({ uuid: account, firstName: 'Ben', lastName: 'Liden' }))
  }
  fixture.db.person = person as AccountDB['person']
  return fixture
}

beforeEach(() => {
  jest.clearAllMocks()
  setMetadata(serverToken.metadata.Secret, secret)
  setMetadata(serverToken.metadata.Service, undefined)
})

it.each(['openauth', 'tool'])('reuses an external identity through the ordinary %s service RPC', async (service) => {
  const { db, identities } = database()
  const token = generateToken(systemAccountUuid, undefined, { service }, secret)
  const first = await addSocialIdToPerson(ctx, db, null, token, params)
  const second = await addSocialIdToPerson(ctx, db, null, token, params)
  expect(second).toBe(first)
  expect(identities.size).toBe(1)
  expect(identities.get(params.value)).toMatchObject({
    personUuid: account,
    type: SocialIdType.EXTERNAL,
    displayValue: 'codex',
    verifiedOn: expect.any(Number)
  })
})

it.each(['openauth', 'tool'])('preserves verified identity ownership for %s', async (service) => {
  const { db, identities } = database()
  const identity: SocialId = {
    _id: 'external-author' as PersonId,
    key: `external:${params.value}`,
    type: SocialIdType.EXTERNAL,
    value: params.value,
    personUuid: systemAccountUuid,
    verifiedOn: Date.now()
  }
  identities.set(identity.value, identity)
  const token = generateToken(systemAccountUuid, undefined, { service }, secret)
  const result = addSocialIdToPerson(ctx, db, null, token, params)
  await expect(result).rejects.toBeInstanceOf(PlatformError)
  await expect(result).rejects.toMatchObject({ status: { code: platform.status.SocialIdAlreadyExists } })
  expect(identities.get(identity.value)?.personUuid).toBe(systemAccountUuid)
})

it('rejects an ordinary user attempting to create an external identity', async () => {
  const { db, identities } = database()
  const token = generateToken(account, undefined, undefined, secret)
  await expect(addSocialIdToPerson(ctx, db, null, token, params)).rejects.toMatchObject({
    status: { code: platform.status.Forbidden }
  })
  expect(identities.size).toBe(0)
})
