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
import { decodeToken } from '@hcengineering/server-token'
import { createMcpTokenVerifier } from '../auth'
import type { McpConfig } from '../config'

const config: McpConfig = {
  AccountsURL: 'http://accounts.test',
  ServerSecret: 'test-only',
  CollaboratorURL: 'http://collaborator.test',
  Port: 4020,
  ServiceID: 'test',
  WorkspaceClientCacheMs: 60_000,
  OAuthIssuerURL: 'https://auth.test',
  OAuthInternalURL: 'http://auth-internal.test',
  OAuthResourceURL: 'https://mcp.test/mcp',
  OAuthAllowHttp: false
}

describe('opaque MCP OAuth tokens', () => {
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
  const originalFetch = global.fetch
  beforeEach(() => {
    fetchMock.mockReset()
    global.fetch = fetchMock
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  function resolved (resource = config.OAuthResourceURL): Response {
    return Response.json({
      connectionId: 'connection-id',
      account: 'account-id',
      accountToken: 'private-account-token',
      clientId: 'client-id',
      resource,
      expiresAt: Math.floor(Date.now() / 1000) + 300
    })
  }

  it('authenticates the internal exchange with a short-lived service token', async () => {
    fetchMock.mockResolvedValue(resolved())
    const result = await createMcpTokenVerifier(config).verifyAccessToken('opaque-client-token')
    expect(result.resource?.toString()).toBe(config.OAuthResourceURL)
    expect(result.extra?.accountToken).toBe('private-account-token')
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe(`${config.OAuthInternalURL}/internal/resolve`)
    const serviceToken = String(new Headers(options?.headers).get('Authorization')).slice('Bearer '.length)
    const service = decodeToken(serviceToken, true, config.ServerSecret)
    expect(service.account).toBe(systemAccountUuid)
    expect(service.extra?.service).toBe('mcp-oauth')
    expect(service.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 60)
    expect(JSON.parse(String(options?.body))).toEqual({
      token: 'opaque-client-token',
      resource: config.OAuthResourceURL
    })
  })

  it('checks every request again and rejects a revoked token without a legacy-token fallback', async () => {
    fetchMock.mockResolvedValueOnce(resolved()).mockResolvedValueOnce(new Response(null, { status: 401 }))
    const verifier = createMcpTokenVerifier(config)
    await verifier.verifyAccessToken('same-client-token')
    await expect(verifier.verifyAccessToken('same-client-token')).rejects.toThrow('Invalid or revoked')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects another resource and does not treat issuer outages as expired credentials', async () => {
    const verifier = createMcpTokenVerifier(config)
    fetchMock.mockResolvedValueOnce(resolved('https://staging.test/mcp'))
    await expect(verifier.verifyAccessToken('client-token')).rejects.toThrow('Invalid response')
    fetchMock.mockResolvedValueOnce(new Response('internal-sensitive-details', { status: 500 }))
    await expect(verifier.verifyAccessToken('client-token')).rejects.toThrow('authorization service is unavailable')
  })
})
