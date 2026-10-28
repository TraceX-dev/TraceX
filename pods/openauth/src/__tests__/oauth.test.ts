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

import { createHash, randomUUID } from 'node:crypto'
import { createOAuthApp } from '../app'
import { OAuthStore } from '../store'
import type { OAuthConnection, RegisteredClient } from '../types'

jest.setTimeout(30_000)
const config = {
  issuerUrl: 'https://auth.example.test',
  resourceUrl: 'https://mcp.example.test/mcp',
  loginUrl: 'https://front.example.test/login/oauth',
  serverSecret: 'test-only-secret'
}
const account = randomUUID()
const otherAccount = randomUUID()

function testStore (): OAuthStore {
  const store = new OAuthStore('postgres://unused:unused@127.0.0.1:1/unused', config.serverSecret)
  const values = new Map<string, { value: unknown, expiry?: number }>()
  const clients = new Map<string, RegisteredClient>()
  const connections = new Map<string, OAuthConnection>()
  const tokens = new Map<string, { connection: string, expiresOn: number }>()
  const locks = new Map<string, Promise<unknown>>()
  jest.spyOn(store, 'get').mockImplementation(async (key) => {
    const found = values.get(JSON.stringify(key))
    return found === undefined || (found.expiry !== undefined && found.expiry <= Date.now())
      ? undefined
      : (structuredClone(found.value) as Record<string, unknown>)
  })
  jest.spyOn(store, 'set').mockImplementation(async (key, value, expiry) => {
    values.set(JSON.stringify(key), { value: structuredClone(value), expiry: expiry?.getTime() })
  })
  jest.spyOn(store, 'remove').mockImplementation(async (key) => {
    values.delete(JSON.stringify(key))
  })
  jest.spyOn(store, 'scan').mockImplementation(async function* (prefix) {
    for (const [encoded] of values) {
      const key = JSON.parse(encoded) as string[]
      if (prefix.every((part, index) => key[index] === part)) {
        const value = await store.get(key)
        if (value !== undefined) yield [key, value]
      }
    }
  })
  jest.spyOn(store, 'withLock').mockImplementation(async <T>(key: string, action: () => Promise<T>): Promise<T> => {
    const current = (locks.get(key) ?? Promise.resolve()).then(action)
    locks.set(
      key,
      current.catch(() => {})
    )
    return await current
  })
  jest.spyOn(store, 'registerClient').mockImplementation(async (client) => {
    clients.set(client.id, client)
  })
  jest.spyOn(store, 'getClient').mockImplementation(async (id) => clients.get(id))
  jest.spyOn(store, 'createConnection').mockImplementation(async (connection) => {
    connections.set(connection.id, connection)
  })
  jest.spyOn(store, 'getConnection').mockImplementation(async (id) => {
    const connection = connections.get(id)
    return connection?.revokedOn === undefined ? connection : undefined
  })
  jest
    .spyOn(store, 'listConnections')
    .mockImplementation(async (accountId) =>
      [...connections.values()]
        .filter((connection) => connection.account === accountId && connection.revokedOn === undefined)
        .map(({ id, clientName, createdOn }) => ({ id, clientName, createdOn }))
    )
  jest.spyOn(store, 'revokeConnection').mockImplementation(async (id, accountId) => {
    const connection = connections.get(id)
    if (connection?.account === accountId) connection.revokedOn = Date.now()
  })
  jest.spyOn(store, 'issueAccessToken').mockImplementation(async (token, connection, expiresOn) => {
    tokens.set(token, { connection, expiresOn })
  })
  jest.spyOn(store, 'resolveAccessToken').mockImplementation(async (token) => {
    const entry = tokens.get(token)
    if (entry === undefined || entry.expiresOn <= Date.now()) return undefined
    const connection = await store.getConnection(entry.connection)
    return connection === undefined ? undefined : { connection, expiresOn: entry.expiresOn }
  })
  return store
}

