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

import core, {
  type Account,
  AccountRole,
  getCurrentAccount,
  hasAccountRole,
  isModulePermissionGranted,
  type ModulePermissionGroup
} from '@hcengineering/core'
import { createQuery } from '@hcengineering/presentation'
import { type ProcessToDo } from '@hcengineering/process'
import { readable, type Readable } from 'svelte/store'
import process from './plugin'

/**
 * Whether the account may complete process tasks assigned to it. Presentation state only: the server
 * enforces the same rule in the guest permissions middleware.
 */
export function isProcessParticipationGranted (account: Account, groups: ModulePermissionGroup[]): boolean {
  if (hasAccountRole(account, AccountRole.User)) return true
  if (account.role !== AccountRole.Guest) return false
  return isModulePermissionGranted(groups, AccountRole.Guest, process.permission.GuestParticipate)
}

/** Guests can not write the execution context yet, so they can not complete tasks that ask for input. */
export function isGuestInputRequired (account: Account, todo: ProcessToDo): boolean {
  return !hasAccountRole(account, AccountRole.User) && (todo.results?.length ?? 0) > 0
}

export const canParticipateInProcessesStore: Readable<boolean> = readable<boolean>(false, (set) => {
  const account = getCurrentAccount()
  if (account.role !== AccountRole.Guest) {
    set(isProcessParticipationGranted(account, []))
    return
  }
  const query = createQuery(true)
  query.query(core.class.ModulePermissionGroup, {}, (groups) => {
    set(isProcessParticipationGranted(account, groups))
  })
  return () => {
    query.unsubscribe()
  }
})
