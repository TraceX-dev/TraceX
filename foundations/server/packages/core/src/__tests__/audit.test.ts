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

import { hashAuditValue, recordAuditEvent, withAuditEvent } from '../audit'

const logs: Pick<MeasureContext, 'info' | 'warn' | 'error'> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const ctx = logs as MeasureContext

beforeEach(() => jest.resetAllMocks())

test('records a custom domain event without registration and preserves its identifiers', () => {
  recordAuditEvent(ctx, { event: 'document.publish', actorAccountUuid: 'actor', documentId: 'document' })
  recordAuditEvent(ctx, { event: 'document.publish', actorAccountUuid: 'actor', documentId: 'document' })
  const records = (logs.info as jest.Mock).mock.calls.map(([, fields]) => fields)
  expect(records[0]).toMatchObject({
    audit: true,
    event: 'document.publish',
    outcome: 'succeeded',
    actorAccountUuid: 'actor',
    documentId: 'document'
  })
  expect(records[0].eventId).toMatch(/^[a-f0-9-]{36}$/)
  expect(records[0].eventId).not.toBe(records[1].eventId)
})

test.each(['denied', 'failed'] as const)('routes %s outcomes at the appropriate severity', (outcome) => {
  recordAuditEvent(ctx, { event: 'document.publish', outcome })
  expect(outcome === 'denied' ? logs.warn : logs.error).toHaveBeenCalledWith(
    'Audit event',
    expect.objectContaining({ outcome })
  )
  expect(logs.info).not.toHaveBeenCalled()
})

test('audits only the settled action and never exports its returned credentials', async () => {
  const result: Record<string, string> = { token: 'private-token' }
  let resolveAction: (value: Record<string, string>) => void = () => {}
  const action = new Promise<Record<string, string>>((resolve) => {
    resolveAction = resolve
  })
  const pending = withAuditEvent(ctx, { event: 'custom.operation' }, async () => await action)
  expect(logs.info).not.toHaveBeenCalled()
  resolveAction(result)
  expect(await pending).toBe(result)
  expect(logs.info).toHaveBeenCalledTimes(1)
  expect(JSON.stringify((logs.info as jest.Mock).mock.calls)).not.toContain('private-token')
})

test('preserves the original action error and exports only its type', async () => {
  const error = new TypeError('private database credentials')
  await expect(
    withAuditEvent(ctx, { event: 'workspace.data.cleanup' }, async () => {
      throw error
    })
  ).rejects.toBe(error)
  expect(logs.info).not.toHaveBeenCalled()
  expect(logs.error).toHaveBeenCalledWith(
    'Audit event',
    expect.objectContaining({ outcome: 'failed', errorType: 'TypeError' })
  )
  expect(JSON.stringify((logs.error as jest.Mock).mock.calls)).not.toContain(error.message)
})

test('isolates logger failures from both action results and errors', async () => {
  ;(logs.info as jest.Mock).mockImplementation(() => {
    throw new Error('logger unavailable')
  })
  ;(logs.error as jest.Mock).mockImplementation(() => {
    throw new Error('logger unavailable')
  })
  await expect(withAuditEvent(ctx, { event: 'custom.operation' }, async () => 42)).resolves.toBe(42)
  const error = new Error('original error')
  await expect(
    withAuditEvent(ctx, { event: 'custom.operation' }, async () => {
      throw error
    })
  ).rejects.toBe(error)
})

test('hashes explicit identifiers with a key and scope, omitting values without a key', () => {
  const hash = hashAuditValue('private@example.com', 'email', 'test-key')
  expect(hash).toMatch(/^[a-f0-9]{64}$/)
  expect(hash).toBe(hashAuditValue('private@example.com', 'email', 'test-key'))
  expect(hash).not.toBe(hashAuditValue('private@example.com', 'email', 'other-key'))
  expect(hash).not.toBe(hashAuditValue('private@example.com', 'other-scope', 'test-key'))
  expect(hashAuditValue('private@example.com', 'email', undefined)).toBeUndefined()
})
