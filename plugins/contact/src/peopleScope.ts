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

import type { Doc, Ref, Space } from '@hcengineering/core'
import type { GuestPeopleScope } from './utils'

/**
 * Scope requested by a person picker:
 * - a scope: narrow guests to the people of this space/object;
 * - `null`: explicitly no narrowing (e.g. direct messages, where the whole server visible set is relevant);
 * - `undefined`: not specified, the ambient scope of the opened object (see {@link providePeopleScope}) applies.
 * @public
 */
export type PeopleScopeInput = GuestPeopleScope | null | undefined

type Subscriber = (value: GuestPeopleScope | undefined) => void

/**
 * Minimal readable store (compatible with Svelte `$store` syntax). Implemented without `svelte/store`,
 * since this package is also used on the server.
 * @public
 */
export interface PeopleScopeReadable {
  subscribe: (run: Subscriber) => () => void
}

/**
 * Handle of a registered ambient scope.
 * @public
 */
export interface PeopleScopeProvider {
  set: (scope: GuestPeopleScope | undefined) => void
  dispose: () => void
}

interface Entry {
  scope: GuestPeopleScope | undefined
}

const entries: Entry[] = []
const subscribers = new Set<Subscriber>()
let current: GuestPeopleScope | undefined

/**
 * Builds a scope, returns undefined when there is nothing to narrow by.
 * @public
 */
export function makePeopleScope (space?: Ref<Space> | null, objectId?: Ref<Doc> | null): GuestPeopleScope | undefined {
  if (space == null && objectId == null) return undefined
  return { space: space ?? undefined, objectId: objectId ?? undefined }
}

/**
 * Stable key of a scope input, used to skip reloading an unchanged scope.
 * @public
 */
export function peopleScopeKey (scope: PeopleScopeInput): string {
  if (scope === null) return 'none'
  if (scope === undefined) return 'unset'
  return `${scope.space ?? ''}:${scope.objectId ?? ''}`
}

function computeCurrent (): GuestPeopleScope | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const scope = entries[i].scope
    if (scope !== undefined) return scope
  }
  return undefined
}

function notify (): void {
  const next = computeCurrent()
  if (peopleScopeKey(next) === peopleScopeKey(current)) return
  current = next
  for (const run of Array.from(subscribers)) run(current)
}

/**
 * Scope of the most recently opened object view (panel, aside, document page).
 * Person pickers without an explicit scope use it.
 * @public
 */
export const ambientPeopleScope: PeopleScopeReadable = {
  subscribe (run: Subscriber): () => void {
    subscribers.add(run)
    run(current)
    return () => {
      subscribers.delete(run)
    }
  }
}

/**
 * @public
 */
export function getAmbientPeopleScope (): GuestPeopleScope | undefined {
  return current
}

/**
 * Registers the scope of an opened object view. The latest registered (still alive) scope wins,
 * so an aside opened over a panel takes precedence until it is closed.
 *
 * Usage in a Svelte component:
 * ```
 * const peopleScope = providePeopleScope()
 * $: peopleScope.set(makePeopleScope(object?.space, object?._id))
 * onDestroy(peopleScope.dispose)
 * ```
 * @public
 */
export function providePeopleScope (scope?: GuestPeopleScope): PeopleScopeProvider {
  const entry: Entry = { scope }
  entries.push(entry)
  notify()
  let disposed = false
  return {
    set: (scope) => {
      if (disposed) return
      entry.scope = scope
      notify()
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      const index = entries.indexOf(entry)
      if (index !== -1) entries.splice(index, 1)
      notify()
    }
  }
}

/**
 * Explicit scope wins; `undefined` falls back to the ambient one.
 * @public
 */
export function resolvePeopleScope (
  explicit: PeopleScopeInput,
  ambient: GuestPeopleScope | undefined = current
): GuestPeopleScope | null | undefined {
  return explicit !== undefined ? explicit : ambient
}

/**
 * Prefix of the warning reported when a guest is offered people without a scope.
 * UI tests fail on it, so a picker missing a scope can't go unnoticed.
 * @public
 */
export const UNSCOPED_PEOPLE_WARNING = '[guest-people-scope] unscoped person picker'

/**
 * Reports a person picker offered to a guest without narrowing.
 * @public
 */
export function reportUnscopedPeople (source: string, reason: string, scope?: GuestPeopleScope): void {
  console.warn(`${UNSCOPED_PEOPLE_WARNING}: ${source} (${reason})`, scope ?? '')
}
