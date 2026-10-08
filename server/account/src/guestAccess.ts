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

import { AccountRole, readOnlyGuestAccountUuid, systemAccountUuid, type PersonUuid } from '@hcengineering/core'
import platform, { Severity, Status } from '@hcengineering/platform'
import { decodeTokenVerbose } from '@hcengineering/server-token'

import type { AccountDB, AccountMethodHandler } from './types'

export const GUEST_ACCOUNT = 'b6996120-416f-49cd-841e-e4a5d2e49c9b' as PersonUuid

type GuestKind = 'doc' | 'readonly' | 'personal'

export type GuestAccessPolicy = 'bypass' | 'allGuests' | 'readOnlyAndPersonal' | 'personalGuest' | 'deny'

async function getGuestKind (
  db: AccountDB,
  account: ReturnType<typeof decodeTokenVerbose>,
  policy: GuestAccessPolicy
): Promise<GuestKind | undefined> {
  if (account.account === GUEST_ACCOUNT) return 'doc'
  if (account.account === readOnlyGuestAccountUuid || account.extra?.readonly === 'true') return 'readonly'
  if (account.account === systemAccountUuid || account.extra?.admin === 'true' || account.extra?.service != null) {
    return undefined
  }

  if (account.workspace != null) {
    const role = await db.getWorkspaceRole(account.account, account.workspace)
    if (role === AccountRole.Guest) return 'personal'
    if (role === AccountRole.ReadOnlyGuest) return 'readonly'
    if (role === AccountRole.DocGuest) return 'doc'
    return undefined
  }

  // A personal guest may use these account methods even with a workspace-free login token.
  if (policy === 'personalGuest') return undefined

  const roles = await db.getWorkspaceRoles(account.account)
  return roles.size > 0 && Array.from(roles.values()).every((role) => role === AccountRole.Guest)
    ? 'personal'
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

    let kind: GuestKind | undefined
    try {
      kind = await getGuestKind(db, decodeTokenVerbose(ctx, token), policy)
    } catch {
      return { id: request.id, error: new Status(Severity.ERROR, platform.status.Unauthorized, {}) }
    }

    const allowed =
      kind === undefined ||
      (kind === 'doc' && policy === 'allGuests') ||
      (kind === 'readonly' && (policy === 'allGuests' || policy === 'readOnlyAndPersonal')) ||
      (kind === 'personal' &&
        (policy === 'allGuests' || policy === 'readOnlyAndPersonal' || policy === 'personalGuest'))

    if (!allowed) {
      return { id: request.id, error: new Status(Severity.ERROR, platform.status.Forbidden, {}) }
    }

    return await handler(ctx, db, branding, request, token, params, meta)
  }
}
