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

import type { DocumentQuery, Doc, MeasureContext } from '@hcengineering/core'
import { recordAuditEvent, type AuditEvent } from '@hcengineering/server-core'
import { decodeToken } from '@hcengineering/server-token'
import { ApiError } from './error'

export type AuditOutcome = 'succeeded' | 'denied' | 'failed'

/**
 * Record a data egress event, attributing it to the verified token caller.
 * Explicit event fields (e.g. workspaceUuid of a transfer target) take precedence over token claims.
 */
export async function auditExportEvent (
  ctx: MeasureContext,
  token: string | undefined,
  event: AuditEvent
): Promise<void> {
  let actor: Partial<AuditEvent> = {}
  if (token !== undefined && token !== '') {
    try {
      const { account, workspace, extra } = decodeToken(token)
      actor = {
        actorAccountUuid: account,
        workspaceUuid: workspace,
        actorService: typeof extra?.service === 'string' ? extra.service : undefined,
        actorIsAdmin: extra?.admin === 'true',
        actorUsesApiKey: extra?.apiKey != null
      }
    } catch {
      // An invalid token cannot identify the actor.
    }
  }
  await recordAuditEvent(ctx, { ...actor, ...event })
}

/** Classify a request failure without leaking its message into the audit journal. */
export function auditFailure (err: unknown): { outcome: AuditOutcome, errorCode: string } {
  if (err instanceof ApiError) {
    return { outcome: err.code === 401 || err.code === 403 ? 'denied' : 'failed', errorCode: String(err.code) }
  }
  return { outcome: 'failed', errorCode: err instanceof Error ? err.name : 'UnknownError' }
}

export function hasQueryFilter (query: DocumentQuery<Doc> | undefined | null): boolean {
  return query != null && typeof query === 'object' && Object.keys(query).length > 0
}
