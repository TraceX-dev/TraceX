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

import type { MeasureContext, WorkspaceInfoWithStatus, WorkspaceUuid } from '@hcengineering/core'

import { auditWorkspaceCleanup } from '../audit-workspace-cleanup'

const workspace: Pick<WorkspaceInfoWithStatus, 'uuid' | 'mode' | 'processingAttemps'> = {
  uuid: '3529632b-872d-43e0-8a31-6a54251593ce' as WorkspaceUuid,
  mode: 'pending-deletion',
  processingAttemps: 2
}
const ctx: Pick<MeasureContext, 'info' | 'error'> = { info: jest.fn(), error: jest.fn() }

beforeEach(() => jest.resetAllMocks())

test('records the actual cleanup completion and retains attempt identity', async () => {
  const cleanup = jest.fn().mockResolvedValue(undefined)
  await auditWorkspaceCleanup(ctx as MeasureContext, workspace, cleanup)
  expect(cleanup).toHaveBeenCalledTimes(1)
  const calls = (ctx.info as jest.Mock).mock.calls
  const started: Record<string, unknown> = {
    event: 'workspace.data.cleanup',
    outcome: 'started',
    workspaceUuid: workspace.uuid,
    mode: 'pending-deletion',
    reportedProcessingAttempts: 2
  }
  const completed: Record<string, unknown> = { outcome: 'completed', operationId: calls[0][1].operationId }
  expect(calls[0][1]).toMatchObject(started)
  expect(calls[1][1]).toMatchObject(completed)
  expect(calls[1][1].eventId).not.toBe(calls[0][1].eventId)
})

test('records failure without exporting the raw error and preserves the original rejection', async () => {
  const error = new Error('private database credentials')
  const cleanup = jest.fn().mockRejectedValue(error)
  await expect(auditWorkspaceCleanup(ctx as MeasureContext, workspace, cleanup)).rejects.toBe(error)
  expect(ctx.info).toHaveBeenCalledTimes(1)
  const failed: Record<string, unknown> = { outcome: 'failed', errorType: 'Error' }
  expect((ctx.error as jest.Mock).mock.calls[0][1]).toMatchObject(failed)
  expect(JSON.stringify((ctx.error as jest.Mock).mock.calls)).not.toContain('private database credentials')
})

test('logger failures cannot stop cleanup or hide its failure', async () => {
  ;(ctx.info as jest.Mock).mockImplementation(() => {
    throw new Error('logger unavailable')
  })
  ;(ctx.error as jest.Mock).mockImplementation(() => {
    throw new Error('logger unavailable')
  })
  const cleanup = jest.fn().mockResolvedValue(undefined)
  await expect(auditWorkspaceCleanup(ctx as MeasureContext, workspace, cleanup)).resolves.toBeUndefined()
  const error = new Error('original cleanup error')
  cleanup.mockRejectedValue(error)
  await expect(auditWorkspaceCleanup(ctx as MeasureContext, workspace, cleanup)).rejects.toBe(error)
})
