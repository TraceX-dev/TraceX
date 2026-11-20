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

import type { Context, Request } from 'koa'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { createOAuthExchangeHandler } from '../oauth-exchange'

const input: Parameters<Parameters<typeof createOAuthExchangeHandler>[0]>[1] = {
  accountToken: 'private-user-session',
  source: 'codex',
  connectionId: 'connection-1'
}

async function call (
  authorization: string,
  body: unknown,
  exchange = jest.fn(async () => 'external-token')
): Promise<Partial<Context>> {
  const request: Partial<Request> = { body }
  const ctx: Partial<Context> = { get: jest.fn().mockReturnValue(authorization), request: request as Request }
  await createOAuthExchangeHandler(exchange)(ctx as Context, async () => {})
  return ctx
}

it('forwards both issuer and user credentials only for a valid exchange request', async () => {
  const exchange = jest.fn(async () => 'external-token')
  const ctx = await call('Bearer internal-service-token', input, exchange)
  expect(ctx.status).toBe(200)
  expect(ctx.body).toEqual({ token: 'external-token' })
  expect(exchange).toHaveBeenCalledWith('internal-service-token', input)
})

it('rejects requests without issuer authorization', async () => {
  const exchange = jest.fn(async () => 'external-token')
  const ctx = await call('', input, exchange)
  expect(ctx.status).toBe(401)
  expect(exchange).not.toHaveBeenCalled()
})

it.each([null, {}, { ...input, connectionId: '' }, { ...input, source: 'invalid:source' }])(
  'rejects malformed exchange input %j before executing the exchange',
  async (body) => {
    const exchange = jest.fn(async () => 'external-token')
    const ctx = await call('Bearer service', body, exchange)
    expect(ctx.status).toBe(400)
    expect(exchange).not.toHaveBeenCalled()
  }
)

it('does not return user credentials or internal details on authorization failure', async () => {
  const exchange = jest.fn(async () => {
    throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
  })
  const ctx = await call('Bearer untrusted-service', input, exchange)
  expect(ctx.status).toBe(403)
  expect(ctx.body).toEqual({ error: 'access_denied' })
})
