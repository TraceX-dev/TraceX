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

import { getMetadata } from '@hcengineering/platform'
import login, { loginId } from '@hcengineering/login'
import { navigate } from '@hcengineering/ui'

const PENDING_AUTHORIZATION = 'tracex.pendingOAuthAuthorization'

export function rememberOAuthRequest (request: string): void {
  sessionStorage.setItem(PENDING_AUTHORIZATION, JSON.stringify({ request, createdOn: Date.now() }))
}

export function clearOAuthRequest (): void {
  sessionStorage.removeItem(PENDING_AUTHORIZATION)
}

/** Continues an authorization in this tab after any of the existing login methods completes. */
export function resumeOAuthLogin (): boolean {
  if (getMetadata(login.metadata.OAuthURL) === undefined) return false
  const pending = sessionStorage.getItem(PENDING_AUTHORIZATION)
  if (pending === null) return false
  try {
    const parsed: unknown = JSON.parse(pending)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('request' in parsed) ||
      typeof parsed.request !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(parsed.request) ||
      !('createdOn' in parsed) ||
      typeof parsed.createdOn !== 'number' ||
      Date.now() - parsed.createdOn > 10 * 60_000
    ) {
      clearOAuthRequest()
      return false
    }
    navigate({ path: [loginId, 'oauth'], query: { request: parsed.request } })
    return true
  } catch {
    clearOAuthRequest()
    return false
  }
}
