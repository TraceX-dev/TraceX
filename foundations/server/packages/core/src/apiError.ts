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

import type { AuditErrorClassifier } from './audit'

const defaultMessages: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  503: 'Service temporary unavailable'
}

export interface ApiErrorOptions {
  /** Stable machine-readable reason, recorded in the audit journal instead of the message. */
  reason?: string
  /** Whether the failure is an access denial; defaults to 401/403. */
  denied?: boolean
  cause?: unknown
}

/** An HTTP error of a REST service: the status code, a client-facing message and audit metadata. */
export class ApiError extends Error {
  readonly code: number
  readonly reason?: string
  readonly denied: boolean

  constructor (code: number, message?: string, options: ApiErrorOptions = {}) {
    super(
      message ?? defaultMessages[code] ?? 'Error',
      options.cause !== undefined ? { cause: options.cause } : undefined
    )
    this.code = code
    this.reason = options.reason
    this.denied = options.denied ?? (code === 401 || code === 403)
  }
}

/**
 * Audit outcome from the thrown error: `ApiError` carries its own reason and denial flag.
 * Malformed requests (400 without a reason) never reached any data and are not audited.
 */
export const classifyApiError: AuditErrorClassifier = (err) => {
  if (err instanceof ApiError) {
    if (err.code === 400 && err.reason === undefined) return undefined
    const cause = err.cause instanceof Error ? err.cause.name : undefined
    return { outcome: err.denied ? 'denied' : 'failed', errorCode: err.reason ?? cause ?? String(err.code) }
  }
  return { outcome: 'failed', errorCode: err instanceof Error ? err.name : 'UnknownError' }
}
