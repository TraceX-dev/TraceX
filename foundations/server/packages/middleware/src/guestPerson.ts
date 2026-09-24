/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import core, {
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type DocumentQuery,
  type FindResult,
  type MeasureContext,
  type Ref,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  type SearchResultDoc,
  type SessionData,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
  isGuestRole,
  toFindResult,
  TxProcessor
} from '@hcengineering/core'
import contact, { type Person } from '@hcengineering/contact'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import { GuestVisibilityCache, isDerivedSafe } from './guestVisibilityCache'
import { isSystem } from './utils'

/**
 * Max extra fetches used to refill a page after hidden persons were filtered out.
 * Each round doubles the limit, so a page is refilled from up to 2^N times the requested size.
 * Bounded to keep a single guest request cheap even when most matches are hidden.
 */
const MAX_EXPAND_ROUNDS = 3

interface BroadcastPersonSubject {
  personRef: Ref<Person>
  personUuid?: string
}

/**
 * Value addresses concrete documents: a single id or a plain `$in` list.
 * Such lookups are allowed for guests, so references in visible documents keep resolving.
 */
function isPointValue (value: unknown): boolean {
  if (typeof value === 'string') return true
  if (value === null || typeof value !== 'object') return false
  const keys = Object.keys(value)
  return keys.length === 1 && Array.isArray((value as { $in?: unknown }).$in)
}

/**
 * Restricts a query field to `allowed`, keeping other operators already set on the field (`$nin`, `$ne`, `$exists`, ...).
 */
function restrictField (existing: unknown, allowed: Iterable<string>): Record<string, unknown> {
  const list = Array.from(allowed)
  if (existing === undefined || existing === null || typeof existing !== 'object') {
    return { $in: list }
  }
  return { ...(existing as Record<string, unknown>), $in: list }
}

/**
 * Limits which persons a guest can list.
 *
 * A guest can list only persons whose account is a member/owner of a non-system space the guest is a member of.
 * Point queries (by `_id` / `personUuid` / `attachedTo`) and lookups are not restricted, so names of authors,
 * assignees etc. referenced from visible documents still resolve, but the full user list can't be enumerated.
 *
 * Non-guest sessions pass through with a single role check.
 */
