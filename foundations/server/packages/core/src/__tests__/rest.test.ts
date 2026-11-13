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
import { createServer, request, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { ApiError } from '../apiError'
import { setAuditEventWriter, type AuditRecord } from '../audit'
import {
  accountLookupError,
  createErrorHandler,
  notifyAfterCompletion,
  sendApiError,
  withAuditedResponse
} from '../rest'
import { classifyApiError } from '../apiError'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'

const ctx = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as MeasureContext
let records: AuditRecord[] = []

beforeEach(() => {
  records = []
  jest.clearAllMocks()
  setAuditEventWriter('test', async (_ctx, record) => {
    records.push(record)
  })
})
afterAll(() => {
  setAuditEventWriter('test', undefined)
})

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

async function withServer (handler: Handler, run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer((req, res) => {
    void handler(req, res).catch((err) => {
      sendApiError(err, res)
    })
  })
  server.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${port}`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

async function call (url: string, abortAfterHeaders = false): Promise<{ status: number, body: string }> {
  return await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST' }, (res) => {
      if (abortAfterHeaders) {
        req.destroy()
        resolve({ status: res.statusCode ?? 0, body: '' })
        return
      }
      let body = ''
      res.on('data', (chunk) => (body += String(chunk)))
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body })
      })
      res.on('error', reject)
    })
    req.on('error', (err) => {
      if (!abortAfterHeaders) reject(err)
    })
    req.end()
  })
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 30))
}

describe('withAuditedResponse', () => {
  const event = { event: 'document.export', workspaceUuid: 'ws' } as const

  test('records success with the details the action set', async () => {
    await withServer(
      async (_req, res) => {
        await withAuditedResponse(ctx, event, res, async (audit) => {
          audit.set({ format: 'md' })
          res.end('ok')
        })
      },
      async (url) => {
        expect((await call(url)).status).toBe(200)
      }
    )
    expect(records[0]).toMatchObject({ outcome: 'succeeded', format: 'md', workspaceUuid: 'ws' })
  })

  test.each([
    [new ApiError(403, 'Owner role required', { reason: 'not_owner' }), 'denied', 'not_owner'],
    [new TypeError('connect ECONNREFUSED 10.0.0.5:5432'), 'failed', 'TypeError']
  ])('propagates %p unchanged and audits its outcome', async (error, outcome, errorCode) => {
    const res: Partial<ServerResponse> = {}
    await expect(
      withAuditedResponse(ctx, event, res as ServerResponse, async () => {
        throw error
      })
    ).rejects.toBe(error)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ outcome, errorCode })
    expect(JSON.stringify(records)).not.toContain(error.message)
  })

  test('records a download the client abandoned as interrupted', async () => {
    let done: () => void = () => {}
    const finished = new Promise<void>((resolve) => {
      done = resolve
    })
    await withServer(
      async (_req, res) => {
        await withAuditedResponse(ctx, event, res, async () => {
          res.writeHead(200, { 'content-type': 'application/octet-stream' })
          res.write('part')
          await new Promise<void>((resolve) =>
            res.once('close', () => {
              resolve()
            })
          )
        })
        done()
      },
      async (url) => {
        await call(url, true)
        await finished
      }
    )
    await settle()
    expect(records[0]).toMatchObject({ outcome: 'failed', errorCode: 'download_interrupted' })
  })
})

describe('sendApiError / createErrorHandler', () => {
  test('aborts a partly sent response instead of ending it as complete', async () => {
    await withServer(
      async (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.write('part')
        createErrorHandler(ctx)(new Error('storage stream failed'), undefined, res, undefined)
      },
      async (url) => {
        await expect(call(url)).rejects.toThrow()
      }
    )
    expect(ctx.warn).toHaveBeenCalled()
  })

  test('sends non-ApiError failures as 500 with their message', async () => {
    await withServer(
      async (_req, res) => {
        sendApiError(new Error('boom'), res)
      },
      async (url) => {
        const res = await call(url)
        expect(res.status).toBe(500)
        expect(JSON.parse(res.body)).toEqual({ message: 'boom' })
      }
    )
  })
})

test('a failed follow-up notification is logged and does not fail the completed operation', async () => {
  const failure = new Error('notification service down')
  await expect(
    notifyAfterCompletion(ctx, 'Failed to send notification', async () => {
      throw failure
    })
  ).resolves.toBeUndefined()
  expect(ctx.error).toHaveBeenCalledWith('Failed to send notification', { err: failure })
  const send = jest.fn(async () => {})
  await notifyAfterCompletion(ctx, 'unused', send)
  expect(send).toHaveBeenCalledTimes(1)
  expect(ctx.error).toHaveBeenCalledTimes(1)
})

test('an account-service answer is a denial, an unreachable service is a failure', () => {
  const answered = accountLookupError(new PlatformError(new Status(Severity.ERROR, platform.status.Unauthorized, {})))
  expect(answered.code).toBe(401)
  expect(answered.message).toBe('Invalid workspace')
  expect(classifyApiError(answered)).toEqual({ outcome: 'denied', errorCode: 'invalid_workspace' })

  const outage = accountLookupError(new TypeError('fetch failed'))
  expect(outage.code).toBe(503)
  expect(classifyApiError(outage)).toEqual({ outcome: 'failed', errorCode: 'account_lookup_failed' })
})
