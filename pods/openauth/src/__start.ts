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

import { getClient } from '@hcengineering/account-client'
import { systemAccountUuid } from '@hcengineering/core'
import type { MeasureContext } from '@hcengineering/measurements'
import { createOpenTelemetryMetricsContext, initOpenTelemetrySDK } from '@hcengineering/measurements-otlp'
import { decodeToken } from '@hcengineering/server-token'
import { serve } from '@hono/node-server'
import { createOAuthApp } from './app'
import { authenticateOAuthSession, exchangeExternalAccess } from './external-token'
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

async function initialize (
  ctx: MeasureContext,
  startupCtx: MeasureContext
): Promise<{ app: ReturnType<typeof createOAuthApp>, store: OAuthStore }> {
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
  await store.init(startupCtx)
  const app = createOAuthApp(ctx, config, store, {
    delegate: async (ctx, connection, expiresAt) =>
      await exchangeExternalAccess(ctx, accountsUrl, config.serverSecret, connection, expiresAt),
    getWorkspaces: async (ctx, token) =>
      await ctx.with(
        'openauth.accounts.get-workspaces',
        {},
        async () => {
          const workspaces = await getClient(accountsUrl, token).getUserWorkspaces()
          return workspaces.map((workspace) => ({ id: workspace.uuid, name: workspace.name, url: workspace.url }))
        },
        undefined,
        { suspendErrors: true }
      ),
    authenticate: async (ctx, token, requireAccountToken) =>
      await authenticateOAuthSession(ctx, accountsUrl, config.serverSecret, token, requireAccountToken),
    isServiceToken: (ctx, token) =>
      ctx.withSync(
        'openauth.accounts.verify-service-token',
        {},
        () => {
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
        },
        undefined,
        { suspendErrors: true }
      )
  })
  return { app, store }
}

async function main (ctx: MeasureContext): Promise<() => Promise<void>> {
  const { app, store } = await ctx.with(
    'openauth.startup',
    {},
    async (startupCtx) => await initialize(ctx, startupCtx),
    undefined,
    { suspendErrors: true }
  )
  const server = serve({ fetch: app.fetch, port: Number.parseInt(process.env.PORT ?? '3001', 10) })
  const cleanup = setInterval(() => {
    void store.cleanup(ctx).catch(() => {
      ctx.error('OAuth storage cleanup failed')
    })
  }, 60_000)
  return async () => {
    clearInterval(cleanup)
    try {
      await ctx.with(
        'openauth.shutdown',
        {},
        async (shutdownCtx) => {
          await new Promise<void>((resolve) => {
            server.close(() => {
              resolve()
            })
          })
          await store.close(shutdownCtx)
        },
        undefined,
        { suspendErrors: true }
      )
    } catch {
      ctx.error('OAuth service shutdown failed')
      process.exitCode = 1
    }
  }
}

// HTTP auto-instrumentation can capture authorization query strings or request headers.
process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS = ['http', 'undici', process.env.OTEL_NODE_DISABLED_INSTRUMENTATIONS]
  .filter(Boolean)
  .join(',')
const version = process.env.VERSION ?? ''
const startup = async (): Promise<(() => Promise<void>) | undefined> => {
  const ctx = createOpenTelemetryMetricsContext('openauth', {}, undefined, undefined, undefined, version)
  try {
    return await main(ctx)
  } catch (error) {
    ctx.error(error instanceof Error ? error.message : 'OAuth service failed to start')
    process.exitCode = 1
    return undefined
  }
}

let draining: Promise<void> | undefined
const drain = async (): Promise<void> => {
  await (draining ??= ready.then(async (close) => await close?.()))
}
const tracingEnabled = initOpenTelemetrySDK('openauth', version, drain)
const ready = startup()
if (!tracingEnabled) {
  const stop = (): void => {
    void drain()
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}
