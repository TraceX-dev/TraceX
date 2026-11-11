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
import {
  auditActorFromToken,
  hashAuditValue,
  recordAuditEvent,
  setAuditEventWriter,
  startAuditPublisher,
  withAuditEvent
} from '../audit'
import { setMetadata } from '@hcengineering/platform'
import serverToken, { generateToken } from '@hcengineering/server-token'
import type { AccountUuid, WorkspaceUuid } from '@hcengineering/core'
import type { AuditRecord } from '../audit'
import type { PlatformQueue, PlatformQueueProducer } from '../queue/types'

const logs: Pick<MeasureContext, 'info' | 'warn' | 'error'> = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
const ctx = logs as MeasureContext
const write = jest.fn<Promise<void>, [MeasureContext, AuditRecord]>()

beforeEach(() => {
  jest.resetAllMocks()
  write.mockResolvedValue(undefined)
  setAuditEventWriter('test', write)
})
afterEach(() => {
  setAuditEventWriter('test', undefined)
  jest.useRealTimers()
})

test('publishes versioned catalog events with distinct stable identities and explicit fields', async () => {
  await recordAuditEvent(ctx, { event: 'document.publish', actorAccountUuid: 'actor', documentId: 'document' })
  await recordAuditEvent(ctx, { event: 'document.publish', actorAccountUuid: 'actor', documentId: 'document' })
  const records = write.mock.calls.map(([, record]) => record)
  expect(records[0]).toMatchObject({
    schemaVersion: 1,
    sourceService: 'test',
    outcome: 'succeeded',
    documentId: 'document'
  })
  expect(records[0].eventId).not.toBe(records[1].eventId)
  expect(logs.info).not.toHaveBeenCalled()
})

test.each(['denied', 'failed'] as const)('publishes the %s business outcome', async (outcome) => {
  await recordAuditEvent(ctx, { event: 'document.publish', outcome })
  expect(write).toHaveBeenCalledWith(ctx, expect.objectContaining({ outcome }))
})

test('waits for the action and publication without exposing the returned credentials', async () => {
  let finish: (value: string) => void = () => {}
  const action = new Promise<string>((resolve) => {
    finish = resolve
  })
  const pending = withAuditEvent(ctx, { event: 'document.publish' }, async () => await action)
  expect(write).not.toHaveBeenCalled()
  finish('private-token')
  expect(await pending).toBe('private-token')
  expect(write).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(write.mock.calls)).not.toContain('private-token')
})

test('preserves action errors and exports only their type', async () => {
  const error = new TypeError('private database credentials')
  await expect(
    withAuditEvent(ctx, { event: 'workspace.data.cleanup' }, async () => {
      throw error
    })
  ).rejects.toBe(error)
  expect(write).toHaveBeenCalledWith(ctx, expect.objectContaining({ outcome: 'failed', errorType: 'TypeError' }))
  expect(JSON.stringify(write.mock.calls)).not.toContain(error.message)
})

test('transport and diagnostic failures neither replace results nor invent failed actions', async () => {
  write.mockRejectedValue(new Error('private broker details'))
  ;(logs.error as jest.Mock).mockImplementation(() => {
    throw new Error('logger unavailable')
  })
  await expect(withAuditEvent(ctx, { event: 'document.publish' }, async () => 42)).resolves.toBe(42)
  expect(write).toHaveBeenCalledTimes(1)
  expect(write.mock.calls[0][1].outcome).toBe('succeeded')
  const error = new Error('original action error')
  await expect(
    withAuditEvent(ctx, { event: 'document.publish' }, async () => {
      throw error
    })
  ).rejects.toBe(error)
})

test('reports an unconfigured writer without treating technical logs as saved audit', async () => {
  setAuditEventWriter('test', undefined)
  await recordAuditEvent(ctx, { event: 'document.publish' })
  expect(logs.error).toHaveBeenCalledWith(
    'Audit delivery failed',
    expect.objectContaining({ event: 'document.publish' })
  )
  expect(write).not.toHaveBeenCalled()
})

