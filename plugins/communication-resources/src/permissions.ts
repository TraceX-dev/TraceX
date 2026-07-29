//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { type Card } from '@hcengineering/card'
import { AccountRole, onCurrentAccountChanged, type Account, type Doc, type Ref } from '@hcengineering/core'
import { registerPermissions, restrictionStore, type Permissions } from '@hcengineering/view-resources'
import { derived, writable, type Readable } from 'svelte/store'

import { guestCommunicationAllowedCards } from './stores'

const accountStore = writable<Account | undefined>(undefined)
onCurrentAccountChanged((account) => {
  accountStore.set(account)
})

function isCardAllowed (doc: Doc | undefined, allowedCards: Array<Ref<Card>>): boolean {
  if (doc === undefined) return false
  const card = doc as Card
  if (allowedCards.includes(card._id)) return true
  for (const parent of card.parentInfo ?? []) {
    if (allowedCards.includes(parent._id)) return true
  }
  return false
}

/**
 * Guests may write to the cards explicitly allowed in GuestCommunicationSettings.
 * Everything else is decided by the base permission store, hence the empty overrides.
 */
export const communicationPermissions: Readable<Partial<Permissions>> = derived(
  [accountStore, guestCommunicationAllowedCards, restrictionStore],
  ([account, allowedCards, restrictions]) => {
    if (account === undefined || account.role !== AccountRole.Guest) return {}
    if (restrictions.readonly || restrictions.disableComments) return {}

    const canComment = (doc: Doc | undefined): boolean => isCardAllowed(doc, allowedCards)
    return { canComment, canReact: canComment }
  }
)

registerPermissions(communicationPermissions)
