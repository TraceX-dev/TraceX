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

/**
 * Guest / ReadOnlyGuest / DocGuest visibility restrictions used by `SpaceSecurityMiddleware`.
 *
 * Kept in a separate module (rather than folded into the already-large `spaceSecurity.ts`) since
 * this is a self-contained concern: none of it touches the space-membership tracking state
 * machine (tx handling, broadcast targeting, etc.) that makes up the rest of that file - it only
 * *reads* a couple of pieces of that state (`allowedSpaces`, `spacesMap`) and otherwise talks to
 * the rest of the pipeline purely through `Middleware.findAll`.
 */
import core, {
  type Account,
  AccountRole,
  type AccountUuid,
  type Class,
  type Collaborator,
  type Doc,
  type DocumentQuery,
  type Hierarchy,
  type MeasureContext,
  type ModulePermissionGroup,
  type Ref,
  type SessionData,
  type Space
} from '@hcengineering/core'
import type { Middleware } from '@hcengineering/server-core'
import contact, { type Person } from '@hcengineering/contact'

export type SpaceWithMembers = Pick<Space, '_id' | 'members' | 'private' | '_class' | 'archived'>

/**
 * A handful of classes end up living in `core.space.Workspace` (one of `mainSpaces`, which is
 * never filtered by role) purely as a storage convenience, even though their content is
 * per-account or per-meeting sensitive (who attended a call, someone else's push-notification
 * credentials, HR leave requests, sharable links, ...). These are referenced by literal class ref
 * rather than importing their owning plugin packages, to avoid pulling heavier feature-plugin
 * dependency graphs into this foundational security middleware.
 */
export const loveMeetingMinutesClass = 'love:class:MeetingMinutes' as Ref<Class<Doc>>
export const loveRoomInfoClass = 'love:class:RoomInfo' as Ref<Class<Doc>>
export const hrRequestClass = 'hr:class:Request' as Ref<Class<Doc>>
export const notificationPushSubscriptionClass = 'notification:class:PushSubscription' as Ref<Class<Doc>>
export const guestPublicLinkClass = 'guest:class:PublicLink' as Ref<Class<Doc>>

/**
 * Guest / ReadOnlyGuest / DocGuest must never be able to browse or search the full People
 * directory: only Person/Employee records belonging to accounts that share a real space with
 * them (or their own record) may be discovered. This does not apply to lookups that already
 * name specific, known `_id`s (see `hasNarrowIdQuery`) — those resolve identities referenced by
 * a document the caller can already see (e.g. an issue's assignee), and must keep working.
 */
export function isGuestVisibilityRestrictedRole (role: AccountRole): boolean {
  return role === AccountRole.Guest || role === AccountRole.ReadOnlyGuest || role === AccountRole.DocGuest
}

/**
 * True when `query[field]` already narrows the result to a specific, known set of refs
 * (a bare value, or `{ $in: [...] }` with nothing else combined on the same key). Any other
 * shape (`$ne`, `$nin`, `$gt`, the field missing entirely, etc.) is treated as an open
 * browse/search query for the purposes of guest visibility restrictions.
 */
export function hasNarrowFieldQuery (query: Record<string, any> | null | undefined, field: string): boolean {
  const val = query?.[field]
  if (val === undefined) return false
  if (typeof val === 'string') return true
  if (Array.isArray(val)) return false
  if (typeof val === 'object' && val !== null) {
    const keys = Object.keys(val)
    return keys.length === 1 && keys[0] === '$in' && Array.isArray(val.$in)
  }
  return false
}

export function hasNarrowIdQuery (query: Record<string, any>): boolean {
  return hasNarrowFieldQuery(query, '_id')
}

/**
 * Accounts the given (restricted-role) account is allowed to know people from: itself, plus
 * every member of every real space it belongs to. Deliberately excludes `mainSpaces` and
 * `systemSpaces` (e.g. the shared `contact.space.Contacts`) since those would defeat the
 * restriction for every role that reaches this helper - callers pass in only the real-space
 * membership state (`SpaceSecurityMiddleware`'s `allowedSpaces`/`spacesMap`).
 */
export function getGuestVisibleAccounts (
  account: Account,
  allowedSpaces: Record<AccountUuid, Ref<Space>[]>,
  spacesMap: Map<Ref<Space>, SpaceWithMembers>
): Set<AccountUuid> {
  const accounts = new Set<AccountUuid>([account.uuid])
  const userSpaces = allowedSpaces[account.uuid] ?? []
  for (const spaceId of userSpaces) {
    const space = spacesMap.get(spaceId)
    if (space === undefined) continue
    for (const member of space.members) {
      accounts.add(member)
    }
  }
  return accounts
}

