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

import { createHash, randomBytes } from 'node:crypto'
import type { AuthorizationState } from './types'

export function opaqueToken (): string {
  return randomBytes(32).toString('base64url')
}

export function hash (value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function isRecord (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isRedirectUri (value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    if (url.username !== '' || url.password !== '' || url.hash !== '') return false
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))
    )
  } catch {
    return false
  }
}

export function authorizationFingerprint (value: AuthorizationState): string {
  return hash(
    JSON.stringify([
      value.client_id,
      value.redirect_uri,
      value.response_type,
      value.state,
      value.audience,
      value.pkce?.challenge,
      value.pkce?.method
    ])
  )
}

export function getTokenKey (form: URLSearchParams): string[] | undefined {
  if (form.get('grant_type') === 'authorization_code') {
    const code = form.get('code')
    return code !== null && code !== '' ? ['oauth:code', code] : undefined
  }
  if (form.get('grant_type') === 'refresh_token') {
    const refresh = form.get('refresh_token')
    if (refresh === null) return undefined
    const separator = refresh.lastIndexOf(':')
    if (separator <= 0 || separator === refresh.length - 1) return undefined
    return ['oauth:refresh', refresh.slice(0, separator), refresh.slice(separator + 1)]
  }
  return undefined
}
