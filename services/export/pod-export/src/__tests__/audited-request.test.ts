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

import { MeasureMetricsContext } from '@hcengineering/core'
import { ApiError, createErrorHandler, setAuditEventWriter, type AuditRecord } from '@hcengineering/server-core'
import express, { type Express } from 'express'
import type { AddressInfo } from 'net'
import { request } from 'http'
import { setMetadata } from '@hcengineering/platform'
import serverToken, { generateToken } from '@hcengineering/server-token'
import type { AccountUuid, WorkspaceUuid } from '@hcengineering/core'

process.env.SECRET = 'secret'
process.env.ACCOUNTS_URL = 'http://accounts.invalid'
process.env.SERVICE_ID = 'export-test'
process.env.DB_URL = 'postgresql://invalid'

const workspace = '00000000-0000-4000-8000-0000000000a1'
jest.mock('@hcengineering/server-client', () => ({
  ...jest.requireActual('@hcengineering/server-client'),
  getAccountClient: () => ({
    getLoginInfoByToken: async () => ({ workspace, workspaceDataId: workspace, workspaceUrl: 'ws', socialId: 'social' })
  })
}))

const { auditedRequest, hasQueryFilter } = require('../server') as typeof import('../server')

const ctx = new MeasureMetricsContext('test', {})
let records: AuditRecord[] = []

async function serve (setup: (app: Express) => void): Promise<{ url: string, close: () => Promise<void> }> {
  const app = express()
  setup(app)
  app.use(createErrorHandler(ctx))
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

async function call (
  url: string,
  abortAfterHeaders = false,
  token = 'token'
): Promise<{ status: number, body: string }> {
  return await new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, (res) => {
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
    })
    req.on('error', (err) => {
      if (!abortAfterHeaders) reject(err)
    })
    req.end()
  })
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

beforeEach(() => {
  records = []
  setAuditEventWriter('export', async (_ctx, record) => {
    records.push(record)
  })
})

test('records success with handler details in the caller workspace', async () => {
  const { url, close } = await serve((app) =>
    app.post(
      '/x',
      auditedRequest(ctx, 'document.export', 'Failed', async (_req, res, _ws, _token, _social, audit) => {
        audit.set({ format: 'md' })
        res.send('ok')
      })
    )
  )
  try {
    expect((await call(`${url}/x`)).status).toBe(200)
    await settle()
    expect(records[0]).toMatchObject({ event: 'document.export', outcome: 'succeeded', workspaceUuid: workspace })
    expect(records[0].format).toBe('md')
  } finally {
    await close()
  }
})

test('keeps denials as thrown and hides unexpected error messages behind the fallback', async () => {
  const { url, close } = await serve((app) => {
    app.post(
      '/denied',
      auditedRequest(ctx, 'workspace.data.transfer', 'Transfer failed', async () => {
        throw new ApiError(403, 'Owner role required', { reason: 'not_target_owner' })
      })
    )
    app.post(
      '/crash',
      auditedRequest(ctx, 'workspace.data.transfer', 'Transfer failed', async () => {
        throw new TypeError('connect ECONNREFUSED 10.0.0.5:5432')
      })
    )
  })
  try {
    const denied = await call(`${url}/denied`)
    expect(denied.status).toBe(403)
    expect(denied.body).toContain('Owner role required')
    const crash = await call(`${url}/crash`)
    expect(crash.status).toBe(500)
    expect(crash.body).toContain('Transfer failed')
    expect(crash.body).not.toContain('ECONNREFUSED')
    await settle()
    expect(records.map((r) => [r.outcome, r.errorCode])).toEqual([
      ['denied', 'not_target_owner'],
      ['failed', 'TypeError']
    ])
  } finally {
    await close()
  }
})

test('records a download the client abandoned as interrupted', async () => {
  let finished!: () => void
  const handlerDone = new Promise<void>((resolve) => {
    finished = resolve
  })
  const { url, close } = await serve((app) =>
    app.post(
      '/download',
      auditedRequest(ctx, 'workspace.data.export', 'Failed', async (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/octet-stream' })
        res.write('part')
        await new Promise<void>((resolve) =>
          res.once('close', () => {
            resolve()
          })
        )
        finished()
      })
    )
  )
  try {
    await call(`${url}/download`, true)
    await handlerDone
    await settle()
    expect(records[0]).toMatchObject({ outcome: 'failed', errorCode: 'download_interrupted' })
  } finally {
    await close()
  }
})

test('attributes the event to the token caller and mirrors it into a verified target journal', async () => {
  setMetadata(serverToken.metadata.Secret, 'secret')
  const account = '00000000-0000-4000-8000-000000000001' as AccountUuid
  const target = '00000000-0000-4000-8000-0000000000b2'
  const token = generateToken(account, workspace as WorkspaceUuid)
  const { url, close } = await serve((app) =>
    app.post(
      '/transfer',
      auditedRequest(ctx, 'workspace.data.transfer', 'Failed', async (_req, res, wsIds, _token, _social, audit) => {
        audit.set({ direction: 'outgoing', targetId: target })
        audit.mirror(target, { direction: 'incoming', targetId: wsIds.uuid })
        res.send('ok')
      })
    )
  )
  try {
    expect((await call(`${url}/transfer`, false, token)).status).toBe(200)
    await settle()
    expect(records.map((r) => [r.workspaceUuid, r.direction, r.actorAccountUuid, r.outcome])).toEqual([
      [workspace, 'outgoing', account, 'succeeded'],
      [target, 'incoming', account, 'succeeded']
    ])
  } finally {
    await close()
  }
})

test('detects whether an export was filtered', () => {
  expect(hasQueryFilter(undefined)).toBe(false)
  expect(hasQueryFilter({})).toBe(false)
  expect(hasQueryFilter({ space: 'x' } as any)).toBe(true)
})