/**
 * Resolves `getGuestVisibleAccounts` into the set of `Person` refs a restricted-role account
 * may discover via open browse/search queries.
 */
export async function getGuestVisiblePersonIds (
  next: Middleware | undefined,
  ctx: MeasureContext<SessionData>,
  account: Account,
  allowedSpaces: Record<AccountUuid, Ref<Space>[]>,
  spacesMap: Map<Ref<Space>, SpaceWithMembers>
): Promise<Set<Ref<Person>>> {
  const accounts = getGuestVisibleAccounts(account, allowedSpaces, spacesMap)
  if (accounts.size === 0) return new Set()
  const personQuery: DocumentQuery<Person> = { personUuid: { $in: Array.from(accounts) } }
  const persons = ((await next?.findAll(ctx, contact.class.Person, personQuery, {
    projection: { _id: 1 }
  })) ?? []) as Array<Pick<Person, '_id'>>
  return new Set(persons.map((p) => p._id))
}

/**
 * Settings → Guest permissions lets an admin disable a whole module/application for a role via
 * `ModulePermissionGroup.enabled`. Today that only hides the app icon in the sidebar and gates
 * write transactions (`GuestPermissionsMiddleware`) — search/mention never consulted it, so a
 * disabled module's objects (e.g. Products cards) still turned up in the @-mention picker.
 * Returns the `Space` classes (`ModulePermissionGroup.spaceClass`) disabled for the caller's role.
 */
export async function getDisabledModuleSpaceClasses (
  next: Middleware | undefined,
  ctx: MeasureContext<SessionData>,
  account: Account
): Promise<Set<Ref<Class<Space>>>> {
  const groupQuery: DocumentQuery<ModulePermissionGroup> = { role: account.role, enabled: false }
  const groups = ((await next?.findAll(ctx, core.class.ModulePermissionGroup, groupQuery, {
    projection: { spaceClass: 1 }
  })) ?? []) as Array<Pick<ModulePermissionGroup, 'spaceClass'>>
  const classes = new Set<Ref<Class<Space>>>()
  for (const group of groups) {
    if (group.spaceClass !== undefined) {
      classes.add(group.spaceClass)
    }
  }
  return classes
}

/** Resolves `getDisabledModuleSpaceClasses`'s class refs into concrete space ids, using the
 * space-membership tracking state (`spacesMap`) `SpaceSecurityMiddleware` already maintains. */
export function resolveDisabledModuleSpaceIds (
  hierarchy: Hierarchy,
  disabledClasses: Set<Ref<Class<Space>>>,
  spacesMap: Map<Ref<Space>, SpaceWithMembers>
): Set<Ref<Space>> {
  const ids = new Set<Ref<Space>>()
  if (disabledClasses.size === 0) return ids
  for (const space of spacesMap.values()) {
    for (const spaceClass of disabledClasses) {
      if (hierarchy.isDerived(space._class, spaceClass)) {
        ids.add(space._id)
        break
      }
    }
  }
  return ids
}

/**
 * Excludes `excluded` space ids from a space-field query condition (the `space` / `objectSpace` /
 * `_id` field `SpaceSecurityMiddleware.findAll` narrows queries to, depending on domain), whatever
 * shape it is already in (`undefined`, a bare ref, or an object with `$in`/`$nin`/other
 * operators). Returns `{ deny: true }` when the exclusion would leave no space eligible at all.
 */
export function excludeSpacesFromQuery (
  current: Record<string, any> | Ref<Space> | undefined,
  excluded: Set<Ref<Space>>
): { query: Record<string, any> | Ref<Space> | undefined } | { deny: true } {
  if (excluded.size === 0) return { query: current }
  if (current === undefined) {
    return { query: { $nin: Array.from(excluded) } }
  }
  if (typeof current === 'string') {
    return excluded.has(current) ? { deny: true } : { query: current }
  }
  if (Array.isArray(current.$in)) {
    const filtered = (current.$in as Ref<Space>[]).filter((id) => !excluded.has(id))
    if (filtered.length === 0) return { deny: true }
    return { query: { ...current, $in: filtered } }
  }
  const existingNin = new Set<Ref<Space>>((current.$nin as Ref<Space>[] | undefined) ?? [])
  for (const id of excluded) existingNin.add(id)
  return { query: { ...current, $nin: Array.from(existingNin) } }
}

