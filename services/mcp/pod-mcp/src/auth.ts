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
import { getClient, OpenAuthError, type ResolvedAccessToken } from '@hcengineering/openauth-client'
import { generateToken } from '@hcengineering/server-token'
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from '@modelcontextprotocol/server'
import type { McpConfig } from './config'

export interface TraceXAuthInfo extends AuthInfo {
  extra: {
    account: string
    accountToken: string
    connectionId: string
    workspaceId: string | null
  }
}

/** Resolves opaque OAuth access tokens without caching authorization or exposing account tokens to clients. */
export function createMcpTokenVerifier (config: McpConfig): OAuthTokenVerifier {
  const client = getClient(config.OAuthInternalURL)
  return {
    async verifyAccessToken (token): Promise<TraceXAuthInfo> {
      const serviceToken = generateToken(systemAccountUuid, undefined, { service: 'mcp-oauth' }, config.ServerSecret, {
        exp: Math.floor(Date.now() / 1000) + 60
      })
      let resolved: ResolvedAccessToken
      try {
        resolved = await client.resolveAccessToken(token, config.OAuthResourceURL, serviceToken)
      } catch (error: unknown) {
        if (error instanceof OpenAuthError && error.status === 401) {
          throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid or revoked OAuth access token')
        }
        throw new Error('OAuth authorization service is unavailable', { cause: error })
      }
      if (resolved.resource !== config.OAuthResourceURL || resolved.workspaceId === undefined) {
        throw new Error('Invalid response from OAuth authorization service')
      }
      return {
        token,
        clientId: resolved.clientId,
        scopes: ['tracex'],
        expiresAt: resolved.expiresAt,
        resource: new URL(resolved.resource),
        extra: {
          account: resolved.account,
          accountToken: resolved.accountToken,
          connectionId: resolved.connectionId,
          workspaceId: resolved.workspaceId
        }
      }
    }
  }
}
