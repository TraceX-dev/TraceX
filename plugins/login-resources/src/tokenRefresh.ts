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

/**
 * Client-side token rotation (see docs/token-rotation-plan.md, phase 4).
 *
 * The refresh token is long-lived and rotated on every use; the access token is
 * short-lived. The refresh token is held in an httpOnly cookie set by the
 * account service, so it is never exposed to JS — the client just calls the
 * refresh endpoint (credentials are included automatically) to get a fresh
 * access token. Dormant when the access token has no `exp` (i.e.
 * ACCESS_TOKEN_TTL_SEC=0 on the server), so nothing changes until short-lived
 * access tokens are enabled.
 */

/** Reads the `exp` (ms since epoch) from a JWT without verifying it. */
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

/**
 * Exchanges the httpOnly refresh cookie for a fresh access token (the account
 * service rotates the cookie server-side). Single-flight (and cross-tab via
 * `navigator.locks` when available) so two concurrent refreshes can't rotate the
 * same token twice and trip the server's reuse detection. Returns the new access
 * token, or `undefined` when the refresh failed (no/expired/revoked session).
 */
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
    // Pass null (not undefined, which would fall back to the current token): the
    // refresh token travels in the httpOnly cookie sent with the request
    // (account-client includes credentials in the browser).
    const info = await getAccountClient(null).refreshToken()
    return info?.token ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Returns true when the token is absent, has no `exp`, or expires within
 * `skewMs` — i.e. it should be refreshed before use.
 */
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
