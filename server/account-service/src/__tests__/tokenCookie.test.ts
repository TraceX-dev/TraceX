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

import { NoMetricsContext, type AccountUuid, type WorkspaceUuid } from '@hcengineering/core'
import { decodeToken, generateToken } from '@hcengineering/server-token'

import {
  createAccountCookieToken,
  extractCookieValue,
  shouldExposeRefreshToken,
  stripRefreshTokenFromResponse
} from '../index'

describe('account token cookie helpers', () => {
  const account = '00000000-0000-4000-8000-000000000001' as AccountUuid
  const workspace = '00000000-0000-4000-8000-000000000002' as WorkspaceUuid
  const ctx = new NoMetricsContext()

  it('preserves session identity and expiry when dropping workspace scope', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const source = generateToken(account, workspace, undefined, undefined, {
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

  it('returns the rotated refresh token only to the Authorization fallback', () => {
    expect(shouldExposeRefreshToken('refreshToken', undefined, 'refresh-token')).toBe(true)
    expect(shouldExposeRefreshToken('refreshToken', 'refresh-cookie', undefined)).toBe(false)
    expect(shouldExposeRefreshToken('login', undefined, undefined)).toBe(false)
  })

  it('matches cookie names exactly and preserves equals signs in values', () => {
    const header = 'other-account-metadata-RefreshToken=invalid; account-metadata-RefreshToken=token=with=padding'

    expect(extractCookieValue(header, 'account-metadata-RefreshToken')).toBe('token=with=padding')
    expect(
      extractCookieValue('account-metadata-RefreshTokenSuffix=invalid', 'account-metadata-RefreshToken')
    ).toBeUndefined()
  })
})
