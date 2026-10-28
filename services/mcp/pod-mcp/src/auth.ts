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
import { generateToken } from '@hcengineering/server-token'
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server'
import type { McpConfig } from './config'

export interface TraceXAuthInfo extends AuthInfo {
  extra: {
    account: string
    accountToken: string
    connectionId: string
  }
}

/** Resolves opaque OAuth access tokens without caching authorization or exposing account tokens to clients. */
export function createMcpTokenVerifier (config: McpConfig): OAuthTokenVerifier {
  return {
    async verifyAccessToken (token): Promise<TraceXAuthInfo> {
      const serviceToken = generateToken(systemAccountUuid, undefined, { service: 'mcp-oauth' }, config.ServerSecret, {
        exp: Math.floor(Date.now() / 1000) + 60
      })
      const response = await fetch(`${config.OAuthInternalURL}/internal/resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, resource: config.OAuthResourceURL }),
        signal: AbortSignal.timeout(10_000)
      })
      if (response.status === 401) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid or revoked OAuth access token')
      }
      if (!response.ok) throw new Error('OAuth authorization service is unavailable')
      const resolved: unknown = await response.json()
      if (
        typeof resolved !== 'object' ||
        resolved === null ||
        !('account' in resolved) ||
        typeof resolved.account !== 'string' ||
        !('accountToken' in resolved) ||
        typeof resolved.accountToken !== 'string' ||
        !('connectionId' in resolved) ||
        typeof resolved.connectionId !== 'string' ||
        !('clientId' in resolved) ||
        typeof resolved.clientId !== 'string' ||
        !('expiresAt' in resolved) ||
        typeof resolved.expiresAt !== 'number' ||
        !('resource' in resolved) ||
        resolved.resource !== config.OAuthResourceURL
      ) {
        throw new Error('Invalid response from OAuth authorization service')
      }
      return {
        token,
        clientId: resolved.clientId,
        scopes: ['tracex'],
        expiresAt: resolved.expiresAt,
        resource: new URL(resolved.resource),
        extra: { account: resolved.account, accountToken: resolved.accountToken, connectionId: resolved.connectionId }
      }
    }
  }
}
