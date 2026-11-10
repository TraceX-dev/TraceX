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
import { setMetadata } from '@hcengineering/platform'
import { setAuditEventWriter, type AuditRecord } from '@hcengineering/server-core'
import serverToken, { generateToken } from '@hcengineering/server-token'
import { auditExportEvent, auditFailure, hasQueryFilter } from '../audit'
import { ApiError } from '../error'

const ctx = new MeasureMetricsContext('test', {})
const account = '00000000-0000-4000-8000-000000000001' as AccountUuid
const source = '00000000-0000-4000-8000-0000000000a1' as WorkspaceUuid
const target = '00000000-0000-4000-8000-0000000000b2' as WorkspaceUuid

let records: AuditRecord[] = []

beforeAll(() => {
  setMetadata(serverToken.metadata.Secret, 'secret')
})

beforeEach(() => {
  records = []
  setAuditEventWriter('export', async (_ctx, record) => {
    records.push(record)
  })
})

afterAll(() => {
  setAuditEventWriter('export', undefined)
})

test('attributes the event to the verified token caller and workspace', async () => {
  const token = generateToken(account, source, { admin: 'true' })
  await auditExportEvent(ctx, token, { event: 'workspace.data.export', mode: 'sync', format: 'csv' })
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    event: 'workspace.data.export',
    outcome: 'succeeded',
    sourceService: 'export',
    actorAccountUuid: account,
    workspaceUuid: source,
    actorIsAdmin: true,
    actorUsesApiKey: false,
    mode: 'sync',
    format: 'csv'
  })
})

test('an explicit workspace overrides the token workspace for the transfer target journal', async () => {
  const token = generateToken(account, source)
  await auditExportEvent(ctx, token, {
    event: 'workspace.data.transfer',
    workspaceUuid: target,
    direction: 'incoming',
    targetId: source
  })
  expect(records[0]).toMatchObject({ workspaceUuid: target, actorAccountUuid: account, direction: 'incoming' })
})

test('an invalid token still records the event without an actor', async () => {
  await auditExportEvent(ctx, 'not-a-token', { event: 'document.export', workspaceUuid: source, outcome: 'failed' })
  expect(records[0]).toMatchObject({ event: 'document.export', workspaceUuid: source, outcome: 'failed' })
  expect(records[0].actorAccountUuid).toBeUndefined()
})

test('classifies failures without leaking error messages', () => {
  expect(auditFailure(new ApiError(403, 'secret detail'))).toEqual({ outcome: 'denied', errorCode: '403' })
  expect(auditFailure(new ApiError(401))).toEqual({ outcome: 'denied', errorCode: '401' })
  expect(auditFailure(new ApiError(404, 'Document not found'))).toEqual({ outcome: 'failed', errorCode: '404' })
  expect(auditFailure(new TypeError('boom /etc/passwd'))).toEqual({ outcome: 'failed', errorCode: 'TypeError' })
  expect(auditFailure('weird')).toEqual({ outcome: 'failed', errorCode: 'UnknownError' })
})

test('detects whether an export was filtered', () => {
  expect(hasQueryFilter(undefined)).toBe(false)
  expect(hasQueryFilter({})).toBe(false)
  expect(hasQueryFilter({ space: 'x' } as any)).toBe(true)
})
