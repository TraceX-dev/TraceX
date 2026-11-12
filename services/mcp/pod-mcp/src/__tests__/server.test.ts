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

import type { MeasureContext } from '@hcengineering/core'
import { get, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { McpConfig } from '../config'
import { createServer, toToolResult } from '../server'
import type { WorkspaceManager } from '../workspace'

jest.mock('@hcengineering/ai-tools', () => ({ tools: [] }))

describe('MCP tool naming', () => {
  it.each([
    ['input_format_error', 'not_applied'],
    ['STALE_REFERENCE', 'unknown']
  ])('preserves collaborative error metadata for %s', (code, outcome) => {
    const tool: Partial<Parameters<typeof toToolResult>[0]> = { name: 'collab_apply' }
    const result: Parameters<typeof toToolResult>[1] = {
      ok: false,
      error: { code, message: 'Cannot apply changes' }
    }
    const output = toToolResult(tool as Parameters<typeof toToolResult>[0], result)

    expect(output.isError).toBe(true)
    expect(output.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ error: { outcome, code, message: 'Cannot apply changes', retryable: false } }, null, 2)
      }
    ])
  })
})

describe.each(['/mcp', '/services/mcp'])('MCP HTTP routing at %s', (path) => {
  const config: McpConfig = {
    AccountsURL: 'http://accounts.internal',
    ServerSecret: 'test-only',
    CollaboratorURL: 'http://collaborator.internal',
    Port: 0,
    ServiceID: 'test',
    WorkspaceClientCacheMs: 0,
    OAuthIssuerURL: 'https://stage.example.test/oauth',
    OAuthInternalURL: 'http://openauth.internal:3001/oauth',
    OAuthResourceURL: `https://stage.example.test${path}`,
    OAuthAllowHttp: false
  }
  let server: Server | undefined
  let address: string

  beforeAll(async () => {
    const manager: Partial<WorkspaceManager> = {}
    const context: Partial<MeasureContext> = { error: jest.fn() }
    const app = createServer(config, manager as WorkspaceManager, context as MeasureContext)
    server = await new Promise<Server>((resolve, reject) => {
      const listening = app.listen(0, '127.0.0.1', () => {
        resolve(listening)
      })
      listening.once('error', reject)
    })
    address = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    if (server !== undefined) {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => {
          error !== undefined ? reject(error) : resolve()
        })
      )
    }
  })

  async function request (route: string): Promise<Response> {
    // Native HTTP preserves the proxy's Host header; fetch replaces it with the loopback host.
    return await new Promise<Response>((resolve, reject) => {
      const request = get(`${address}${route}`, { headers: { Host: 'stage.example.test' } }, (response) => {
        const headers = new Headers()
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) {
            for (const entry of value) headers.append(name, entry)
          } else if (value !== undefined) headers.set(name, value)
        }
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk: string) => {
          body += chunk
        })
        response.once('error', reject)
        response.once('end', () => {
          resolve(new Response(body, { status: response.statusCode, headers }))
        })
      })
      request.once('error', reject)
    })
  }

  it('advertises discovery at the domain root for the configured resource path', async () => {
    const unauthorized = await request(path)
    expect(unauthorized.status).toBe(401)
    const metadataPath = `/.well-known/oauth-protected-resource${path}`
    expect(unauthorized.headers.get('WWW-Authenticate')).toContain(`https://stage.example.test${metadataPath}`)
    const discovery = await request(metadataPath)
    expect(discovery.status).toBe(200)
    expect(await discovery.json()).toMatchObject({
      resource: config.OAuthResourceURL,
      authorization_servers: [config.OAuthIssuerURL]
    })
    if (path !== '/mcp') expect((await request('/mcp')).status).toBe(404)
  })
})
