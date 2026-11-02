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

import { serve } from '@hono/node-server'
import { getClient } from '@hcengineering/account-client'
import { readOnlyGuestAccountUuid, systemAccountUuid } from '@hcengineering/core'
import { decodeToken, generateToken } from '@hcengineering/server-token'
import { createOAuthApp } from './app'
import { OAuthStore } from './store'

function requiredEnv (name: string): string {
  const value = process.env[name]?.trim()
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

function publicUrl (name: string): string {
  const url = new URL(requiredEnv(name))
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== '' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && process.env.OPENAUTH_ALLOW_HTTP === 'true'))
  ) {
    throw new Error(`${name} must be a public HTTPS URL`)
  }
  return url.toString().replace(/\/$/, '')
}

async function main (): Promise<void> {
  if (process.env.OPENAUTH_STORAGE !== undefined) {
    throw new Error('OPENAUTH_STORAGE must not override persistent issuer storage')
  }
  const config = {
    issuerUrl: publicUrl('OPENAUTH_PUBLIC_URL'),
    resourceUrl: publicUrl('OPENAUTH_MCP_RESOURCE_URL'),
    loginUrl: publicUrl('OPENAUTH_LOGIN_URL'),
    serverSecret: requiredEnv('SERVER_SECRET')
  }
  if (new URL(config.issuerUrl).search !== '') {
    throw new Error('OPENAUTH_PUBLIC_URL must not contain a query')
  }
  const accountsUrl = requiredEnv('ACCOUNTS_URL')
  const store = new OAuthStore(requiredEnv('OPENAUTH_DATABASE_URL'), config.serverSecret)
  await store.init()
  const app = createOAuthApp(config, store, {
    getWorkspaces: async (token) => {
      const workspaces = await getClient(accountsUrl, token).getUserWorkspaces()
      return workspaces.map((workspace) => ({ id: workspace.uuid, name: workspace.name, url: workspace.url }))
    },
    authenticate: async (token, requireAccountToken) => {
      const decoded = decodeToken(token, true, config.serverSecret)
      if (
        decoded.account === systemAccountUuid ||
        decoded.account === readOnlyGuestAccountUuid ||
        decoded.grant !== undefined ||
        decoded.sub !== undefined ||
        decoded.extra?.apiKey !== undefined ||
        decoded.extra?.service !== undefined ||
        decoded.extra?.restoreEmail !== undefined ||
        decoded.extra?.confirmEmail !== undefined ||
        decoded.extra?.tfaAccount !== undefined ||
        decoded.extra?.guest !== undefined
      ) {
        throw new Error('An authenticated TraceX account session is required')
      }
      const login = await getClient(accountsUrl, token).getLoginInfoByToken()
      if (login === null || 'request' in login || login.account !== decoded.account || login.tfaRequired === true) {
        throw new Error('TraceX account authentication is incomplete')
      }
      // Same normalization as accounts PUT /cookie: ordinary session tokens can be used without a workspace.
      const accountToken =
        requireAccountToken && decoded.workspace !== undefined
          ? generateToken(decoded.account, undefined, decoded.extra, config.serverSecret, {
              exp: decoded.exp,
              nbf: decoded.nbf
            })
          : token
      return { account: decoded.account, token: accountToken }
    },
    isServiceToken: (token) => {
      try {
        const decoded = decodeToken(token, true, config.serverSecret)
        return (
          decoded.account === systemAccountUuid &&
          decoded.extra?.service === 'mcp-oauth' &&
          decoded.exp !== undefined &&
          decoded.exp > Math.floor(Date.now() / 1000)
        )
      } catch {
        return false
      }
    }
  })
  const server = serve({ fetch: app.fetch, port: Number.parseInt(process.env.PORT ?? '3001', 10) })
  const cleanup = setInterval(() => {
    void store.cleanup().catch(() => {
      console.error('OAuth storage cleanup failed')
    })
  }, 60_000)
  const close = (): void => {
    clearInterval(cleanup)
    server.close(() => {
      void store.close().catch(() => {
        process.exitCode = 1
      })
    })
  }
  process.on('SIGTERM', close)
  process.on('SIGINT', close)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'OAuth service failed to start')
  process.exitCode = 1
})
