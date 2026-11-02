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
import type { OAuthWorkspace } from '@hcengineering/openauth-client'
import presentation from '@hcengineering/presentation'
import { locationStorageKeyId, navigate, type Location } from '@hcengineering/ui'
import { workbenchId } from '@hcengineering/workbench'

const PENDING_AUTHORIZATION = 'tracex.pendingOAuthAuthorization'

interface PendingOAuthAuthorization {
  request: string
  createdOn: number
}

/** Suggests an accessible workspace from the current session or the browser's last workbench location. */
export function getPreferredOAuthWorkspace (workspaces: OAuthWorkspace[]): OAuthWorkspace | undefined {
  const currentId = getMetadata(presentation.metadata.WorkspaceUuid)
  const current = workspaces.find((workspace) => workspace.id === currentId)
  if (current !== undefined) return current
  if (workspaces.length === 1) return workspaces[0]
  try {
    const last: Location | null = JSON.parse(localStorage.getItem(locationStorageKeyId) ?? 'null')
    if (last?.path?.[0] === workbenchId) {
      return workspaces.find((workspace) => workspace.url === last.path[1])
    }
  } catch {
    // Missing or unavailable browser history must not prevent explicit workspace selection.
  }
  return undefined
}

export function rememberOAuthRequest (request: string): void {
  const pending: PendingOAuthAuthorization = { request, createdOn: Date.now() }
  sessionStorage.setItem(PENDING_AUTHORIZATION, JSON.stringify(pending))
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
    const parsed: PendingOAuthAuthorization = JSON.parse(pending)
    const age = Date.now() - parsed.createdOn
    if (!/^[A-Za-z0-9_-]{43}$/.test(parsed.request) || !Number.isFinite(age) || age > 10 * 60_000) {
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
