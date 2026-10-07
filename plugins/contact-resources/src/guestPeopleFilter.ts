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

import contact, {
  type Contact,
  type GuestPeopleScope,
  type PeopleScopeInput,
  type Person,
  getGuestScopedAccounts,
  makePeopleScope,
  peopleScopeKey,
  reportUnscopedPeople
} from '@hcengineering/contact'
import core, {
  type AccountUuid,
  type Class,
  type Doc,
  type DocumentQuery,
  type Ref,
  type Space,
  getCurrentAccount,
  isGuestRole
} from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import { type Readable, writable } from 'svelte/store'

/**
 * State of the guest narrowing of a person picker.
 * - `ready: false`: the scope is being resolved, nothing should be offered yet;
 * - `accounts: undefined`: no narrowing (not a guest, explicit opt-out, or the scope cannot be resolved).
 * @public
 */
export interface GuestPeopleFilterState {
  ready: boolean
  accounts?: ReadonlySet<AccountUuid>
}

/**
 * @public
 */
export interface GuestPeopleFilter extends Readable<GuestPeopleFilterState> {
  update: (scope: GuestPeopleScope | null | undefined) => void
}

const NO_FILTER: GuestPeopleFilterState = { ready: true }

function isGuest (): boolean {
  const account = getCurrentAccount()
  return account !== undefined && isGuestRole(account.role)
}

/**
 * Resolves the guest narrowing for a person picker. Non-guests are never narrowed and never wait.
 *
 * `update` is expected to be called with the resolved scope (see `resolvePeopleScope`):
 * an explicit scope, `null` for an explicit opt-out or `undefined` when neither the caller nor the
 * ambient context provide one (this is reported, see `UNSCOPED_PEOPLE_WARNING`).
 * @public
 */
export function createGuestPeopleFilter (source: string): GuestPeopleFilter {
  const guest = isGuest()
  const store = writable<GuestPeopleFilterState>(guest ? { ready: false } : NO_FILTER)
  let key: string | undefined
  let token = 0

  function update (scope: GuestPeopleScope | null | undefined): void {
    if (!guest) return
    const nextKey = peopleScopeKey(scope)
    if (nextKey === key) return
    key = nextKey
    const current = ++token

    if (scope === null) {
      store.set(NO_FILTER)
      return
    }
    if (scope === undefined) {
      reportUnscopedPeople(source, 'no scope')
      store.set(NO_FILTER)
      return
    }
    store.set({ ready: false })
    getGuestScopedAccounts(getClient(), scope).then(
      (accounts) => {
        if (current !== token) return
        if (accounts === undefined) reportUnscopedPeople(source, 'scope can not be resolved', scope)
        store.set({ ready: true, accounts })
      },
      (err) => {
        if (current !== token) return
        console.error(err)
        reportUnscopedPeople(source, 'scope resolution failed', scope)
        store.set(NO_FILTER)
      }
    )
  }

  return { subscribe: store.subscribe, update }
}

function restrictValues (existing: unknown, accounts: ReadonlySet<AccountUuid>): unknown {
  if (existing === undefined || existing === null) return { $in: Array.from(accounts) }
  if (typeof existing !== 'object') {
    return { $in: accounts.has(existing as AccountUuid) ? [existing] : [] }
  }
  const operators = existing as Record<string, unknown>
  const requested = operators.$in
  return {
    ...operators,
    $in: Array.isArray(requested) ? requested.filter((it) => accounts.has(it as AccountUuid)) : Array.from(accounts)
  }
}

/**
 * Narrows a person query by the guest filter: intersects `personUuid` with the allowed accounts,
 * matches nothing while the filter is loading.
 * @public
 */
export function restrictPersonQuery<T extends Doc> (
  query: DocumentQuery<T> | undefined,
  state: GuestPeopleFilterState
): DocumentQuery<T> | undefined {
  if (!state.ready) return { ...(query ?? {}), personUuid: { $in: [] } } as unknown as DocumentQuery<T>
  if (state.accounts === undefined) return query
  const q = (query ?? {}) as Record<string, unknown>
  return { ...q, personUuid: restrictValues(q.personUuid, state.accounts) } as unknown as DocumentQuery<T>
}

/**
 * Client side counterpart of {@link restrictPersonQuery} for contact lists that may also contain non-person
 * contacts (e.g. organizations), which are never narrowed.
 * @public
 */
export function isAllowedByGuestFilter (doc: Doc, state: GuestPeopleFilterState): boolean {
  if (!state.ready) return false
  if (state.accounts === undefined) return true
  if (!getClient().getHierarchy().isDerived(doc._class, contact.class.Person)) return true
  const personUuid = (doc as Person).personUuid
  return personUuid !== undefined && state.accounts.has(personUuid as AccountUuid)
}

/**
 * Whether a picker class lists persons only, so that narrowing can be applied in the query.
 * @public
 */
export function isPersonPickerClass (_class: Ref<Class<Contact>> | undefined): boolean {
  if (_class === undefined) return false
  return getClient().getHierarchy().isDerived(_class, contact.class.Person)
}

/**
 * Scope of an attribute editor: the edited object (or the space itself, when a space is edited).
 * An explicit `peopleScope` passed to the editor wins.
 * @public
 */
export function getEditorPeopleScope (
  peopleScope: PeopleScopeInput,
  space: Ref<Space> | undefined,
  object: Doc | undefined
): PeopleScopeInput {
  if (peopleScope !== undefined) return peopleScope
  if (object !== undefined && getClient().getHierarchy().isDerived(object._class, core.class.Space)) {
    return makePeopleScope(object._id as Ref<Space>)
  }
  return makePeopleScope(space ?? object?.space, object?._id)
}
