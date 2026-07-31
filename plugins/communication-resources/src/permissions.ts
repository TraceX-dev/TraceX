//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { type Card } from '@hcengineering/card'
import { AccountRole, type Doc, type Ref } from '@hcengineering/core'
import {
  currentAccountStore,
  ownsDoc,
  registerPermissions,
  restrictionStore,
  type Permissions
} from '@hcengineering/view-resources'
import { derived, type Readable } from 'svelte/store'

import { guestCommunicationAllowedCards } from './stores'

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
 * Guests may write to the cards explicitly allowed in GuestCommunicationSettings and to the
 * cards they created themselves. Everything else is decided by the base permission store,
 * hence the empty overrides.
 *
 * Note that an override replaces the base predicate instead of extending it, so the own card
 * case has to be repeated here.
 */
export const communicationPermissions: Readable<Partial<Permissions>> = derived(
  [currentAccountStore, guestCommunicationAllowedCards, restrictionStore],
  ([account, allowedCards, restrictions]) => {
    if (account === undefined || account.role !== AccountRole.Guest) return {}
    if (restrictions.readonly || restrictions.disableComments) return {}

    const canComment = (doc: Doc | undefined): boolean => isCardAllowed(doc, allowedCards) || ownsDoc(doc, account)
    return { canComment, canReact: canComment }
  }
)

registerPermissions(communicationPermissions)
