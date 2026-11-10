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

import { MeasureMetricsContext, type AccountUuid, type WorkspaceUuid } from '@hcengineering/core'
import { setAuditEventWriter, type AuditRecord } from '@hcengineering/server-core'
import type { Token } from '@hcengineering/server-token'
import { EventEmitter } from 'events'
import { auditBackupEvent, onResponseSettled, type BackupAuditOutcome } from '../audit'

const ctx = new MeasureMetricsContext('test', {})
const token: Token = {
  account: '00000000-0000-4000-8000-000000000001' as AccountUuid,
  workspace: '00000000-0000-4000-8000-0000000000a1' as WorkspaceUuid,
  extra: {}
}

let records: AuditRecord[] = []

beforeEach(() => {
  records = []
  setAuditEventWriter('backup-api', async (_ctx, record) => {
    records.push(record)
  })
})

afterAll(() => {
  setAuditEventWriter('backup-api', undefined)
})

test('records a backup download in the token workspace journal', async () => {
  await auditBackupEvent(ctx, token, { outcome: 'succeeded', fileName: 'tx-0001.tar.gz', fileSize: 42 })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    event: 'workspace.backup.download',
    sourceService: 'backup-api',
    outcome: 'succeeded',
    actorAccountUuid: token.account,
    workspaceUuid: token.workspace,
    actorIsAdmin: false,
    targetType: 'backup',
    fileName: 'tx-0001.tar.gz',
    fileSize: 42
  })
})

test('records denials with a reason code', async () => {
  await auditBackupEvent(
    ctx,
    { ...token, extra: { admin: 'true' } },
    {
      outcome: 'denied',
      errorCode: 'not_workspace_owner',
      fileName: 'x'
    }
  )
  expect(records[0]).toMatchObject({ outcome: 'denied', errorCode: 'not_workspace_owner', actorIsAdmin: true })
})

describe('onResponseSettled', () => {
  const run = (emit: (res: EventEmitter, source: EventEmitter) => void): Array<[BackupAuditOutcome, string?]> => {
    const res = new EventEmitter()
    const source = new EventEmitter()
    const calls: Array<[BackupAuditOutcome, string?]> = []
    onResponseSettled(res, source, (outcome, errorCode) => calls.push([outcome, errorCode]))
    emit(res, source)
    return calls
  }

  test('a completed download succeeds once even though close follows finish', () => {
    expect(
      run((res) => {
        res.emit('finish')
        res.emit('close')
      })
    ).toEqual([['succeeded', undefined]])
  })

  test('a client disconnect before finish is an interrupted download', () => {
    expect(
      run((res) => {
        res.emit('close')
        res.emit('finish')
      })
    ).toEqual([['failed', 'download_interrupted']])
  })

  test('a storage stream error fails the download with the error type only', () => {
    expect(
      run((res, source) => {
        source.emit('error', new RangeError('bucket path /secret'))
        res.emit('close')
      })
    ).toEqual([['failed', 'RangeError']])
  })
})
