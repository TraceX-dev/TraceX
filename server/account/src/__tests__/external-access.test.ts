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

import { setMetadata } from '@hcengineering/platform'
import serverToken, { decodeToken } from '@hcengineering/server-token'
import { issueExternalAccess } from '../external-access'
import { account, identityDatabase } from './external-access-fixture'

beforeEach(() => {
  setMetadata(serverToken.metadata.Secret, 'external-access-test-secret')
  setMetadata(serverToken.metadata.Service, undefined)
})

it('reuses the user/source identity across independent OAuth connections', async () => {
  const { db, identities } = identityDatabase()
  const first = decodeToken(
    (
      await issueExternalAccess(db, account, 'Codex', {
        connectionId: 'connection-1',
        session: {}
      })
    ).token
  )
  const second = decodeToken(
    (
      await issueExternalAccess(db, account, 'codex', {
        connectionId: 'connection-2',
        session: {}
      })
    ).token
  )
  expect(identities.size).toBe(1)
  expect(first.account).toBe(account)
  expect(second.account).toBe(account)
  expect(first.extra?.externalSocialId).toBe(second.extra?.externalSocialId)
  expect(first.extra?.externalConnectionId).not.toBe(second.extra?.externalConnectionId)
  expect(first.extra?.apiKey).toBeUndefined()
  expect(first.workspace).toBeUndefined()
})

it('preserves the user session lifetime and restrictions during OAuth exchange', async () => {
  const { db } = identityDatabase()
  const now = Math.floor(Date.now() / 1000)
  const issued = await issueExternalAccess(db, account, 'Claude', {
    connectionId: 'connection-1',
    session: { exp: now + 120, nbf: now - 10, extra: { readonly: 'true' } }
  })
  const decoded = decodeToken(issued.token)
  expect(decoded.exp).toBe(now + 120)
  expect(decoded.nbf).toBe(now - 10)
  expect(decoded.extra?.readonly).toBe('true')
  expect(decoded.extra?.externalSource).toBe('claude')
  expect(decoded.extra?.apiKey).toBeUndefined()
})

it('rejects an invalid source before creating an identity or token', async () => {
  const { db, identities } = identityDatabase()
  await expect(
    issueExternalAccess(db, account, 'invalid:source', {
      connectionId: 'connection-1',
      session: {}
    })
  ).rejects.toThrow('External source')
  expect(identities.size).toBe(0)
})
