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

import type { WorkspaceUuid } from '@hcengineering/core'
import type { AuditRecord } from '@hcengineering/server-core'
import type { Sql } from 'postgres'
import { decodeAuditAttributes, PostgresAuditEventStore } from '../collections/postgres/audit-store'

const record: AuditRecord = {
  schemaVersion: 1,
  eventId: '00000000-0000-4000-8000-000000000001',
  occurredAt: 1000,
  sourceService: 'export',
  event: 'workspace.data.export',
  outcome: 'succeeded',
  workspaceUuid: 'workspace-a',
  mode: 'async',
  format: 'csv',
  attributesOnly: false
}

function fakeSql (rows: unknown[] = []): { sql: Sql, unsafe: jest.Mock, json: jest.Mock } {
  const json = jest.fn((value: unknown) => ({ jsonParameter: value }))
  const unsafe = jest.fn(async () => rows)
  return { sql: { json, unsafe } as unknown as Sql, unsafe, json }
}

test('stores attributes as a jsonb object parameter, not a pre-serialized string', async () => {
  const { sql, unsafe, json } = fakeSql()
  await new PostgresAuditEventStore(sql, 'ns').insert(record)
  expect(json).toHaveBeenCalledWith({ mode: 'async', format: 'csv', attributesOnly: false })
  const params = unsafe.mock.calls[0][1] as unknown[]
  expect(params[12]).toEqual({ jsonParameter: { mode: 'async', format: 'csv', attributesOnly: false } })
  expect(params.some((p) => typeof p === 'string' && p.includes('"mode"'))).toBe(false)
})

test('reads both correctly stored and legacy double-encoded attributes', async () => {
  const envelope = {
    schemaVersion: 1,
    eventId: record.eventId,
    occurredAt: '1000',
    sourceService: 'export',
    event: 'workspace.data.export',
    outcome: 'succeeded',
    workspaceUuid: 'workspace-a'
  }
  const { sql } = fakeSql([
    { ...envelope, attributes: { format: 'csv' } },
    { ...envelope, attributes: JSON.stringify({ format: 'json', eventId: 'spoofed' }) }
  ])
  const rows = await new PostgresAuditEventStore(sql, 'ns').findWorkspace('workspace-a' as WorkspaceUuid, {
    from: 0,
    to: 2000
  })
  expect(rows[0]).toMatchObject({ format: 'csv', occurredAt: 1000 })
  expect(rows[1]).toMatchObject({ format: 'json', eventId: record.eventId })
  expect(Object.keys(rows[1])).not.toContain('0')
})

test('never turns a malformed value into character keys', () => {
  expect(decodeAuditAttributes('not json')).toEqual({})
  expect(decodeAuditAttributes(JSON.stringify('still a string'))).toEqual({})
  expect(decodeAuditAttributes(JSON.stringify([1, 2]))).toEqual({})
  expect(decodeAuditAttributes(null)).toEqual({})
})