function publisherQueue (send: jest.Mock, close: jest.Mock): PlatformQueue {
  const producer: Partial<PlatformQueueProducer<AuditRecord>> = { send, close }
  const queue: Partial<PlatformQueue> = {
    getClientId: () => 'test',
    getProducer: jest.fn().mockReturnValue(producer)
  }
  return queue as PlatformQueue
}

test('publishes instance events without a fabricated workspace and drains before closing', async () => {
  let finish: () => void = () => {}
  const send = jest.fn().mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve
    })
  })
  const close = jest.fn().mockResolvedValue(undefined)
  const stop = startAuditPublisher(ctx, publisherQueue(send, close), 'account')
  const delivery = recordAuditEvent(ctx, { event: 'account.login' })
  const shutdown = stop()
  expect(close).not.toHaveBeenCalled()
  expect(send).toHaveBeenCalledWith(
    ctx,
    undefined,
    [expect.objectContaining({ sourceService: 'account' })],
    expect.any(String)
  )
  finish()
  await delivery
  await shutdown
  expect(close).toHaveBeenCalledTimes(1)
})

test('bounds broker wait without changing the action result or leaking timer rejections', async () => {
  jest.useFakeTimers()
  const send = jest.fn().mockImplementation(async () => {
    await new Promise<void>(() => {})
  })
  const close = jest.fn().mockResolvedValue(undefined)
  const stop = startAuditPublisher(ctx, publisherQueue(send, close), 'account')
  const result = withAuditEvent(ctx, { event: 'document.publish' }, async () => 42)
  await jest.advanceTimersByTimeAsync(10000)
  await expect(result).resolves.toBe(42)
  expect(logs.error).toHaveBeenCalledWith(
    'Audit delivery failed',
    expect.objectContaining({ eventId: expect.any(String) })
  )
  await stop()
})

test('hashes explicit identifiers with a key and scope, omitting values without a key', () => {
  const hash = hashAuditValue('private@example.com', 'email', 'test-key')
  expect(hash).toMatch(/^[a-f0-9]{64}$/)
  expect(hash).toBe(hashAuditValue('private@example.com', 'email', 'test-key'))
  expect(hash).not.toBe(hashAuditValue('private@example.com', 'email', 'other-key'))
  expect(hash).not.toBe(hashAuditValue('private@example.com', 'other-scope', 'test-key'))
  expect(hashAuditValue('private@example.com', 'email', undefined)).toBeUndefined()
})

