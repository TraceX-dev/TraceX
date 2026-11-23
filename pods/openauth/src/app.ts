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

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { normalizeExternalSource } from '@hcengineering/core'
import type { MeasureContext } from '@hcengineering/measurements'
import { issuer } from '@openauthjs/openauth'
import { createSubjects } from '@openauthjs/openauth/subject'
import type { Provider } from '@openauthjs/openauth/provider/provider'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { matchedRoutes } from 'hono/route'
import { decodeJwt } from 'jose'
import { authorizationFingerprint, getTokenKey, isRecord, isRedirectUri, opaqueToken } from './protocol'
import type { OAuthStore } from './store'
import type { AuthorizationState, OAuthConfig, OAuthWorkspace, PendingLogin, TraceXIdentity } from './types'

interface SubjectProperties {
  account: string
  connectionId: string
}

interface OAuthEnv {
  Variables: { measureContext: MeasureContext }
}

interface AccountAccess {
  delegate: (ctx: MeasureContext, token: string, source: string, connectionId: string) => Promise<string>
  authenticate: (ctx: MeasureContext, token: string, requireAccountToken: boolean) => Promise<TraceXIdentity>
  getWorkspaces: (ctx: MeasureContext, token: string) => Promise<OAuthWorkspace[]>
  isServiceToken: (ctx: MeasureContext, token: string) => boolean
}

const HTTP_METHODS = new Set(['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS'])
const ISSUER_ROUTES = new Set([
  '/authorize',
  '/token',
  '/tracex/authorize',
  '/tracex/complete',
  '/tracex/cancel',
  '/.well-known/jwks.json',
  '/.well-known/oauth-authorization-server'
])

const subjects = createSubjects({
  user: {
    '~standard': {
      version: 1 as const,
      vendor: 'tracex',
      validate: (value: unknown) => {
        if (isRecord(value) && typeof value.account === 'string' && typeof value.connectionId === 'string') {
          return { value: { account: value.account, connectionId: value.connectionId } }
        }
        return { issues: [{ message: 'Invalid OAuth subject' }] }
      }
    }
  }
})

function bearer (request: Request): string | undefined {
  const match = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')
  return match?.[1]
}

function pendingLogin (value: unknown): PendingLogin | undefined {
  if (!isRecord(value) || typeof value.clientId !== 'string' || typeof value.authorization !== 'string') {
    return undefined
  }
  return {
    clientId: value.clientId,
    authorization: value.authorization,
    account: typeof value.account === 'string' ? value.account : undefined,
    source: typeof value.source === 'string' ? value.source : undefined,
    accountToken: typeof value.accountToken === 'string' ? value.accountToken : undefined,
    workspaceId: value.workspaceId === null || typeof value.workspaceId === 'string' ? value.workspaceId : undefined
  }
}

