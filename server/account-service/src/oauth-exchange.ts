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

import { normalizeExternalSource } from '@hcengineering/core'
import platform, { PlatformError } from '@hcengineering/platform'
import { TokenError } from '@hcengineering/server-token'
import type { Middleware } from 'koa'

interface OAuthExchangeInput {
  accountToken: string
  source: string
  connectionId: string
}

function isExchangeInput (value: unknown): value is OAuthExchangeInput {
  return (
    value !== null &&
    typeof value === 'object' &&
    'accountToken' in value &&
    typeof value.accountToken === 'string' &&
    value.accountToken !== '' &&
    'source' in value &&
    typeof value.source === 'string' &&
    'connectionId' in value &&
    typeof value.connectionId === 'string' &&
    value.connectionId.length > 0 &&
    value.connectionId.length <= 128
  )
}

/** Internal transport: the exchange implementation authenticates both issuer and user session. */
export function createOAuthExchangeHandler (
  exchange: (serviceToken: string, input: OAuthExchangeInput) => Promise<string>
): Middleware {
  return async (ctx) => {
    const bearer = /^Bearer (\S+)$/i.exec(ctx.get('Authorization'))
    if (bearer === null) {
      ctx.status = 401
      ctx.body = { error: 'unauthorized' }
      return
    }
    const input: unknown = ctx.request.body
    if (!isExchangeInput(input)) {
      ctx.status = 400
      ctx.body = { error: 'invalid_request' }
      return
    }
    try {
      normalizeExternalSource(input.source)
    } catch {
      ctx.status = 400
      ctx.body = { error: 'invalid_request' }
      return
    }
    try {
      ctx.body = { token: await exchange(bearer[1], input) }
      ctx.status = 200
    } catch (error: unknown) {
      ctx.status =
        error instanceof TokenError
          ? 401
          : error instanceof PlatformError
            ? error.status.code === platform.status.Unauthorized
              ? 401
              : 403
            : 500
      ctx.body = { error: ctx.status === 500 ? 'exchange_failed' : 'access_denied' }
    }
  }
}
