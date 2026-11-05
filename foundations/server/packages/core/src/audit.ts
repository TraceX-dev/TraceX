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
import { createHmac, randomUUID } from 'crypto'

/** Explicit audit attributes. Never pass request bodies, tokens, secrets or raw errors. */
export interface AuditEvent {
  event: string
  outcome?: 'succeeded' | 'denied' | 'failed'
  actorAccountUuid?: string
  actorService?: string
  workspaceUuid?: string | null
  [field: string]: string | number | boolean | readonly string[] | null | undefined
}

/** Write one audit record through the existing local and OTLP logging paths. */
export function recordAuditEvent (ctx: MeasureContext, event: AuditEvent): void {
  try {
    const fields: AuditEvent = { ...event, audit: true, eventId: randomUUID(), outcome: event.outcome ?? 'succeeded' }
    if (fields.outcome === 'denied') ctx.warn('Audit event', fields)
    else if (fields.outcome === 'failed') ctx.error('Audit event', fields)
    else ctx.info('Audit event', fields)
  } catch {
    // Audit delivery must not change the business result or replace its error.
  }
}

/** Audit one asynchronous action without inspecting or exporting its result or error message. */
export async function withAuditEvent<T> (ctx: MeasureContext, event: AuditEvent, action: () => Promise<T>): Promise<T> {
  try {
    const result = await action()
    recordAuditEvent(ctx, { ...event, outcome: 'succeeded' })
    return result
  } catch (error) {
    recordAuditEvent(ctx, { ...event, outcome: 'failed', errorType: error instanceof Error ? error.name : undefined })
    throw error
  }
}

/** Hash an explicitly normalized private identifier; omit it when no key is configured. */
export function hashAuditValue (value: string, scope: string, key: string | undefined): string | undefined {
  if (key == null || key === '' || value === '' || value.length > 4096) return undefined
  return createHmac('sha256', key).update('tracex-audit:v1\0').update(scope).update('\0').update(value).digest('hex')
}
