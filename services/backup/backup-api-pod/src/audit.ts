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
import { recordAuditEvent, type AuditEvent } from '@hcengineering/server-core'
import type { Token } from '@hcengineering/server-token'
import type { EventEmitter } from 'events'

export type BackupAuditOutcome = 'succeeded' | 'denied' | 'failed'

/** Record a backup access event in the journal of the token's workspace. */
export async function auditBackupEvent (
  ctx: MeasureContext,
  token: Token,
  event: Omit<AuditEvent, 'event'> & Partial<Pick<AuditEvent, 'event'>>
): Promise<void> {
  await recordAuditEvent(ctx, {
    event: 'workspace.backup.download',
    actorAccountUuid: token.account,
    workspaceUuid: token.workspace,
    actorService: typeof token.extra?.service === 'string' ? token.extra.service : undefined,
    actorIsAdmin: token.extra?.admin === 'true',
    actorUsesApiKey: token.extra?.apiKey != null,
    targetType: 'backup',
    ...event
  })
}

/**
 * Settle exactly once when a streamed response finishes or the client goes away first.
 * 'close' is also emitted after a successful 'finish', so the first signal wins.
 */
export function onResponseSettled (
  res: EventEmitter,
  source: EventEmitter,
  settle: (outcome: BackupAuditOutcome, errorCode?: string) => void
): void {
  let settled = false
  const once = (outcome: BackupAuditOutcome, errorCode?: string): void => {
    if (settled) return
    settled = true
    settle(outcome, errorCode)
  }
  res.once('finish', () => {
    once('succeeded')
  })
  res.once('close', () => {
    once('failed', 'download_interrupted')
  })
  source.once('error', (err: unknown) => {
    once('failed', err instanceof Error ? err.name : 'UnknownError')
  })
}
