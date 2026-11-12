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

import { AccountRole, type AccountUuid, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import {
  classifyApiError,
  sendApiError,
  setAuditEventWriter,
  withAuditedResponse,
  type AuditRecord
} from '@hcengineering/server-core'
import type { Token } from '@hcengineering/server-token'
import { createServer, request, type IncomingHttpHeaders } from 'http'
import type { AddressInfo } from 'net'
import { PassThrough, Readable } from 'stream'
import { authorizeBackupAccess, sendBackupFile } from '../backup-access'

const account = '00000000-0000-4000-8000-000000000001' as AccountUuid
const workspace = '00000000-0000-4000-8000-0000000000a1' as WorkspaceUuid
const token: Token = { account, workspace, extra: {} }

function accountClient (role: AccountRole | undefined): any {
  return {
    getLoginWithWorkspaceInfo: jest.fn(async () => ({
      workspaces: role === undefined ? {} : { [workspace]: { role } }
    })),
    getWorkspaceInfo: jest.fn(async () => ({ url: 'ws', dataId: 'data' }))
  }
}

describe('authorizeBackupAccess', () => {
  test('lets an owner in and caches the result for that account only', async () => {
    const cache = new Map()
    const owner = accountClient(AccountRole.Owner)
    expect(await authorizeBackupAccess(token, owner, cache)).toEqual({ url: 'ws', dataId: 'data', uuid: workspace })
    await authorizeBackupAccess(token, owner, cache)
    expect(owner.getLoginWithWorkspaceInfo).toHaveBeenCalledTimes(1)

    // Another member of the same workspace must not reuse the owner's cached check.
    const member = accountClient(AccountRole.User)
    const memberToken: Token = { ...token, account: '00000000-0000-4000-8000-000000000002' as AccountUuid }
    await expect(authorizeBackupAccess(memberToken, member, cache)).rejects.toMatchObject({
      code: 403,
      reason: 'not_workspace_owner'
    })
    expect(member.getLoginWithWorkspaceInfo).toHaveBeenCalledTimes(1)
  })

  test('denies non-members and lets instance admins in', async () => {
    await expect(authorizeBackupAccess(token, accountClient(undefined), new Map())).rejects.toMatchObject({
      code: 401,
      reason: 'not_workspace_member'
    })
    const admin: Token = { ...token, extra: { admin: 'true' } }
    await expect(authorizeBackupAccess(admin, accountClient(undefined), new Map())).resolves.toMatchObject({
      uuid: workspace
    })
  })

  test('an unreachable account service is a failure, an account-service answer is a denial', async () => {
    const outage = accountClient(AccountRole.Owner)
    outage.getLoginWithWorkspaceInfo.mockRejectedValue(new TypeError('fetch failed'))
    const failure = await authorizeBackupAccess(token, outage, new Map()).catch((err) => err)
    expect(classifyApiError(failure)).toEqual({ outcome: 'failed', errorCode: 'account_lookup_failed' })

    const rejected = accountClient(AccountRole.Owner)
    rejected.getLoginWithWorkspaceInfo.mockRejectedValue(
      new PlatformError(new Status(Severity.ERROR, platform.status.Unauthorized, {}))
    )
    const denial = await authorizeBackupAccess(token, rejected, new Map()).catch((err) => err)
    expect(classifyApiError(denial)).toEqual({ outcome: 'denied', errorCode: 'invalid_workspace' })
  })
})

describe('sendBackupFile', () => {
  const ctx = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as MeasureContext
  let records: AuditRecord[] = []
  const fileInfo = { size: 4, etag: 'etag-1', lastModified: 1000, contentType: 'application/gzip' }

  beforeEach(() => {
    records = []
    setAuditEventWriter('backup-api', async (_ctx, record) => {
      records.push(record)
    })
  })
  afterAll(() => {
    setAuditEventWriter('backup-api', undefined)
  })

  async function serve (storage: any, run: (url: string) => Promise<void>, file = 'tx-0001.tar.gz'): Promise<void> {
    const server = createServer((req, res) => {
      const event = { event: 'workspace.backup.download', workspaceUuid: workspace, fileName: file } as const
      void withAuditedResponse(
        ctx,
        event,
        res,
        async (audit) => {
          await sendBackupFile(storage, file, req.headers, res, audit)
        },
        'Backup request failed'
      ).catch((err) => {
        sendApiError(err, res)
      })
    })
    server.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    } finally {
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
    }
  }

  async function get (
    url: string,
    headers: IncomingHttpHeaders = {},
    abortAfterHeaders = false
  ): Promise<{ status: number, body: string }> {
    return await new Promise((resolve, reject) => {
      const req = request(url, { headers }, (res) => {
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

  test('records a completed download with the file size', async () => {
    const storage = { statInfo: async () => fileInfo, load: async () => Readable.from([Buffer.from('data')]) }
    await serve(storage, async (url) => {
      expect(await get(url)).toEqual({ status: 200, body: 'data' })
    })
    await settle()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ outcome: 'succeeded', fileName: 'tx-0001.tar.gz', fileSize: 4 })
  })

  test('a 304 revalidation is not recorded as a download', async () => {
    const storage = { statInfo: async () => fileInfo, load: jest.fn() }
    await serve(storage, async (url) => {
      expect((await get(url, { 'if-none-match': 'etag-1' })).status).toBe(304)
    })
    await settle()
    expect(storage.load).not.toHaveBeenCalled()
    expect(records).toHaveLength(0)
  })

  test('records an abandoned download as interrupted and releases the storage stream', async () => {
    const source = new PassThrough()
    source.write('part')
    const storage = { statInfo: async () => fileInfo, load: async () => source }
    await serve(storage, async (url) => {
      await get(url, {}, true)
      await settle()
    })
    expect(records[0]).toMatchObject({ outcome: 'failed', errorCode: 'download_interrupted' })
    expect(source.destroyed).toBe(true)
  })

  test('a storage stream error fails the download with the error type only', async () => {
    const source = new PassThrough()
    const storage = { statInfo: async () => fileInfo, load: async () => source }
    await serve(storage, async (url) => {
      const pending = get(url).catch((err) => err)
      await settle()
      source.destroy(new RangeError('bucket path /secret'))
      await pending
    })
    await settle()
    expect(records[0]).toMatchObject({ outcome: 'failed', errorCode: 'RangeError' })
    expect(JSON.stringify(records)).not.toContain('/secret')
  })

  test('a missing file is a failed download, not a crash', async () => {
    const storage = { statInfo: async () => undefined, load: jest.fn() }
    await serve(storage, async (url) => {
      const res = await get(url)
      expect(res.status).toBe(404)
      expect(JSON.parse(res.body)).toEqual({ code: 404, message: 'Not found' })
    })
    await settle()
    expect(records[0]).toMatchObject({ outcome: 'failed', errorCode: 'not_found' })
  })
})