describe('withAuditEvent scope', () => {
  const records = (): AuditRecord[] => write.mock.calls.map(([, record]) => record)
  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setImmediate(resolve))
  }

  test('records the details the action set with its outcome', async () => {
    await withAuditEvent(ctx, { event: 'workspace.data.export', workspaceUuid: 'ws' }, async (audit) => {
      audit.set({ format: 'csv' })
    })
    expect(records()[0]).toMatchObject({ outcome: 'succeeded', format: 'csv', workspaceUuid: 'ws' })
  })

  test('uses the classifier for the outcome and skips errors it declines to audit', async () => {
    const classifyError = (error: unknown): any =>
      error instanceof RangeError ? undefined : { outcome: 'denied', errorCode: 'not_owner' }
    await expect(
      withAuditEvent(
        ctx,
        { event: 'workspace.data.export' },
        async () => {
          throw new RangeError('malformed')
        },
        { classifyError }
      )
    ).rejects.toBeInstanceOf(RangeError)
    expect(write).not.toHaveBeenCalled()
    const denial = new Error('private reason')
    await expect(
      withAuditEvent(
        ctx,
        { event: 'workspace.data.export' },
        async (audit) => {
          audit.set({ format: 'json' })
          throw denial
        },
        { classifyError }
      )
    ).rejects.toBe(denial)
    expect(records()[0]).toMatchObject({ outcome: 'denied', errorCode: 'not_owner', format: 'json' })
    expect(JSON.stringify(records())).not.toContain('private reason')
  })

  test('a throwing classifier falls back to the error type and keeps the original error', async () => {
    const error = new TypeError('x')
    await expect(
      withAuditEvent(
        ctx,
        { event: 'document.publish' },
        async () => {
          throw error
        },
        {
          classifyError: () => {
            throw new Error('bug')
          }
        }
      )
    ).rejects.toBe(error)
    expect(records()[0]).toMatchObject({ outcome: 'failed', errorType: 'TypeError' })
  })

  test('lets the action report a partial failure without throwing', async () => {
    await withAuditEvent(ctx, { event: 'workspace.data.transfer' }, async (audit) => {
      audit.set({ exportedCount: 2, outcome: 'failed', errorCode: 'partial_failure' })
    })
    expect(records()[0]).toMatchObject({ outcome: 'failed', errorCode: 'partial_failure', exportedCount: 2 })
  })

  test('mirrors the settled event into another journal with the same operation', async () => {
    await withAuditEvent(
      ctx,
      { event: 'workspace.data.transfer', workspaceUuid: 'source', operationId: 'op' },
      async (audit) => {
        audit.set({ direction: 'outgoing' })
        audit.mirror('target', { direction: 'incoming' })
        audit.mirror('source')
      }
    )
    expect(records().map((r) => [r.workspaceUuid, r.direction, r.operationId])).toEqual([
      ['source', 'outgoing', 'op'],
      ['target', 'incoming', 'op']
    ])
  })

  test('records deferred work when it settles, not when the action returns', async () => {
    let finish: () => void = () => {}
    await withAuditEvent(ctx, { event: 'workspace.data.export' }, async (audit) => {
      audit.defer(
        new Promise<void>((resolve) => {
          finish = resolve
        })
      )
    })
    expect(write).not.toHaveBeenCalled()
    finish()
    await flush()
    expect(records()[0].outcome).toBe('succeeded')

    let fail: (error: Error) => void = () => {}
    await withAuditEvent(ctx, { event: 'workspace.data.export' }, async (audit) => {
      audit.defer(
        new Promise<void>((_resolve, reject) => {
          fail = reject
        })
      )
    })
    fail(new SyntaxError('broken archive'))
    await flush()
    expect(records()[1]).toMatchObject({ outcome: 'failed', errorType: 'SyntaxError' })
  })

  test('waits for every deferred job and records a single outcome', async () => {
    let first: () => void = () => {}
    let second: () => void = () => {}
    await withAuditEvent(ctx, { event: 'workspace.data.export' }, async (audit) => {
      audit.defer(
        new Promise<void>((resolve) => {
          first = resolve
        })
      )
      audit.defer(
        new Promise<void>((resolve) => {
          second = resolve
        })
      )
    })
    first()
    await flush()
    expect(write).not.toHaveBeenCalled()
    second()
    await flush()
    expect(records()).toHaveLength(1)
    expect(records()[0].outcome).toBe('succeeded')
  })
})

test('derives the actor only from a verified token', () => {
  setMetadata(serverToken.metadata.Secret, 'secret')
  const account = '00000000-0000-4000-8000-000000000001' as AccountUuid
  const workspace = '00000000-0000-4000-8000-0000000000a1' as WorkspaceUuid
  expect(auditActorFromToken(generateToken(account, workspace, { admin: 'true', service: 'export' }))).toEqual({
    actorAccountUuid: account,
    workspaceUuid: workspace,
    actorService: 'export',
    actorIsAdmin: true,
    actorUsesApiKey: false
  })
  expect(auditActorFromToken(generateToken(account, workspace, {}, 'another-secret'))).toEqual({})
  expect(auditActorFromToken('garbage')).toEqual({})
  expect(auditActorFromToken(undefined)).toEqual({})
})
