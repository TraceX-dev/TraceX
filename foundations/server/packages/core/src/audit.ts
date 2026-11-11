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

import type { AuditEventName, MeasureContext, WorkspaceUuid } from '@hcengineering/core'
import { createHmac, randomUUID } from 'crypto'
import { decodeToken } from '@hcengineering/server-token'
import { QueueTopic, type PlatformQueue } from './queue/types'

export type AuditAttributeValue = string | number | boolean | readonly string[] | null | undefined

/** Explicit domain attributes. Never pass request bodies, credentials or raw errors. */
export interface AuditEvent {
  event: AuditEventName
  outcome?: 'succeeded' | 'denied' | 'failed'
  actorAccountUuid?: string
  actorService?: string
  workspaceUuid?: string | null
  targetType?: string
  targetId?: string
  operationId?: string
  [field: string]: AuditAttributeValue
}

/** Versioned wire record. Additional scalar attributes extend events without changing transport. */
export interface AuditRecord extends AuditEvent {
  schemaVersion: 1
  eventId: string
  occurredAt: number
  sourceService: string
  outcome: 'succeeded' | 'denied' | 'failed'
}

export type AuditEventWriter = (ctx: MeasureContext, event: AuditRecord) => Promise<void>

let auditWriter: AuditEventWriter | undefined
let sourceService = 'unknown'
const pending = new Set<Promise<void>>()

/** Configure once at service startup; callers must explicitly select safe event fields. */
export function setAuditEventWriter (source: string, writer: AuditEventWriter | undefined): void {
  sourceService = source
  auditWriter = writer
}

function reportDeliveryFailure (ctx: MeasureContext, event: AuditEvent, error: unknown): void {
  try {
    ctx.error('Audit delivery failed', {
      event: event.event,
      eventId: event.eventId,
      errorType: error instanceof Error ? error.name : 'UnknownError'
    })
  } catch {
    // Neither transport nor diagnostic failures may change the business outcome.
  }
}

/** Publish after the business action; broker acceptance is not atomic with its transaction. */
export async function recordAuditEvent (ctx: MeasureContext, event: AuditEvent): Promise<void> {
  let diagnosticEvent = event
  try {
    const record: AuditRecord = {
      ...event,
      schemaVersion: 1,
      eventId: randomUUID(),
      occurredAt: Date.now(),
      sourceService,
      outcome: event.outcome ?? 'succeeded'
    }
    diagnosticEvent = record
    const writer = auditWriter
    if (writer === undefined) throw new Error('Audit writer is not configured')
    const delivery = writer(ctx, record)
    pending.add(delivery)
    try {
      await delivery
    } catch (error) {
      reportDeliveryFailure(ctx, record, error)
    } finally {
      pending.delete(delivery)
    }
  } catch (error) {
    reportDeliveryFailure(ctx, diagnosticEvent, error)
  }
}

/** Configure a queue publisher and return a drain/close hook for service shutdown. */
export function startAuditPublisher (ctx: MeasureContext, queue: PlatformQueue, source: string): () => Promise<void> {
  if (queue.getClientId() === 'dummy') {
    setAuditEventWriter(source, undefined)
    ctx.error('Audit delivery unavailable: a real queue is required', { sourceService: source })
    return async () => {}
  }
  const producer = queue.getProducer<AuditRecord>(ctx, QueueTopic.Audit, {
    allowAutoTopicCreation: false,
    idempotent: true,
    maxInFlightRequests: 1,
    retry: { retries: 2, initialRetryTime: 300, maxRetryTime: 1000 },
    acks: -1,
    timeout: 5000
  })
  setAuditEventWriter(source, async (operationCtx, record) => {
    const workspace = record.workspaceUuid as WorkspaceUuid | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        producer.send(
          operationCtx,
          workspace ?? undefined,
          [record],
          record.workspaceUuid ?? record.actorAccountUuid ?? record.eventId
        ),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Audit publish timed out'))
          }, 10000)
        })
      ])
    } finally {
      clearTimeout(timer)
    }
  })
  return async () => {
    setAuditEventWriter(source, undefined)
    await Promise.allSettled([...pending])
    await producer.close()
  }
}

