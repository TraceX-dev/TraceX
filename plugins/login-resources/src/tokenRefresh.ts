//
// Copyright © TraceX SAS 2026
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

import { getAccountClient } from './utils'

/** Reads JWT expiry without verification. */
export function decodeJwtExpMs (token: string | null | undefined): number | undefined {
  if (token == null || token === '') return undefined
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(decodeURIComponent(escape(atob(base64))))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : undefined
  } catch {
    return undefined
  }
}

let refreshInFlight: Promise<string | undefined> | undefined

/** Refreshes the access token with a cross-tab lock when available. */
export async function refreshAccessToken (): Promise<string | undefined> {
  if (refreshInFlight !== undefined) {
    return await refreshInFlight
  }
  refreshInFlight = runExclusive(doRefresh).finally(() => {
    refreshInFlight = undefined
  })
  return await refreshInFlight
}

async function runExclusive<T> (fn: () => Promise<T>): Promise<T> {
  const locks: any = (globalThis as any).navigator?.locks
  if (locks?.request != null) {
    return await (locks.request('tracex-token-refresh', fn) as Promise<T>)
  }
  return await fn()
}

async function doRefresh (): Promise<string | undefined> {
  try {
    // Null omits Authorization; the refresh cookie authenticates the request.
    const info = await getAccountClient(null).refreshToken()
    return info?.token ?? undefined
  } catch {
    return undefined
  }
}

/** Returns whether the token expires within `skewMs`. */
export function shouldRefresh (token: string | null | undefined, skewMs: number = 60_000): boolean {
  const expMs = decodeJwtExpMs(token)
  if (expMs === undefined) return false // no expiry → rotation disabled
  return Date.now() >= expMs - skewMs
}

/** Delay (ms) until a token should be proactively refreshed (≈80% of its life). */
export function nextRefreshDelayMs (token: string | null | undefined): number | undefined {
  const expMs = decodeJwtExpMs(token)
  if (expMs === undefined) return undefined
  const remaining = expMs - Date.now()
  // Refresh at ~80% of remaining lifetime, but never less than 5s away.
  return Math.max(Math.floor(remaining * 0.8), 5_000)
}
