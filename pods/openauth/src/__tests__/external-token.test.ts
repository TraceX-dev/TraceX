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

import { systemAccountUuid } from '@hcengineering/core'
import { NoMetricsContext } from '@hcengineering/measurements'
import { decodeToken } from '@hcengineering/server-token'
import { exchangeExternalAccess } from '../external-token'

const ctx = new NoMetricsContext()
const secret = 'issuer-to-account-test-secret'
afterEach(() => {
  jest.restoreAllMocks()
})

it('exchanges through the internal endpoint with short-lived issuer credentials', async () => {
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify({ token: 'delegated-token' })))
  const result = await exchangeExternalAccess(
    ctx,
    'https://accounts.example.test/',
    secret,
    'private-user-session',
    'codex',
    'connection-1'
  )
  expect(result).toBe('delegated-token')
  expect(request).toHaveBeenCalledTimes(1)
  const [url, init] = request.mock.calls[0]
  expect(url).toBe('https://accounts.example.test/internal/oauth/exchange')
  const serviceToken = new Headers(init?.headers).get('Authorization')?.slice('Bearer '.length)
  expect(serviceToken).toBeDefined()
  const claims = decodeToken(serviceToken ?? '', true, secret)
  expect(claims.account).toBe(systemAccountUuid)
  expect(claims.extra?.service).toBe('openauth')
  expect(claims.workspace).toBeUndefined()
  expect(claims.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60)
  expect(JSON.parse(String(init?.body))).toEqual({
    accountToken: 'private-user-session',
    source: 'codex',
    connectionId: 'connection-1'
  })
})

it.each([{}, { token: 123 }, { token: '' }])('rejects an invalid account response %j', async (body) => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body)))
  await expect(
    exchangeExternalAccess(ctx, 'https://accounts.example.test', secret, 'private-user-session', 'api', 'connection-1')
  ).rejects.toThrow('Invalid OAuth account token exchange response')
})

it('fails closed when the account service refuses the exchange', async () => {
  jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('internal details', { status: 403 }))
  await expect(
    exchangeExternalAccess(
      ctx,
      'https://accounts.example.test',
      secret,
      'private-user-session',
      'codex',
      'connection-1'
    )
  ).rejects.toThrow('OAuth account token exchange failed')
})
