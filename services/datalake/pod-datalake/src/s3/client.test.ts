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

import { createServer, IncomingMessage } from 'http'
import type { AgentOptions, Server, ServerResponse } from 'http'
import type { Socket } from 'net'
import { createClient } from './client'

// Exercise the production agents with a small pool so three requests reliably create a queue.
jest.mock('http', () => {
  const http = jest.requireActual<typeof import('http')>('http')
  return {
    ...http,
    Agent: class extends http.Agent {
      constructor (options: AgentOptions) {
        super({ ...options, maxSockets: 1 })
      }
    }
  }
})

describe('S3 client socket lifecycle', () => {
  let server: Server
  let client: ReturnType<typeof createClient>
  let port: number
  let statusCode: number
  let sockets: Socket[]
  let heldResponse: ServerResponse | undefined
  let holdResponse: boolean

  beforeEach(async () => {
    statusCode = 200
    sockets = []
    holdResponse = false
    heldResponse = undefined
    server = createServer((request, response) => {
      sockets.push(request.socket)
      response.writeHead(statusCode)
      if (holdResponse) {
        heldResponse = response
        response.write('first')
      } else {
        response.end('data')
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      throw new Error('Expected a TCP address for the test server')
    }
    port = address.port
    client = createClient({
      endpoint: `http://127.0.0.1:${port}`,
      accessKey: 'test',
      secretKey: 'test'
    })
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    client?.destroy()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error !== undefined) reject(error)
        else resolve()
      })
    })
  })

  // Use the configured transport directly to observe each response without SDK retries.
  async function request (method: string = 'GET'): Promise<IncomingMessage> {
    const { response } = await client.config.requestHandler.handle({
      protocol: 'http:',
      hostname: '127.0.0.1',
      port,
      method,
      path: '/',
      headers: {},
      query: {}
    })
    if (!(response.body instanceof IncomingMessage)) {
      throw new Error('Expected a Node.js HTTP response body')
    }
    return response.body
  }

  async function consume (response: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of response) {
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks).toString()
  }

  it.each([200, 404])('reuses healthy queued connections after HTTP %i', async (status) => {
    statusCode = status
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        const response = await request()
        expect(response.statusCode).toBe(status)
        expect(await consume(response)).toBe('data')
      })
    )
    expect(sockets).toHaveLength(3)
    expect(new Set(sockets).size).toBe(1)
  })

  it.each(['GET', 'HEAD'])('discards HTTP 503 connections before queued %s requests', async (method) => {
    statusCode = 503
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        const response = await request(method)
        expect(response.statusCode).toBe(503)
        await consume(response)
      })
    )
    expect(sockets).toHaveLength(3)
    expect(new Set(sockets).size).toBe(3)
  })

  it('expires a connection before handing it to a queued request', async () => {
    let now = Date.now()
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    const first = await request()
    const pending = [request(), request()]
    await new Promise<void>((resolve) => setImmediate(resolve))
    now += 60_000
    expect(await consume(first)).toBe('data')
    await Promise.all(
      pending.map(async (response) => {
        await consume(await response)
      })
    )
    expect(sockets).toHaveLength(3)
    expect(sockets[1]).not.toBe(sockets[0])
    expect(sockets[2]).toBe(sockets[1])
  })

  it('finishes an active response before closing an expired connection', async () => {
    let now = Date.now()
    jest.spyOn(Date, 'now').mockImplementation(() => now)
    holdResponse = true
    const first = await request()
    now += 60_000
    holdResponse = false
    if (heldResponse === undefined) {
      throw new Error('Expected an active streaming response')
    }
    heldResponse.end('last')
    expect(await consume(first)).toBe('firstlast')
    expect(await consume(await request())).toBe('data')
    expect(sockets).toHaveLength(2)
    expect(sockets[1]).not.toBe(sockets[0])
  })
})
