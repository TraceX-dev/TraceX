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

import { type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverToken, { decodeToken } from '@hcengineering/server-token'
import { issueExternalAccess } from '../external-access'
import { account, identityDatabase } from './external-access-fixture'

const workspace = 'a8a3cc87-17ad-4f38-9008-6388ab1d36ee' as WorkspaceUuid

beforeEach(() => {
  setMetadata(serverToken.metadata.Secret, 'external-access-test-secret')
  setMetadata(serverToken.metadata.Service, undefined)
})

it('uses one user/source identity for an API key and an independent OAuth connection', async () => {
  const { db, identities } = identityDatabase()
  const api = decodeToken(
    (
      await issueExternalAccess(db, account, 'Codex', {
        kind: 'api-key',
        workspace,
        keyId: 'key-1'
      })
    ).token
  )
  const oauth = decodeToken(
    (
      await issueExternalAccess(db, account, 'codex', {
        kind: 'oauth',
        connectionId: 'connection-1',
        session: {}
      })
    ).token
  )
  expect(identities.size).toBe(1)
  expect(api.account).toBe(account)
  expect(oauth.account).toBe(account)
  expect(api.extra?.externalSocialId).toBe(oauth.extra?.externalSocialId)
  expect(api.extra).toEqual({ externalSource: 'codex', externalSocialId: 'external-1', apiKey: 'key-1' })
  expect(oauth.extra).toEqual({
    externalSource: 'codex',
    externalSocialId: 'external-1',
    externalConnectionId: 'connection-1'
  })
  expect(api.workspace).toBe(workspace)
  expect(oauth.workspace).toBeUndefined()
})

it('issues separate workspace credentials without duplicating the default API identity', async () => {
  const { db, identities } = identityDatabase()
  const first = decodeToken(
    (
      await issueExternalAccess(db, account, 'api', {
        kind: 'api-key',
        workspace,
        keyId: 'key-1'
      })
    ).token
  )
  const second = decodeToken(
    (
      await issueExternalAccess(db, account, 'api', {
        kind: 'api-key',
        workspace,
        keyId: 'key-2'
      })
    ).token
  )
  expect(identities.size).toBe(1)
  expect(first.extra?.externalSocialId).toBe(second.extra?.externalSocialId)
  expect(first.extra?.apiKey).not.toBe(second.extra?.apiKey)
})

it('preserves the user session lifetime and restrictions during OAuth exchange', async () => {
  const { db } = identityDatabase()
  const now = Math.floor(Date.now() / 1000)
  const issued = await issueExternalAccess(db, account, 'Claude', {
    kind: 'oauth',
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
      kind: 'api-key',
      workspace,
      keyId: 'key-1'
    })
  ).rejects.toThrow('External source')
  expect(identities.size).toBe(0)
})
