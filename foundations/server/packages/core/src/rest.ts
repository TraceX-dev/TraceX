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

// Framework-agnostic helpers for REST services: they rely only on Node's `http.ServerResponse`,
// which an Express `Response` extends.

import type { MeasureContext } from '@hcengineering/core'
import type { ServerResponse } from 'http'
import { ApiError, classifyApiError } from './apiError'
import { withAuditEvent, type AuditEvent, type AuditScope } from './audit'

/**
 * Handle a request whose outcome is audited in one place: success on completion, denied/failed from the
 * thrown exception (see `classifyApiError`). `fallbackMessage` replaces the message of unexpected
 * (non-`ApiError`) errors so internal details are never returned to the client.
 *
 * A response the client abandoned mid-transfer is recorded as an interrupted download only when the action
 * awaits the end of the transfer (e.g. the `res.download` callback). An action that returns right after
 * `res.end()` is recorded as succeeded once the body is handed to the socket.
 */
export async function withAuditedResponse (
  ctx: MeasureContext,
  event: AuditEvent,
  res: ServerResponse,
  action: (audit: AuditScope) => Promise<void>,
  fallbackMessage: string
): Promise<void> {
  await withAuditEvent(
    ctx,
    event,
    async (audit) => {
      try {
        await action(audit)
      } catch (err: unknown) {
        if (err instanceof ApiError) throw err
        throw new ApiError(500, fallbackMessage, { cause: err })
      }
      if (res.headersSent && !res.writableFinished && res.destroyed) {
        audit.set({ outcome: 'failed', errorCode: 'download_interrupted' })
      }
    },
    { classifyError: classifyApiError }
  )
}

/**
 * Send an error as JSON: `ApiError` with its status, anything else as 500. A response whose body is already
 * partly sent is aborted instead, so the client never takes a truncated file as complete.
 */
export function sendApiError (err: unknown, res: ServerResponse): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  const status = err instanceof ApiError ? err.code : 500
  const message = err instanceof Error && err.message.length > 0 ? err.message : undefined
  const body = err instanceof ApiError ? { code: err.code, message: err.message } : { message }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/** Express-compatible error handler (four arguments) built on `sendApiError`. */
export const createErrorHandler =
  (ctx: MeasureContext) =>
  (err: unknown, _req: unknown, res: ServerResponse, _next: unknown): void => {
    ctx.warn('Request failed', { err })
    sendApiError(err, res)
  }

/** Follow-up of an operation that has already completed (e.g. a notification): failures are logged, never propagated. */
export async function notifyAfterCompletion (
  ctx: MeasureContext,
  failureMessage: string,
  send: () => Promise<void>
): Promise<void> {
  try {
    await send()
  } catch (err: unknown) {
    ctx.error(failureMessage, { err })
  }
}