export class GuestPersonMiddleware extends BaseMiddleware implements Middleware {
  private readonly cache: GuestVisibilityCache

  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
    this.cache = new GuestVisibilityCache(
      context.hierarchy,
      async (ctx, _class, query, options) => (await this.next?.findAll(ctx, _class, query, options)) ?? []
    )
  }

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<GuestPersonMiddleware> {
    return new GuestPersonMiddleware(context, next)
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private isPersonClass (_class: Ref<Class<Doc>> | undefined): boolean {
    return isDerivedSafe(this.context.hierarchy, _class, contact.class.Person)
  }

  private isPersonAttachedClass (_class: Ref<Class<Doc>> | undefined): boolean {
    const h = this.context.hierarchy
    return isDerivedSafe(h, _class, contact.class.SocialIdentity) || isDerivedSafe(h, _class, contact.class.Channel)
  }

  private isRestrictedAccount (ctx: MeasureContext<SessionData>): Account | undefined {
    const account = ctx.contextData?.account
    if (account === undefined) return undefined
    if (!isGuestRole(account.role) || isSystem(account, ctx)) return undefined
    return account
  }

  // ─── Find ───────────────────────────────────────────────────────────────────

  override async findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    const account = this.isRestrictedAccount(ctx)
    if (account === undefined) {
      return await this.provideFindAll(ctx, _class, query, options)
    }
    if (this.isPersonClass(_class)) {
      return await this.findPersons(ctx, account, _class, query, options)
    }
    if (this.isPersonAttachedClass(_class)) {
      return await this.findPersonAttached(ctx, account, _class, query, options)
    }
    if (_class === (contact.class.Contact as Ref<Class<Doc>>)) {
      return await this.findContacts(ctx, account, _class, query, options)
    }
    return await this.provideFindAll(ctx, _class, query, options)
  }

  private async findPersons<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    account: Account,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    const q = query as Record<string, unknown>
    if (isPointValue(q._id) || isPointValue(q.personUuid)) {
      return await this.provideFindAll(ctx, _class, query, options)
    }
    const accounts = await this.cache.getVisibleAccounts(ctx, account.uuid)
    const newQuery = { ...q, personUuid: restrictField(q.personUuid, accounts) } as unknown as DocumentQuery<T>
    return await this.provideFindAll(ctx, _class, newQuery, options)
  }

  private async findPersonAttached<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    account: Account,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    const q = query as Record<string, unknown>
    if (isPointValue(q._id) || isPointValue(q.attachedTo)) {
      return await this.provideFindAll(ctx, _class, query, options)
    }
    // Channels of non-person contacts (e.g. organizations) are not restricted.
    const attachedToClass = q.attachedToClass
    if (typeof attachedToClass === 'string' && !this.isPersonClass(attachedToClass as Ref<Class<Doc>>)) {
      return await this.provideFindAll(ctx, _class, query, options)
    }
    const refs = await this.cache.getVisiblePersonRefs(ctx, account.uuid)
    const newQuery = { ...q, attachedTo: restrictField(q.attachedTo, refs) } as unknown as DocumentQuery<T>
    return await this.provideFindAll(ctx, _class, newQuery, options)
  }

  private async findContacts<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    account: Account,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    const q = query as Record<string, unknown>
    if (isPointValue(q._id)) return await this.provideFindAll(ctx, _class, query, options)

    const accounts = await this.cache.getVisibleAccounts(ctx, account.uuid)
    const requestedLimit = options?.limit
    let fetchLimit = requestedLimit
    let result = await this.provideFindAll(ctx, _class, query, options)
    let filtered = this.filterContacts(result, accounts)

    for (
      let round = 0;
      round < MAX_EXPAND_ROUNDS && this.shouldExpandFind(result, filtered.length, fetchLimit, requestedLimit);
      round++
    ) {
      const nextLimit = this.getNextLimit(fetchLimit, result.length, result.total)
      if (nextLimit === undefined) break
      fetchLimit = nextLimit
      result = await this.provideFindAll(ctx, _class, query, { ...options, limit: fetchLimit })
      filtered = this.filterContacts(result, accounts)
    }

    const docs = requestedLimit !== undefined ? filtered.slice(0, requestedLimit) : filtered
    // The visible total is exact only when all matches were loaded; otherwise report it as unknown
    // instead of loading the whole domain or leaking the number of hidden persons.
    const total = options?.total === true && this.isFindExhausted(result, fetchLimit) ? filtered.length : -1
    return toFindResult(docs, total, result.lookupMap)
  }

  override async searchFulltext (
    ctx: MeasureContext<SessionData>,
    query: SearchQuery,
    options: SearchOptions
  ): Promise<SearchResult> {
    const account = this.isRestrictedAccount(ctx)
    if (account === undefined) return await this.provideSearchFulltext(ctx, query, options)

    const accounts = await this.cache.getVisibleAccounts(ctx, account.uuid)
    const requestedLimit = options.limit
    let fetchLimit = requestedLimit
    let result = await this.provideSearchFulltext(ctx, query, options)
    let docs = await this.filterSearchDocs(ctx, result.docs, accounts)

    for (
      let round = 0;
      round < MAX_EXPAND_ROUNDS && this.shouldExpandSearch(result, docs.length, fetchLimit, requestedLimit);
      round++
    ) {
      const nextLimit = this.getNextLimit(fetchLimit, result.docs.length, result.total)
      if (nextLimit === undefined) break
      fetchLimit = nextLimit
      result = await this.provideSearchFulltext(ctx, query, { ...options, limit: fetchLimit })
      docs = await this.filterSearchDocs(ctx, result.docs, accounts)
    }

    const exhausted = result.total !== undefined && result.docs.length >= result.total
    return {
      docs: requestedLimit !== undefined ? docs.slice(0, requestedLimit) : docs,
      total: result.total !== undefined && exhausted ? docs.length : undefined
    }
  }

  private filterContacts<T extends Doc>(result: FindResult<T>, accounts: Set<string>): T[] {
    return result.filter((doc) => {
      if (!this.isPersonClass(doc._class)) return true
      const personUuid = (doc as unknown as Person).personUuid
      return personUuid !== undefined && accounts.has(personUuid)
    })
  }

  private async filterSearchDocs(
    ctx: MeasureContext<SessionData>,
    docs: SearchResultDoc[],
    accounts: Set<string>
  ): Promise<SearchResultDoc[]> {
    const personIds = docs.filter((it) => this.isPersonClass(it.doc._class)).map((it) => it.doc._id)
    if (personIds.length === 0) return docs

    const persons = ((await this.next?.findAll(
      ctx,
      contact.class.Person,
      { _id: { $in: personIds as Ref<Person>[] } },
      { projection: { _id: 1, personUuid: 1 } }
    )) ?? []) as Person[]
    const allowed = new Set(
      persons.filter((it) => it.personUuid !== undefined && accounts.has(it.personUuid)).map((it) => it._id)
    )
    return docs.filter(
      (it) => !this.isPersonClass(it.doc._class) || allowed.has(it.doc._id as Ref<Person>)
    )
  }

  private shouldExpandFind<T extends Doc>(
    result: FindResult<T>,
    visibleCount: number,
    fetchLimit: number | undefined,
    requestedLimit: number | undefined
  ): boolean {
    if (requestedLimit === undefined || visibleCount >= requestedLimit) return false
    return !this.isFindExhausted(result, fetchLimit)
  }

  private isFindExhausted<T extends Doc>(result: FindResult<T>, fetchLimit: number | undefined): boolean {
    if (fetchLimit === undefined || result.length < fetchLimit) return true
    return result.total >= 0 && result.length >= result.total
  }

  private shouldExpandSearch(
    result: SearchResult,
    visibleCount: number,
    fetchLimit: number | undefined,
    requestedLimit: number | undefined
  ): boolean {
    return (
      fetchLimit !== undefined &&
      result.docs.length >= fetchLimit &&
      requestedLimit !== undefined &&
      visibleCount < requestedLimit &&
      (result.total === undefined || result.docs.length < result.total)
    )
  }

  private getNextLimit(current: number | undefined, loaded: number, total: number | undefined): number | undefined {
    if (current === undefined || current >= Number.MAX_SAFE_INTEGER) return undefined
    const expanded = Math.min(Number.MAX_SAFE_INTEGER, Math.max(current + 1, current * 2))
    const next = total !== undefined && total >= 0 && loaded < total ? Math.min(expanded, total) : expanded
    return next > current ? next : undefined
  }

  override async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    // Runs before the tx is stored, so a load started right now may still read old membership with the new
    // generation. Correctness relies on the second invalidation in handleBroadcast, which runs after commit.
    for (const tx of txes) this.cache.handleTx(tx)
    return await this.provideTx(ctx, txes)
  }

  // ─── Broadcast ──────────────────────────────────────────────────────────────

  override async handleBroadcast (ctx: MeasureContext<SessionData>): Promise<void> {
    // Derived txes (triggers, other sessions) may change membership as well; invalidation is idempotent.
    for (const tx of ctx.contextData.broadcast.txes) this.cache.handleTx(tx)

    ctx.contextData.broadcast.targets.guestPerson = async (tx) => await this.getBroadcastExclude(ctx, tx)

    await this.next?.handleBroadcast(ctx)
  }

  private collectGuests (ctx: MeasureContext<SessionData>): Set<AccountUuid> {
    const guests = new Set<AccountUuid>()
    for (const val of ctx.contextData.socialStringsToUsers?.values() ?? []) {
      if (isGuestRole(val.role)) guests.add(val.accontUuid)
    }
    return guests
  }

  /**
   * Person docs live in a system space and are broadcast to everyone.
   * Exclude guests that are not allowed to see the affected person, so their live queries don't pick it up.
   */
  private async getBroadcastExclude (
    ctx: MeasureContext<SessionData>,
    tx: Tx
  ): Promise<{ exclude: AccountUuid[] } | undefined> {
    const subject = this.getBroadcastPersonSubject(tx)
    if (subject === undefined) return undefined

    const guests = this.collectGuests(ctx)
    if (guests.size === 0) return undefined

    const personUuid = subject.personUuid ?? (await this.resolvePersonUuid(ctx, subject.personRef))
    return await this.getGuestExclusions(ctx, guests, personUuid)
  }

  private getBroadcastPersonSubject (tx: Tx): BroadcastPersonSubject | undefined {
    if (!TxProcessor.isExtendsCUD(tx._class)) return undefined
    const cud = tx as TxCUD<Doc>

    if (this.isPersonClass(cud.objectClass)) {
      return {
        personRef: cud.objectId as Ref<Person>,
        personUuid:
          cud._class === core.class.TxCreateDoc ? (cud as TxCreateDoc<Person>).attributes.personUuid : undefined
      }
    }

    if (this.isPersonAttachedClass(cud.objectClass) && this.isPersonClass(cud.attachedToClass)) {
      const personRef = cud.attachedTo as Ref<Person> | undefined
      return personRef !== undefined ? { personRef } : undefined
    }
    return undefined
  }

  private async getGuestExclusions (
    ctx: MeasureContext<SessionData>,
    guests: Set<AccountUuid>,
    personUuid: string | undefined
  ): Promise<{ exclude: AccountUuid[] } | undefined> {
    const exclude: AccountUuid[] = []
    for (const guest of guests) {
      if (guest === personUuid) continue
      if (personUuid === undefined) {
        // Persons without an account are never listed for guests.
        exclude.push(guest)
        continue
      }
      const accounts = await this.cache.getVisibleAccounts(ctx, guest)
      if (!accounts.has(personUuid)) exclude.push(guest)
    }
    return exclude.length > 0 ? { exclude } : undefined
  }

  private async resolvePersonUuid (
    ctx: MeasureContext<SessionData>,
    personRef: Ref<Person>
  ): Promise<string | undefined> {
    const removed = ctx.contextData.removedMap?.get(personRef) as Person | undefined
    if (removed !== undefined) return removed.personUuid
    const persons = ((await this.next?.findAll(
      ctx,
      contact.class.Person,
      { _id: personRef },
      { limit: 1, projection: { _id: 1, personUuid: 1 } }
    )) ?? []) as Person[]
    return persons[0]?.personUuid
  }
}