/**
 * `Ref<Doc>`s of every object the account has an existing `Collaborator` record for - used both
 * to scope Collaborator-record browsing to the caller's own grants, and to resolve which
 * `love.class.MeetingMinutes` (attached-to id) a restricted-role account may discover.
 */
export async function getGuestCollaboratorAttachedIds (
  next: Middleware | undefined,
  ctx: MeasureContext<SessionData>,
  account: Account
): Promise<Set<Ref<Doc>>> {
  const collabQuery: DocumentQuery<Collaborator> = { collaborator: account.uuid }
  const collabs = ((await next?.findAll(ctx, core.class.Collaborator, collabQuery, {
    projection: { attachedTo: 1 }
  })) ?? []) as Array<Pick<Collaborator, 'attachedTo'>>
  return new Set(collabs.map((c) => c.attachedTo))
}

/** The caller's own `contact.class.Person` ref, resolved via `personUuid`, if any. */
export async function getOwnPersonId (
  next: Middleware | undefined,
  ctx: MeasureContext<SessionData>,
  account: Account
): Promise<Ref<Person> | undefined> {
  const personQuery: DocumentQuery<Person> = { personUuid: account.uuid }
  const persons = ((await next?.findAll(ctx, contact.class.Person, personQuery, {
    projection: { _id: 1 },
    limit: 1
  })) ?? []) as Array<Pick<Person, '_id'>>
  return persons[0]?._id
}

/**
 * Per-class guest visibility restriction for the handful of `core.space.Workspace`-resident
 * classes above. Returns `undefined` when the class is out of scope for this restriction (or
 * the query already narrows by a known-good field, e.g. resolving a specific attached doc from
 * something the caller can already see) - i.e. "leave the query alone". Returns `{ deny: true }`
 * when there is no legitimate identifying field to narrow by and the query is a wide-open
 * browse. Otherwise returns the narrowed `query` to use instead.
 *
 * `love.class.Room` is deliberately NOT covered here: it has no owner/participant field at all
 * and the entire virtual-office UI depends on an unfiltered `findAll(love.class.Room, {})` to
 * render the office/floor map - restricting it needs a real membership concept on Room first,
 * which is a separate, larger change.
 */
export async function applyGuestSensitiveClassRestriction<T extends Doc> (
  hierarchy: Hierarchy,
  next: Middleware | undefined,
  ctx: MeasureContext<SessionData>,
  account: Account,
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>
): Promise<{ deny: true } | { query: DocumentQuery<T> } | undefined> {
  if (hierarchy.isDerived(_class, core.class.Collaborator)) {
    if (hasNarrowFieldQuery(query, '_id') || hasNarrowFieldQuery(query, 'attachedTo')) {
      return undefined
    }
    const restricted: DocumentQuery<T> = { ...query, collaborator: account.uuid }
    return { query: restricted }
  }

  if (hierarchy.isDerived(_class, loveMeetingMinutesClass)) {
    if (hasNarrowFieldQuery(query, '_id') || hasNarrowFieldQuery(query, 'attachedTo')) {
      return undefined
    }
    const allowed = await getGuestCollaboratorAttachedIds(next, ctx, account)
    if (allowed.size === 0) return { deny: true }
    const restricted: DocumentQuery<T> = { ...query, _id: { $in: Array.from(allowed) } }
    return { query: restricted }
  }

  if (hierarchy.isDerived(_class, loveRoomInfoClass)) {
    if (hasNarrowFieldQuery(query, '_id')) return undefined
    return { deny: true }
  }

  if (hierarchy.isDerived(_class, guestPublicLinkClass)) {
    if (hasNarrowFieldQuery(query, '_id') || hasNarrowFieldQuery(query, 'attachedTo')) {
      return undefined
    }
    return { deny: true }
  }

  if (hierarchy.isDerived(_class, hrRequestClass)) {
    if (hasNarrowFieldQuery(query, '_id') || hasNarrowFieldQuery(query, 'attachedTo')) {
      return undefined
    }
    const ownPersonId = await getOwnPersonId(next, ctx, account)
    if (ownPersonId === undefined) return { deny: true }
    const restricted: DocumentQuery<T> = { ...query, attachedTo: ownPersonId }
    return { query: restricted }
  }

  if (hierarchy.isDerived(_class, notificationPushSubscriptionClass)) {
    const restricted: DocumentQuery<T> = { ...query, user: account.uuid }
    return { query: restricted }
  }

  return undefined
}
