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

import core, { AccountRole, getCurrentAccount } from '@hcengineering/core'
import { createQuery } from '@hcengineering/presentation'
import { readable, type Readable } from 'svelte/store'

import { isGuestModuleCreateGranted } from '../utils'

function guestModuleCreateStore (): Readable<boolean> {
  return readable<boolean>(false, (set) => {
    const account = getCurrentAccount()
    if (account.role !== AccountRole.Guest) {
      set(isGuestModuleCreateGranted(account, []))
      return
    }

    const query = createQuery(true)
    query.query(core.class.ModulePermissionGroup, {}, (groups) => {
      set(isGuestModuleCreateGranted(account, groups))
    })
    return () => {
      query.unsubscribe()
    }
  })
}

export const canGuestCreateDocumentsStore = guestModuleCreateStore()
