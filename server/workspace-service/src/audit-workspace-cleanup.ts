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

import { systemAccountUuid, type MeasureContext, type WorkspaceInfoWithStatus } from '@hcengineering/core'
import { randomUUID } from 'crypto'

/** Record the actual database cleanup attempt independently of account RPC status updates. */
export async function auditWorkspaceCleanup (
  ctx: MeasureContext,
  workspace: Pick<WorkspaceInfoWithStatus, 'uuid' | 'mode' | 'processingAttemps'>,
  cleanup: () => Promise<void>
): Promise<void> {
  const operationId = randomUUID()
  const emit = (outcome: 'started' | 'completed' | 'failed', error?: unknown): void => {
    try {
      const fields: Record<string, string | number | boolean | undefined> = {
        audit: true,
        event: 'workspace.data.cleanup',
        eventId: randomUUID(),
        operationId,
        outcome,
        actorAccountUuid: systemAccountUuid,
        actorService: 'workspace',
        workspaceUuid: workspace.uuid,
        mode: workspace.mode,
        reportedProcessingAttempts: workspace.processingAttemps,
        errorType: error instanceof Error ? error.name : undefined
      }
      if (outcome === 'failed') ctx.error('Workspace audit event', fields)
      else ctx.info('Workspace audit event', fields)
    } catch {
      // Telemetry failures must not interrupt cleanup or hide its original error.
    }
  }
  emit('started')
  try {
    await cleanup()
    emit('completed')
  } catch (error) {
    emit('failed', error)
    throw error
  }
}
