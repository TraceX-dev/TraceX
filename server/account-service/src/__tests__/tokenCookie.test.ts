//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { NoMetricsContext, type AccountUuid } from '@hcengineering/core'
import { decodeToken, generateToken } from '@hcengineering/server-token'

import { createAccountCookieToken, stripRefreshTokenFromResponse } from '../index'

describe('account token cookie helpers', () => {
  const account: AccountUuid = '00000000-0000-4000-8000-000000000001'
  const ctx = new NoMetricsContext()

  it('preserves session identity and expiry when dropping workspace scope', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const source = generateToken(account, '00000000-0000-4000-8000-000000000002', undefined, undefined, {
      sessionId: 'session-1',
      kind: 'access',
      exp
    })

    const cookieToken = decodeToken(createAccountCookieToken(ctx, source))

    expect(cookieToken.workspace).toBeUndefined()
    expect(cookieToken.sessionId).toBe('session-1')
    expect(cookieToken.kind).toBe('access')
    expect(cookieToken.exp).toBe(exp)
  })

  it('does not serialize refresh tokens into RPC results', () => {
    const response = stripRefreshTokenFromResponse({
      account,
      token: 'access-token',
      refreshToken: 'secret-refresh-token'
    })

    expect(response).toEqual({ account, token: 'access-token' })
    expect(JSON.stringify(response)).not.toContain('secret-refresh-token')
  })
})