/** Adapts OpenAuth's issuer to a single MCP resource, with server-side TraceX credentials. */
export function createOAuthApp (
  ctx: MeasureContext,
  config: OAuthConfig,
  store: OAuthStore,
  accounts: AccountAccess
): Hono<OAuthEnv> {
  const app = new Hono<OAuthEnv>()
  const routes = new Hono<OAuthEnv>()
  // The issuer's storage and provider interfaces carry no application context.
  const issuerScope = new AsyncLocalStorage<MeasureContext>()
  function issuerContext (): MeasureContext {
    const ctx = issuerScope.getStore()
    if (ctx === undefined) throw new Error('Missing OpenAuth issuer context')
    return ctx
  }
  const issuerUrl = new URL(config.issuerUrl)
  const issuerPath = issuerUrl.pathname.replace(/\/$/, '')
  const loginOrigin = new URL(config.loginUrl).origin
  const originAllowed = (request: Request): boolean => request.headers.get('origin') === loginOrigin

  app.use('*', async (c, next) => {
    const registeredRoute = matchedRoutes(c).find(({ method }) => method !== 'ALL')?.path
    const issuerRoute = c.req.path.startsWith(`${issuerPath}/`) ? c.req.path.slice(issuerPath.length) : ''
    const route = registeredRoute ?? (ISSUER_ROUTES.has(issuerRoute) ? `${issuerPath}${issuerRoute}` : 'unmatched')
    const method = HTTP_METHODS.has(c.req.method) ? c.req.method : 'OTHER'
    const traceparent = c.req.header('traceparent')
    let status = 500
    await ctx.with(
      'openauth.http',
      { method, route },
      async (requestCtx) => {
        try {
          c.set('measureContext', requestCtx)
          await next()
          status = c.res.status
        } finally {
          requestCtx.counter('openauth-http-responses', 1, { method, route, status })
        }
      },
      () => ({ status }),
      { suspendErrors: true, meta: traceparent === undefined ? undefined : { traceparent } }
    )
  })

  app.use('*', bodyLimit({ maxSize: 16 * 1024 }))
  app.use(
    '*',
    cors({
      origin: loginOrigin,
      allowHeaders: ['Authorization', 'Content-Type'],
      allowMethods: ['GET', 'POST', 'DELETE']
    })
  )
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store')
    c.header('Referrer-Policy', 'no-referrer')
    c.header('X-Content-Type-Options', 'nosniff')
    await next()
  })
  app.onError((_error, c) =>
    c.json({ error: 'server_error', error_description: 'Authorization could not be completed' }, 500)
  )
  app.get('/health', (c) => c.json({ ok: true, service: 'openauth' }))

  const metadata = {
    issuer: config.issuerUrl,
    authorization_endpoint: `${config.issuerUrl}/authorize`,
    token_endpoint: `${config.issuerUrl}/token`,
    registration_endpoint: `${config.issuerUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['tracex'],
    authorization_response_iss_parameter_supported: true
  }
  // RFC 8414 inserts the well-known suffix before the issuer's path component.
  app.get(`/.well-known/oauth-authorization-server${issuerPath}`, (c) => c.json(metadata))
  routes.get('/.well-known/oauth-authorization-server', (c) => c.json(metadata))
  routes.get('/health', (c) => c.json({ ok: true, service: 'openauth' }))

  let registrationWindow = 0
  let registrationCount = 0
  routes.post('/register', async (c) => {
    const ctx = c.get('measureContext')
    if (Date.now() > registrationWindow) {
      registrationWindow = Date.now() + 60_000
      registrationCount = 0
    }
    if (++registrationCount > 30) return c.json({ error: 'temporarily_unavailable' }, 429)
    const value: unknown = await c.req.json()
    if (
      !isRecord(value) ||
      !Array.isArray(value.redirect_uris) ||
      value.redirect_uris.length === 0 ||
      value.redirect_uris.length > 10 ||
      !value.redirect_uris.every(isRedirectUri) ||
      (value.token_endpoint_auth_method !== undefined && value.token_endpoint_auth_method !== 'none') ||
      (value.grant_types !== undefined &&
        (!Array.isArray(value.grant_types) ||
          !value.grant_types.every((grant) => grant === 'authorization_code' || grant === 'refresh_token'))) ||
      (value.response_types !== undefined &&
        (!Array.isArray(value.response_types) || !value.response_types.every((response) => response === 'code')))
    ) {
      return c.json({ error: 'invalid_client_metadata' }, 400)
    }
    const client = {
      id: randomUUID(),
      name: typeof value.client_name === 'string' ? value.client_name.slice(0, 120) : 'MCP client',
      redirectUris: value.redirect_uris
    }
    await store.registerClient(ctx, client)
    return c.json(
      {
        client_id: client.id,
        client_name: client.name,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code']
      },
      201
    )
  })

  routes.get('/requests/:id', async (c) => {
    const ctx = c.get('measureContext')
    const pending = pendingLogin(await store.get(ctx, ['login', c.req.param('id')]))
    const client = pending === undefined ? undefined : await store.getClient(ctx, pending.clientId)
    if (client === undefined) return c.json({ error: 'invalid_request' }, 400)
    return c.json({
      clientName: client.name,
      redirectOrigins: [...new Set(client.redirectUris.map((uri) => new URL(uri).origin))]
    })
  })

  routes.post('/requests/:id/complete', async (c) => {
    const ctx = c.get('measureContext')
    if (!originAllowed(c.req.raw)) return c.json({ error: 'access_denied' }, 403)
    const token = bearer(c.req.raw)
    if (token === undefined) return c.json({ error: 'invalid_token' }, 401)
    const input: unknown = await c.req.json().catch(() => undefined)
    if (!isRecord(input) || (input.workspaceId !== null && typeof input.workspaceId !== 'string')) {
      return c.json({ error: 'invalid_request' }, 400)
    }
    const workspaceId = input.workspaceId
    let source: string
    try {
      source = normalizeExternalSource(typeof input.source === 'string' ? input.source : 'external')
    } catch {
      return c.json({ error: 'invalid_request' }, 400)
    }
    return await store.withLock(ctx, `login:${c.req.param('id')}`, async (ctx) => {
      const key = ['login', c.req.param('id')]
      const pending = pendingLogin(await store.get(ctx, key))
      if (pending === undefined || pending.account !== undefined) return c.json({ error: 'invalid_request' }, 400)
      let identity: TraceXIdentity
      try {
        identity = await accounts.authenticate(ctx, token, true)
      } catch {
        return c.json({ error: 'invalid_token' }, 401)
      }
      if (
        workspaceId !== null &&
        !(await accounts.getWorkspaces(ctx, identity.token)).some((workspace) => workspace.id === workspaceId)
      ) {
        return c.json({ error: 'access_denied' }, 403)
      }
      await store.set(
        ctx,
        key,
        { ...pending, account: identity.account, accountToken: identity.token, workspaceId, source },
        new Date(Date.now() + 60_000)
      )
      return c.json({
        continueUrl: `${config.issuerUrl}/tracex/complete?request=${encodeURIComponent(c.req.param('id'))}`
      })
    })
  })

  routes.get('/requests/:id/workspaces', async (c) => {
    const ctx = c.get('measureContext')
    if (pendingLogin(await store.get(ctx, ['login', c.req.param('id')])) === undefined) {
      return c.json({ error: 'invalid_request' }, 400)
    }
    const token = bearer(c.req.raw)
    if (token === undefined) return c.json({ error: 'invalid_token' }, 401)
    let identity: TraceXIdentity
    try {
      identity = await accounts.authenticate(ctx, token, true)
    } catch {
      return c.json({ error: 'invalid_token' }, 401)
    }
    return c.json(await accounts.getWorkspaces(ctx, identity.token))
  })

  routes.get('/connections', async (c) => {
    const ctx = c.get('measureContext')
    const token = bearer(c.req.raw)
    if (token === undefined) return c.json({ error: 'invalid_token' }, 401)
    try {
      const identity = await accounts.authenticate(ctx, token, false)
      const connections = await store.listConnections(ctx, identity.account, config.resourceUrl)
      const workspaces = connections.some((connection) => connection.workspaceId !== null)
        ? await accounts.getWorkspaces(ctx, identity.token)
        : []
      return c.json(
        connections.map((connection) => {
          const workspace = workspaces.find((workspace) => workspace.id === connection.workspaceId)
          return { ...connection, workspaceName: workspace?.name, workspaceUrl: workspace?.url }
        })
      )
    } catch {
      return c.json({ error: 'invalid_token' }, 401)
    }
  })
  routes.delete('/connections/:id', async (c) => {
    const ctx = c.get('measureContext')
    if (!originAllowed(c.req.raw)) return c.json({ error: 'access_denied' }, 403)
    const token = bearer(c.req.raw)
    if (token === undefined) return c.json({ error: 'invalid_token' }, 401)
    try {
      const identity = await accounts.authenticate(ctx, token, false)
      await store.revokeConnection(ctx, c.req.param('id'), identity.account, config.resourceUrl)
      return c.body(null, 204)
    } catch {
      return c.json({ error: 'invalid_token' }, 401)
    }
  })

  routes.post('/internal/resolve', async (c) => {
    const ctx = c.get('measureContext')
    const serviceToken = bearer(c.req.raw)
    if (serviceToken === undefined || !accounts.isServiceToken(ctx, serviceToken)) {
      return c.json({ error: 'access_denied' }, 403)
    }
    const input: unknown = await c.req.json()
    if (!isRecord(input) || typeof input.token !== 'string' || input.resource !== config.resourceUrl) {
      return c.json({ error: 'invalid_token' }, 401)
    }
    const resolved = await store.resolveAccessToken(ctx, input.token)
    if (resolved === undefined || resolved.connection.resource !== config.resourceUrl) {
      return c.json({ error: 'invalid_token' }, 401)
    }
    let accountToken: string
    try {
      await accounts.authenticate(ctx, resolved.connection.accountToken, true)
      accountToken = await accounts.delegate(
        ctx,
        resolved.connection.accountToken,
        resolved.connection.source ?? 'external',
        resolved.connection.id
      )
    } catch {
      return c.json({ error: 'invalid_token' }, 401)
    }
    return c.json({
      connectionId: resolved.connection.id,
      account: resolved.connection.account,
      accountToken,
      clientId: resolved.connection.clientId,
      workspaceId: resolved.connection.workspaceId,
      resource: resolved.connection.resource,
      expiresAt: Math.floor(resolved.expiresOn / 1000)
    })
  })

  const provider: Provider<SubjectProperties> = {
    type: 'tracex',
    init (routes, providerContext) {
      routes.get('/authorize', async (c) => {
        const ctx = issuerContext()
        const authorization = await providerContext.get<AuthorizationState>(c, 'authorization')
        if (authorization === undefined) return c.text('Authorization request expired. Please reconnect.', 400)
        const request = opaqueToken()
        await store.set(
          ctx,
          ['login', request],
          {
            clientId: authorization.client_id,
            authorization: authorizationFingerprint(authorization)
          },
          new Date(Date.now() + 10 * 60_000)
        )
        const url = new URL(config.loginUrl)
        url.searchParams.set('request', request)
        return c.redirect(url.toString())
      })
      routes.get('/complete', async (c) => {
        const ctx = issuerContext()
        const request = c.req.query('request') ?? ''
        return await store.withLock(ctx, `login:${request}`, async (ctx) => {
          const key = ['login', request]
          const pending = pendingLogin(await store.get(ctx, key))
          const authorization = await providerContext.get<AuthorizationState>(c, 'authorization')
          if (
            pending === undefined ||
            authorization === undefined ||
            pending.authorization !== authorizationFingerprint(authorization) ||
            pending.account === undefined ||
            pending.accountToken === undefined ||
            pending.workspaceId === undefined
          ) {
            return c.text('Authorization request expired or changed. Please reconnect.', 400)
          }
          const client = await store.getClient(ctx, pending.clientId)
          if (client === undefined) return c.text('Unknown OAuth client.', 400)
          await store.remove(ctx, key)
          const connectionId = randomUUID()
          await store.createConnection(ctx, {
            id: connectionId,
            account: pending.account,
            accountToken: pending.accountToken,
            workspaceId: pending.workspaceId,
            clientId: client.id,
            clientName: client.name,
            source: pending.source ?? 'external',
            resource: config.resourceUrl,
            createdOn: Date.now()
          })
          return await providerContext.success(c, { account: pending.account, connectionId })
        })
      })
      routes.get('/cancel', async (c) => {
        const ctx = issuerContext()
        const key = ['login', c.req.query('request') ?? '']
        const pending = pendingLogin(await store.get(ctx, key))
        const authorization = await providerContext.get<AuthorizationState>(c, 'authorization')
        if (
          pending === undefined ||
          authorization === undefined ||
          pending.authorization !== authorizationFingerprint(authorization)
        ) {
          return c.text('Authorization request expired. Please reconnect.', 400)
        }
        await store.remove(ctx, key)
        await providerContext.unset(c, 'authorization')
        const redirect = new URL(authorization.redirect_uri)
        redirect.searchParams.set('error', 'access_denied')
        redirect.searchParams.set('state', authorization.state ?? '')
        redirect.searchParams.set('iss', config.issuerUrl)
        return c.redirect(redirect.toString())
      })
    }
  }

  const openauth = issuer({
    storage: {
      get: async (key) => await store.get(issuerContext(), key),
      set: async (key, value, expiry) => { await store.set(issuerContext(), key, value, expiry); },
      remove: async (key) => { await store.remove(issuerContext(), key); },
      scan: (prefix) => store.scan(issuerContext(), prefix)
    },
    subjects,
    providers: { tracex: provider },
    ttl: { access: 300, refresh: 30 * 24 * 3600, reuse: 10, retention: 300 },
    allow: async ({ clientID, redirectURI }) => {
      const client = await store.getClient(issuerContext(), clientID)
      return client?.redirectUris.includes(redirectURI) === true
    },
    success: async (ctx, value: SubjectProperties & { provider: string }) => {
      return await ctx.subject(
        'user',
        { account: value.account, connectionId: value.connectionId },
        { subject: value.connectionId }
      )
    },
    error: async () => new Response('Authorization request expired. Please reconnect.', { status: 400 })
  })

  /** OpenAuth routes internally at the origin root; its public redirects and cookies use the configured prefix. */
  async function fetchIssuer (
    ctx: MeasureContext,
    path: string,
    request: Request,
    grantType?: string
  ): Promise<Response> {
    const internalRequest = new Request(`${issuerUrl.origin}${path}`, request)
    // OpenAuth consults forwarded headers when deriving URLs. Only installation configuration is trusted here.
    for (const header of [
      'forwarded',
      'x-forwarded-host',
      'x-forwarded-proto',
      'x-forwarded-port',
      'x-forwarded-prefix'
    ]) {
      internalRequest.headers.delete(header)
    }
    const { pathname } = new URL(internalRequest.url)
    const route = ISSUER_ROUTES.has(pathname) ? pathname : 'unmatched'
    const response = await ctx.with(
      'openauth.issuer',
      { route, grant_type: grantType },
      async (issuerCtx) => await issuerScope.run(issuerCtx, async () => await openauth.fetch(internalRequest)),
      undefined,
      { suspendErrors: true }
    )
    const headers = new Headers(response.headers)
    const location = headers.get('location')
    if (location !== null) {
      const redirect = new URL(location, issuerUrl.origin)
      if (redirect.searchParams.has('code')) {
        redirect.searchParams.set('iss', config.issuerUrl)
        headers.set('location', redirect.toString())
      } else if (location.startsWith('/') && !location.startsWith('//')) {
        headers.set('location', `${config.issuerUrl}${location}`)
      }
    }
    headers.delete('set-cookie')
    for (const cookie of response.headers.getSetCookie()) {
      headers.append('set-cookie', cookie.replace(/;\s*Path=\/([^;]*)/i, `; Path=${issuerPath || ''}/`))
    }
    return new Response(response.body, { status: response.status, headers })
  }

  routes.get('/authorize', async (c) => {
    const ctx = c.get('measureContext')
    const query = new URL(c.req.url).searchParams
    const client = await store.getClient(ctx, query.get('client_id') ?? '')
    if (
      client === undefined ||
      !client.redirectUris.includes(query.get('redirect_uri') ?? '') ||
      query.get('response_type') !== 'code' ||
      query.get('resource') !== config.resourceUrl ||
      query.get('code_challenge_method') !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(query.get('code_challenge') ?? '') ||
      (query.get('scope') ?? 'tracex').split(' ').some((scope) => scope !== 'tracex')
    ) {
      return c.json({ error: 'invalid_request' }, 400)
    }
    const url = new URL(`/authorize?${query.toString()}`, config.issuerUrl)
    url.searchParams.set('audience', config.resourceUrl)
    url.searchParams.set('provider', 'tracex')
    return await store.withLock(
      ctx,
      'openauth:authorization',
      async (ctx) => await fetchIssuer(ctx, url.pathname + url.search, c.req.raw)
    )
  })

  routes.post('/token', async (c) => {
    const ctx = c.get('measureContext')
    const form = new URLSearchParams(await c.req.text())
    const tokenKey = getTokenKey(form)
    if (
      tokenKey === undefined ||
      (form.has('resource') && form.get('resource') !== config.resourceUrl) ||
      (form.get('scope') ?? 'tracex') !== 'tracex' ||
      (form.get('grant_type') === 'authorization_code' &&
        !/^[A-Za-z0-9._~-]{43,128}$/.test(form.get('code_verifier') ?? ''))
    ) {
      return c.json({ error: 'invalid_request' }, 400)
    }
    return await store.withLock(ctx, JSON.stringify(tokenKey), async (ctx) => {
      const stored = await store.get(ctx, tokenKey)
      const properties = stored?.properties
      if (
        stored === undefined ||
        stored.clientID !== form.get('client_id') ||
        !isRecord(properties) ||
        typeof properties.connectionId !== 'string'
      ) {
        return c.json({ error: 'invalid_grant' }, 400)
      }
      const connection = await store.getConnection(ctx, properties.connectionId)
      if (
        connection === undefined ||
        connection.resource !== config.resourceUrl ||
        connection.clientId !== stored.clientID
      ) {
        return c.json({ error: 'invalid_grant' }, 400)
      }
      try {
        await accounts.authenticate(ctx, connection.accountToken, true)
      } catch {
        await store.revokeConnection(ctx, connection.id, connection.account, config.resourceUrl)
        return c.json({ error: 'invalid_grant' }, 400)
      }
      if (typeof stored.timeUsed === 'number' && Date.now() > stored.timeUsed + 10_000) {
        await store.revokeConnection(ctx, connection.id, connection.account, config.resourceUrl)
        return c.json({ error: 'invalid_grant' }, 400)
      }
      const response = await fetchIssuer(
        ctx,
        '/token',
        new Request(`${config.issuerUrl}/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString()
        }),
        form.get('grant_type') ?? undefined
      )
      if (!response.ok) return response
      const tokens: unknown = await response.json()
      if (!isRecord(tokens) || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
        return c.json({ error: 'server_error' }, 500)
      }
      // This JWT comes directly from the in-process issuer, never from a caller.
      const payload = decodeJwt(tokens.access_token)
      if (payload.exp === undefined || payload.sub !== connection.id || payload.aud !== connection.clientId) {
        return c.json({ error: 'server_error' }, 500)
      }
      const accessToken = opaqueToken()
      await store.issueAccessToken(ctx, accessToken, connection.id, payload.exp * 1000)
      return c.json({
        access_token: accessToken,
        token_type: 'Bearer',
        refresh_token: tokens.refresh_token,
        expires_in: Math.max(0, payload.exp - Math.floor(Date.now() / 1000)),
        scope: 'tracex'
      })
    })
  })

  routes.all('*', async (c) => {
    const ctx = c.get('measureContext')
    const requestUrl = new URL(c.req.url)
    return await fetchIssuer(ctx, requestUrl.pathname.slice(issuerPath.length) + requestUrl.search, c.req.raw)
  })
  app.route(issuerPath || '/', routes)
  return app
}
