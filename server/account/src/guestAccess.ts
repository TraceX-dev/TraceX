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

import { AccountRole, docGuestAccountUuid, readOnlyGuestAccountUuid, systemAccountUuid } from '@hcengineering/core'
import platform, { Severity, Status } from '@hcengineering/platform'
import { decodeTokenVerbose } from '@hcengineering/server-token'

import type { AccountDB, AccountMethodHandler } from './types'

export type GuestAccessPolicy = 'bypass' | 'allGuests' | 'readOnlyAndPersonal' | 'personalGuest' | 'deny'

async function getGuestRole (
  db: AccountDB,
  account: ReturnType<typeof decodeTokenVerbose>,
  policy: GuestAccessPolicy
): Promise<AccountRole | undefined> {
  if (account.account === docGuestAccountUuid) return AccountRole.DocGuest
  if (account.account === readOnlyGuestAccountUuid || account.extra?.readonly === 'true') {
    return AccountRole.ReadOnlyGuest
  }
  if (account.account === systemAccountUuid || account.extra?.admin === 'true' || account.extra?.service != null) {
    return undefined
  }

  if (account.workspace != null) {
    const role = await db.getWorkspaceRole(account.account, account.workspace)
    if (role === AccountRole.Guest || role === AccountRole.ReadOnlyGuest || role === AccountRole.DocGuest) {
      return role
    }
    return undefined
  }

  // A personal guest may use these account methods even with a workspace-free login token.
  if (policy === 'personalGuest') return undefined

  const roles = await db.getWorkspaceRoles(account.account)
  return roles.size > 0 && Array.from(roles.values()).every((role) => role === AccountRole.Guest)
    ? AccountRole.Guest
    : undefined
}

/** Reject account RPCs that are not explicitly available to the caller's guest role. */
export function guardGuestMethod (
  handler: AccountMethodHandler,
  policy: GuestAccessPolicy = 'deny'
): AccountMethodHandler {
  // Bypass delegates authorization entirely to the method and the existing wrap checks.
  if (policy === 'bypass') return handler

  return async (ctx, db, branding, request, token, params, meta) => {
    if (token == null || token === '') {
      return { id: request.id, error: new Status(Severity.ERROR, platform.status.Unauthorized, {}) }
    }

    let role: AccountRole | undefined
    try {
      role = await getGuestRole(db, decodeTokenVerbose(ctx, token), policy)
    } catch {
      return { id: request.id, error: new Status(Severity.ERROR, platform.status.Unauthorized, {}) }
    }

    const allowed =
      role === undefined ||
      (role === AccountRole.DocGuest && policy === 'allGuests') ||
      (role === AccountRole.ReadOnlyGuest && (policy === 'allGuests' || policy === 'readOnlyAndPersonal')) ||
      (role === AccountRole.Guest &&
        (policy === 'allGuests' || policy === 'readOnlyAndPersonal' || policy === 'personalGuest'))

    if (!allowed) {
      return { id: request.id, error: new Status(Severity.ERROR, platform.status.Forbidden, {}) }
    }

    return await handler(ctx, db, branding, request, token, params, meta)
  }
}