describe.each([
  config,
  {
    ...config,
    issuerUrl: 'https://stage.example.test/oauth',
    resourceUrl: 'https://stage.example.test/mcp',
    loginUrl: 'https://stage.example.test/login/oauth'
  },
  {
    ...config,
    issuerUrl: 'https://stage.example.test/services/oauth',
    resourceUrl: 'https://stage.example.test/services/mcp',
    loginUrl: 'https://stage.example.test/login/oauth'
  }
])('MCP OAuth authorization at $issuerUrl', (config) => {
  let store: OAuthStore
  let app: ReturnType<typeof createOAuthApp>
  let sessionActive: boolean
  beforeEach(() => {
    store = testStore()
    sessionActive = true
    app = createOAuthApp(config, store, {
      authenticate: async (token) => {
        if (!sessionActive || !['account-session', 'other-session'].includes(token)) throw new Error('Invalid session')
        return { account: token === 'other-session' ? otherAccount : account, token }
      },
      isServiceToken: (token) => token === 'internal-service'
    })
  })
  afterEach(async () => {
    await store.close()
  })

  async function request (path: string, init: RequestInit = {}, cookies?: Map<string, string>): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('x-forwarded-host', 'untrusted-proxy.example')
    headers.set('x-forwarded-proto', 'http')
    if (cookies !== undefined) headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '))
    const url = new URL(path.startsWith('/') ? `${config.issuerUrl}${path}` : path)
    // Simulate a proxy that preserves the path but uses an internal upstream host and HTTP.
    const upstream = `http://openauth.internal:3001${url.pathname}${url.search}`
    const response = await app.request(new Request(upstream, { ...init, headers }))
    if (cookies !== undefined) {
      for (const cookie of response.headers.getSetCookie()) {
        const cookiePath = `${new URL(config.issuerUrl).pathname.replace(/\/$/, '')}/`
        expect(cookie.split(';').map((part) => part.trim())).toContain(`Path=${cookiePath}`)
        const pair = cookie.split(';')[0]
        cookies.set(pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1))
      }
    }
    return response
  }

  async function register (redirectUri = 'http://127.0.0.1:7777/callback'): Promise<string> {
    const response = await request('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: 'Codex', redirect_uris: [redirectUri] })
    })
    expect(response.status).toBe(201)
    return ((await response.json()) as { client_id: string }).client_id
  }

  async function authorize (
    clientId: string,
    redirectUri = 'http://127.0.0.1:7777/callback'
  ): Promise<{ code: string, verifier: string }> {
    const verifier = 'a'.repeat(64)
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      resource: config.resourceUrl,
      state: 'test-state',
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url')
    })
    const cookies = new Map<string, string>()
    const start = await request(`/authorize?${query}`, {}, cookies)
    expect(start.status).toBe(302)
    expect(start.headers.get('location')).toBe(`${config.issuerUrl}/tracex/authorize`)
    expect(start.headers.getSetCookie().some((cookie) => cookie.includes('Secure'))).toBe(true)
    const provider = await request(start.headers.get('location') ?? '', {}, cookies)
    const login = new URL(provider.headers.get('location') ?? '')
    expect(login.origin).toBe(new URL(config.loginUrl).origin)
    expect(login.searchParams.has('returnUrl')).toBe(false)
    const id = login.searchParams.get('request') ?? ''
    const details = await request(`/requests/${id}`)
    expect(await details.json()).toEqual({ clientName: 'Codex', redirectOrigins: [new URL(redirectUri).origin] })
    const consent = await request(`/requests/${id}/complete`, {
      method: 'POST',
      headers: { Authorization: 'Bearer account-session', Origin: new URL(config.loginUrl).origin }
    })
    expect(consent.status).toBe(200)
    const { continueUrl } = (await consent.json()) as { continueUrl: string }
    expect(continueUrl).toBe(`${config.issuerUrl}/tracex/complete?request=${id}`)
    const complete = await request(continueUrl, {}, cookies)
    expect(complete.status).toBe(302)
    const callback = new URL(complete.headers.get('location') ?? '')
    expect(callback.origin + callback.pathname).toBe(redirectUri)
    expect(callback.searchParams.get('iss')).toBe(config.issuerUrl)
    expect(callback.searchParams.get('state')).toBe('test-state')
    return { code: callback.searchParams.get('code') ?? '', verifier }
  }

  async function token (clientId: string, parameters: Record<string, string>): Promise<Response> {
    return await request('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, resource: config.resourceUrl, ...parameters }).toString()
    })
  }
  async function connect (clientId: string): Promise<{ access_token: string, refresh_token: string }> {
    const { code, verifier } = await authorize(clientId)
    const response = await token(clientId, {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:7777/callback'
    })
    expect(response.status).toBe(200)
    const tokens = (await response.json()) as { access_token: string, refresh_token: string }
    expect(tokens.access_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(JSON.stringify(tokens)).not.toContain('account-session')
    return tokens
  }
  async function resolve (accessToken: string, resource = config.resourceUrl): Promise<Response> {
    return await request('/internal/resolve', {
      method: 'POST',
      headers: { Authorization: 'Bearer internal-service', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: accessToken, resource })
    })
  }

  it('publishes canonical discovery at the origin root with prefixed public endpoints', async () => {
    const path = new URL(config.issuerUrl).pathname.replace(/\/$/, '')
    const discovery = await app.request(`http://openauth.internal:3001/.well-known/oauth-authorization-server${path}`)
    expect(discovery.status).toBe(200)
    expect(await discovery.json()).toMatchObject({
      issuer: config.issuerUrl,
      authorization_endpoint: `${config.issuerUrl}/authorize`,
      token_endpoint: `${config.issuerUrl}/token`,
      registration_endpoint: `${config.issuerUrl}/register`
    })
    if (path !== '') {
      expect((await app.request('http://openauth.internal:3001/register', { method: 'POST' })).status).toBe(404)
    }
  })

  it('preserves a client callback on the same origin without adding the issuer prefix', async () => {
    const callback = `${new URL(config.issuerUrl).origin}/apps/callback`
    const client = await register(callback)
    const { code, verifier } = await authorize(client, callback)
    expect(
      (
        await token(client, {
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: callback
        })
      ).status
    ).toBe(200)
  })

  it('cancels authorization with the public issuer and deletes the cookie at its original path', async () => {
    const client = await register()
    const cookies = new Map<string, string>()
    const query = new URLSearchParams({
      client_id: client,
      redirect_uri: 'http://127.0.0.1:7777/callback',
      response_type: 'code',
      resource: config.resourceUrl,
      state: 'cancel-state',
      code_challenge_method: 'S256',
      code_challenge: 'a'.repeat(43)
    })
    const start = await request(`/authorize?${query}`, {}, cookies)
    const provider = await request(start.headers.get('location') ?? '', {}, cookies)
    const id = new URL(provider.headers.get('location') ?? '').searchParams.get('request') ?? ''
    const cancelled = await request(`/tracex/cancel?request=${id}`, {}, cookies)
    expect(cancelled.status).toBe(302)
    const callback = new URL(cancelled.headers.get('location') ?? '')
    expect(callback.searchParams.get('error')).toBe('access_denied')
    expect(callback.searchParams.get('state')).toBe('cancel-state')
    expect(callback.searchParams.get('iss')).toBe(config.issuerUrl)
    expect(cancelled.headers.getSetCookie().some((cookie) => cookie.includes('Max-Age=0'))).toBe(true)
    expect(await store.get(['login', id])).toBeUndefined()
  })

  it('authorizes, refreshes, and revokes one connection without disabling another', async () => {
    const client = await register()
    const first = await connect(client)
    const second = await connect(client)
    const connection = (await (await resolve(first.access_token)).json()) as {
      connectionId: string
      accountToken: string
    }
    expect(connection.accountToken).toBe('account-session')
    const refresh = await token(client, { grant_type: 'refresh_token', refresh_token: first.refresh_token })
    expect(refresh.status).toBe(200)
    const renewed = (await refresh.json()) as { access_token: string, refresh_token: string }
    expect(renewed.refresh_token).not.toBe(first.refresh_token)
    expect((await resolve(renewed.access_token)).status).toBe(200)
    await request(`/connections/${connection.connectionId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer account-session', Origin: new URL(config.loginUrl).origin }
    })
    expect((await resolve(first.access_token)).status).toBe(401)
    expect((await resolve(renewed.access_token)).status).toBe(401)
    expect((await token(client, { grant_type: 'refresh_token', refresh_token: renewed.refresh_token })).status).toBe(
      400
    )
    expect((await resolve(second.access_token)).status).toBe(200)
  })

  it('binds access to the resource and refresh tokens to the registered client', async () => {
    const client = await register()
    const otherClient = await register()
    const tokens = await connect(client)
    expect((await resolve(tokens.access_token, 'https://staging.example.test/mcp')).status).toBe(401)
    expect(
      (await token(otherClient, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status
    ).toBe(400)
    expect((await token(client, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status).toBe(200)
  })

  it('requires PKCE and consumes an authorization code only once', async () => {
    const client = await register()
    const { code, verifier } = await authorize(client)
    const parameters = {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: 'http://127.0.0.1:7777/callback'
    }
    const responses = await Promise.all([token(client, parameters), token(client, parameters)])
    expect(responses.map((response) => response.status).sort((left, right) => left - right)).toEqual([200, 400])
    const another = await authorize(client)
    expect((await token(client, { ...parameters, code: another.code, code_verifier: 'incorrect' })).status).toBe(400)
  })

  it('rejects access and refresh after the account session expires', async () => {
    const client = await register()
    const tokens = await connect(client)
    sessionActive = false
    expect((await resolve(tokens.access_token)).status).toBe(401)
    expect((await token(client, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token })).status).toBe(400)
  })

  it('does not let another account revoke a connection or read its credentials', async () => {
    const tokens = await connect(await register())
    const { connectionId } = (await (await resolve(tokens.access_token)).json()) as { connectionId: string }
    await request(`/connections/${connectionId}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer other-session', Origin: new URL(config.loginUrl).origin }
    })
    expect((await resolve(tokens.access_token)).status).toBe(200)
    const list = await request('/connections', { headers: { Authorization: 'Bearer account-session' } })
    expect(JSON.stringify(await list.json())).not.toContain('accountToken')
  })

  it('rejects unsafe redirects and cross-origin consent submissions', async () => {
    expect(
      (
        await request('/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ redirect_uris: ['http://attacker.example/callback'] })
        })
      ).status
    ).toBe(400)
    expect(
      (
        await request('/requests/anything/complete', {
          method: 'POST',
          headers: { Authorization: 'Bearer account-session', Origin: 'https://attacker.example' }
        })
      ).status
    ).toBe(403)
    expect(
      (
        await request('/internal/resolve', {
          method: 'POST',
          headers: { Authorization: 'Bearer account-session' }
        })
      ).status
    ).toBe(403)
  })

  it('binds browser completion to the original authorization cookie and consumes it once', async () => {
    const createConnection = jest.spyOn(store, 'createConnection')
    const clientId = await register()
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1:7777/callback',
      response_type: 'code',
      resource: config.resourceUrl,
      state: 'browser-state',
      code_challenge_method: 'S256',
      code_challenge: 'a'.repeat(43)
    })
    const cookies = new Map<string, string>()
    const start = await request(`/authorize?${query}`, {}, cookies)
    const provider = await request(start.headers.get('location') ?? '', {}, cookies)
    const id = new URL(provider.headers.get('location') ?? '').searchParams.get('request') ?? ''
    expect(
      (
        await request(`/requests/${id}/complete`, {
          method: 'POST',
          headers: { Authorization: 'Bearer account-session', Origin: new URL(config.loginUrl).origin }
        })
      ).status
    ).toBe(200)
    expect((await request(`/tracex/complete?request=${id}`)).status).toBe(400)
    expect(createConnection).not.toHaveBeenCalled()
    expect((await request(`/tracex/complete?request=${id}`, {}, cookies)).status).toBe(302)
    expect((await request(`/tracex/complete?request=${id}`, {}, cookies)).status).toBe(400)
    expect(createConnection).toHaveBeenCalledTimes(1)
  })

  it('renews expired access and revokes a connection when an old refresh token is replayed', async () => {
    const clientId = await register()
    const first = await connect(clientId)
    const second = await connect(clientId)
    const now = Date.now()
    const time = jest.spyOn(Date, 'now').mockReturnValue(now + 301_000)
    try {
      expect((await resolve(first.access_token)).status).toBe(401)
      const response = await token(clientId, { grant_type: 'refresh_token', refresh_token: first.refresh_token })
      expect(response.status).toBe(200)
      const renewed = (await response.json()) as { access_token: string }
      expect((await resolve(renewed.access_token)).status).toBe(200)
      time.mockReturnValue(now + 312_000)
      expect((await token(clientId, { grant_type: 'refresh_token', refresh_token: first.refresh_token })).status).toBe(
        400
      )
      expect((await resolve(renewed.access_token)).status).toBe(401)
      expect((await token(clientId, { grant_type: 'refresh_token', refresh_token: second.refresh_token })).status).toBe(
        200
      )
    } finally {
      time.mockRestore()
    }
  })

  it('rejects authorization without PKCE, for an unregistered redirect, or for staging', async () => {
    const clientId = await register()
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'http://127.0.0.1:7777/callback',
      response_type: 'code',
      resource: config.resourceUrl
    })
    expect((await request(`/authorize?${query}`)).status).toBe(400)
    query.set('code_challenge_method', 'S256')
    query.set('code_challenge', 'a'.repeat(43))
    query.set('redirect_uri', 'https://attacker.example/callback')
    expect((await request(`/authorize?${query}`)).status).toBe(400)
    query.set('redirect_uri', 'http://127.0.0.1:7777/callback')
    query.set('resource', 'https://staging.example.test/mcp')
    expect((await request(`/authorize?${query}`)).status).toBe(400)
  })
})