export type AuditOutcome = AuditRecord['outcome']
export type AuditDetails = Omit<Partial<AuditEvent>, 'event'>

/** What an audited action may tell the audit layer; the action never records anything itself. */
export interface AuditScope {
  /** Add domain details recorded with the outcome. May also override the outcome, e.g. a partial failure. */
  set: (details: AuditDetails) => void
  /** Record the same event in another workspace journal, e.g. the target of a transfer. */
  mirror: (workspaceUuid: string, overrides?: AuditDetails) => void
  /** The action continues in the background: record its outcome when all deferred work settles. */
  defer: (work: Promise<unknown>) => void
}

/**
 * Map an action error to audit fields. Return `undefined` for errors that should not be audited
 * (e.g. malformed requests that never reached any data). Never copy error messages.
 */
export type AuditErrorClassifier = (error: unknown) => (AuditDetails & { outcome: 'denied' | 'failed' }) | undefined

export interface AuditEventOptions {
  classifyError?: AuditErrorClassifier
}

const defaultClassifyError: AuditErrorClassifier = (error) => ({
  outcome: 'failed',
  errorType: error instanceof Error ? error.name : undefined
})

/**
 * Run an action and publish its settled outcome: succeeded when it resolves (or when its deferred work settles),
 * denied/failed as classified from the thrown error. The action's result and error are always preserved,
 * even when publishing fails.
 */
export async function withAuditEvent<T> (
  ctx: MeasureContext,
  event: AuditEvent,
  action: (audit: AuditScope) => Promise<T>,
  options: AuditEventOptions = {}
): Promise<T> {
  const classifyError = options.classifyError ?? defaultClassifyError
  let details: AuditDetails = {}
  const mirrors: Array<{ workspaceUuid: string, overrides: AuditDetails }> = []
  const deferred: Array<Promise<unknown>> = []

  const record = async (outcome: AuditDetails): Promise<void> => {
    const base: AuditEvent = { ...event, ...outcome }
    await recordAuditEvent(ctx, base)
    for (const { workspaceUuid, overrides } of mirrors) {
      if (workspaceUuid !== base.workspaceUuid) {
        await recordAuditEvent(ctx, { ...base, ...overrides, workspaceUuid })
      }
    }
  }
  const succeeded = async (): Promise<void> => {
    await record({ outcome: 'succeeded', ...details })
  }
  const failed = async (error: unknown): Promise<void> => {
    let classified: ReturnType<AuditErrorClassifier>
    try {
      classified = classifyError(error)
    } catch {
      classified = defaultClassifyError(error)
    }
    if (classified !== undefined) await record({ ...details, ...classified })
  }

  const scope: AuditScope = {
    set: (more) => {
      details = { ...details, ...more }
    },
    mirror: (workspaceUuid, overrides = {}) => {
      mirrors.push({ workspaceUuid, overrides })
    },
    defer: (work) => {
      deferred.push(work)
    }
  }

  let result: T
  try {
    result = await action(scope)
  } catch (error) {
    await failed(error)
    throw error
  }
  if (deferred.length > 0) {
    void Promise.all(deferred).then(succeeded, failed)
  } else {
    await succeeded()
  }
  return result
}

/** Actor fields from a verified token; empty when the token cannot be verified. */
export function auditActorFromToken (token: string | undefined): AuditDetails {
  if (token === undefined || token === '') return {}
  try {
    const { account, workspace, extra } = decodeToken(token)
    return {
      actorAccountUuid: account,
      workspaceUuid: workspace,
      actorService: typeof extra?.service === 'string' ? extra.service : undefined,
      actorIsAdmin: extra?.admin === 'true',
      actorUsesApiKey: extra?.apiKey != null
    }
  } catch {
    return {}
  }
}

/** Hash an explicitly normalized private identifier; omit it when no key is configured. */
export function hashAuditValue (value: string, scope: string, key: string | undefined): string | undefined {
  if (key == null || key === '' || value === '' || value.length > 4096) return undefined
  return createHmac('sha256', key).update('tracex-audit:v1\0').update(scope).update('\0').update(value).digest('hex')
}
