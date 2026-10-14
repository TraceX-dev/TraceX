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
  AccountRole,
  DOMAIN_MODEL,
  docGuestAccountUuid,
  toFindResult,
  TxProcessor,
  type Class,
  type Doc,
  type DocumentQuery,
  type Domain,
  type FindResult,
  type MeasureContext,
  type Ref,
  type RefTo,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  type SessionData,
  type Space,
  type Tx,
  type TxCUD,
  type WithLookup
} from '@hcengineering/core'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import view, { type ObjectPresenter } from '@hcengineering/view'
import contact from '@hcengineering/contact'
import { docGuestPeopleKey, isDerivedSafe, isPersonClass, restrictField, type DocGuestPeople } from './guestPersonUtils'

/**
 * `guest.class.PublicLink`. Spelled out to keep the guest plugin out of the server dependencies.
 */
export const publicLinkClass = 'guest:class:PublicLink' as Ref<Class<Doc>>

const maxParentDepth = 8
const maxRefillFetch = 1000
const maxRefillRounds = 4
const maxKnownRefs = 10000
const scopeTtlMs = 5 * 60 * 1000
const personFields = [
  '_id',
  '_class',
  'space',
  'modifiedOn',
  'name',
  'avatar',
  'avatarType',
  'avatarProps',
  'personUuid',
  'active',
  'displayName'
]
const socialIdentityFields = [
  '_id',
  '_class',
  'space',
  'modifiedOn',
  'attachedTo',
  'attachedToClass',
  'collection',
  'type'
]

/**
 * Objects a DocGuest session of one public link may read.
 * @public
 */
export interface DocGuestScope {
  linkId: Ref<Doc>
  root: Ref<Doc>
  loadedAt: number
  /** The linked document, the link itself and everything attached (directly or transitively) to them. */
  owned: Set<Ref<Doc>>
  /** Targets of Ref attributes of owned objects. Readable only through `ObjectPresenter.requiredFields`. */
  refs: Set<Ref<Doc>>
  /** Spaces of owned objects. Readable without membership details. */
  spaces: Set<Ref<Space>>
  /** Accounts of the collaborators of the linked document. */
  accounts: Set<string>
  /** Persons of those accounts: the only persons readable (by name and avatar). */
  persons: Set<Ref<Doc>>
  /** Part of `accounts` already resolved to persons. */
  resolved: Set<string>
}

/**
 * Restricts DocGuest sessions (shared-link tokens) to the document the public link points to.
 *
 * Without this middleware a DocGuest reads the whole workspace: space security is skipped for the role and the
 * link restrictions are enforced by the client only.
 *
 * A DocGuest may read:
 * - the linked document, its `PublicLink` and objects attached to them (comments, attachments, ...);
 * - spaces of those objects, without members and owners;
 * - objects referenced from them, limited to `ObjectPresenter.requiredFields` of the referenced class
 *   (classes without `requiredFields` stay hidden);
 * - persons who are collaborators of the linked document, reduced to name and avatar, with their social ids reduced
 *   to the id; other persons and contact details (channels, social id values) stay hidden. The same set is
 *   published to `GuestPersonMiddleware` through the context cache, which keeps restricting DocGuest;
 * - model classes (read from the model domain).
 *
 * Everything else is filtered out, including `$lookup` and `$associations` results. Sessions without a link id
 * read nothing. Fulltext search and `groupBy` are closed. Writes are rejected by `GuestPermissionsMiddleware`.
 */
export class DocGuestMiddleware extends BaseMiddleware implements Middleware {
  private readonly scopes = new Map<string, DocGuestScope>()
  private readonly loading = new Map<string, Promise<DocGuestScope | undefined>>()

  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
  }

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<DocGuestMiddleware> {
    return new DocGuestMiddleware(context, next)
  }

  // ─── Find ───────────────────────────────────────────────────────────────────

  override async findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    const account = ctx.contextData?.account
    if (account === undefined || account.role !== AccountRole.DocGuest) {
      return await this.provideFindAll(ctx, _class, query, options)
    }
    const h = this.context.hierarchy
    if (h.findDomain(_class) === DOMAIN_MODEL) {
      return await this.provideFindAll(ctx, _class, query, options)
    }
    const scope = await this.getScope(ctx, ctx.contextData.guestLinkId)
    if (scope === undefined) return toFindResult<T>([], 0)

    await this.resolvePersons(ctx, scope)
    this.publishPeople(ctx, scope)
    const prepared = this.prepareQuery(scope, _class, query)
    if (prepared === undefined) return toFindResult<T>([], 0)
    const fetchOptions = this.prepareOptions(options)

    const requestedLimit = options?.limit
    let fetchLimit = requestedLimit
    let result = await this.provideFindAll(ctx, _class, prepared, { ...fetchOptions, limit: fetchLimit })
    let docs = await this.filterDocs(ctx, scope, result, options)

    for (let round = 0; round < maxRefillRounds; round++) {
      if (fetchLimit === undefined || requestedLimit === undefined) break
      if (result.length < fetchLimit || docs.length >= requestedLimit || fetchLimit >= maxRefillFetch) break
      fetchLimit = Math.min(maxRefillFetch, fetchLimit * 2)
      result = await this.provideFindAll(ctx, _class, prepared, { ...fetchOptions, limit: fetchLimit })
      docs = await this.filterDocs(ctx, scope, result, options)
    }

    const visible = requestedLimit !== undefined ? docs.slice(0, requestedLimit) : docs
    return toFindResult<T>(visible, options?.total === true ? docs.length : -1, result.lookupMap)
  }

  /**
   * Narrows the query so the database does not return objects outside of the scope.
   * Returns `undefined` when nothing can match.
   */
  private prepareQuery<T extends Doc>(
    scope: DocGuestScope,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>
  ): DocumentQuery<T> | undefined {
    const h = this.context.hierarchy
    const q: Record<string, any> = { ...query }

    if (isDerivedSafe(h, _class, core.class.Space)) {
      q._id = restrictField(q._id, scope.spaces)
      return q as DocumentQuery<T>
    }
    if (isDerivedSafe(h, _class, contact.class.Contact)) {
      q._id = restrictField(q._id, [...scope.persons, ...scope.refs])
      return q as DocumentQuery<T>
    }
    if (isDerivedSafe(h, _class, contact.class.SocialIdentity)) {
      q.attachedTo = restrictField(q.attachedTo, scope.persons)
      return q as DocumentQuery<T>
    }
    // Contact details never reach a DocGuest.
    if (isDerivedSafe(h, _class, contact.class.Channel)) return undefined
    if (isDerivedSafe(h, _class, core.class.AttachedDoc)) {
      // Attached objects are found through their parent; the parent chain is verified for every result.
      if (q._id === undefined) {
        q.attachedTo = restrictField(q.attachedTo, scope.owned)
      }
      return q as DocumentQuery<T>
    }
    q._id = restrictField(q._id, [...scope.owned, ...scope.refs])
    return q as DocumentQuery<T>
  }

  private prepareOptions<T extends Doc>(options?: ServerFindOptions<T>): ServerFindOptions<T> | undefined {
    if (options === undefined) return undefined
    const { unsecured, ...rest } = options
    if (rest.projection === undefined) return rest
    // Fields required to decide whether a result belongs to the scope.
    return {
      ...rest,
      projection: { ...rest.projection, _id: 1, _class: 1, space: 1, attachedTo: 1, attachedToClass: 1 }
    }
  }

  private async filterDocs<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    scope: DocGuestScope,
    docs: FindResult<T>,
    options?: ServerFindOptions<T>
  ): Promise<T[]> {
    const result: T[] = []
    for (const doc of docs) {
      const visible = await this.visibleDoc(ctx, scope, doc)
      if (visible === undefined) continue
      result.push(
        (options?.lookup !== undefined || options?.associations !== undefined
          ? await this.filterNested(ctx, scope, visible)
          : visible) as T
      )
    }
    return result
  }

  /**
   * The object as the DocGuest may see it, or `undefined` when it is outside of the scope.
   * Owned objects are returned as is, referenced ones are reduced to their presenter fields.
   */
  private async visibleDoc<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    scope: DocGuestScope,
    doc: T
  ): Promise<T | undefined> {
    const h = this.context.hierarchy
    if (isDerivedSafe(h, doc._class, core.class.Space)) {
      return scope.spaces.has(doc._id as unknown as Ref<Space>) ? this.sanitizeSpace(doc) : undefined
    }
    if (isPersonClass(h, doc._class)) {
      return scope.persons.has(doc._id) ? this.limitPerson(doc) : undefined
    }
    if (isDerivedSafe(h, doc._class, contact.class.SocialIdentity)) {
      const owner = (doc as unknown as { attachedTo?: Ref<Doc> }).attachedTo
      return owner !== undefined && scope.persons.has(owner) ? this.limitSocialIdentity(doc) : undefined
    }
    if (isDerivedSafe(h, doc._class, contact.class.Channel)) return undefined
    if (scope.owned.has(doc._id)) {
      this.learn(scope, doc)
      return doc
    }
    if (await this.isAttachedToOwned(ctx, scope, doc, 0)) {
      scope.owned.add(doc._id)
      this.learn(scope, doc)
      return doc
    }
    if (scope.refs.has(doc._id)) return this.limitToPresenter(doc)
    return undefined
  }

  private async isAttachedToOwned (
    ctx: MeasureContext<SessionData>,
    scope: DocGuestScope,
    doc: Doc,
    depth: number
  ): Promise<boolean> {
    const attached = doc as unknown as { attachedTo?: Ref<Doc>, attachedToClass?: Ref<Class<Doc>> }
    const parentId = attached.attachedTo
    if (parentId === undefined || depth >= maxParentDepth) return false
    if (scope.owned.has(parentId)) return true
    const parentClass = attached.attachedToClass
    if (parentClass === undefined) return false
    const parent = (await this.provideFindAll(ctx, parentClass, { _id: parentId }, { limit: 1 }))[0]
    if (parent === undefined || !(await this.isAttachedToOwned(ctx, scope, parent, depth + 1))) return false
    scope.owned.add(parentId)
    return true
  }

  /** Remembers the space and the referenced objects of an owned object. */
  private learn (scope: DocGuestScope, doc: Doc): void {
    if (doc.space !== undefined && !isDerivedSafe(this.context.hierarchy, doc._class, core.class.Space)) {
      scope.spaces.add(doc.space)
    }
    if (scope.refs.size >= maxKnownRefs) return
    const h = this.context.hierarchy
    let attributes
    try {
      attributes = h.getAllAttributes(doc._class)
    } catch {
      return
    }
    for (const [key, attr] of attributes) {
      const value = (doc as any)[key]
      if (value === undefined || value === null) continue
      const type = attr.type
      if ((type._class === core.class.RefTo || type._class === core.class.TypeBlob) && typeof value === 'string') {
        this.addRef(scope, type, value as Ref<Doc>)
      } else if (type._class === core.class.ArrOf && Array.isArray(value)) {
        const of = (type as any).of
        if (of?._class !== core.class.RefTo) continue
        for (const it of value) if (typeof it === 'string') this.addRef(scope, of, it as Ref<Doc>)
      }
    }
  }

  private addRef (scope: DocGuestScope, type: { _class: Ref<Class<Doc>> }, id: Ref<Doc>): void {
    const to = type._class === core.class.RefTo ? (type as unknown as RefTo<Doc>).to : undefined
    // Persons are visible only as collaborators of the linked document.
    if (to !== undefined && isPersonClass(this.context.hierarchy, to)) return
    scope.refs.add(id)
  }

  /** Hands the visible people over to `GuestPersonMiddleware`, which sees the same request context. */
  private publishPeople (ctx: MeasureContext<SessionData>, scope: DocGuestScope): void {
    const people: DocGuestPeople = { accounts: new Set(scope.accounts), personRefs: new Set(scope.persons) }
    ctx.contextData.contextCache?.set(docGuestPeopleKey, people)
  }

  /** Loads the collaborators of the linked document. */
  private async loadCollaborators (ctx: MeasureContext<SessionData>, scope: DocGuestScope): Promise<void> {
    const collaborators = await this.provideFindAll(ctx, core.class.Collaborator, { attachedTo: scope.root })
    scope.accounts = new Set()
    scope.persons = new Set()
    scope.resolved = new Set()
    for (const it of collaborators) {
      const account = (it as unknown as { collaborator?: string }).collaborator
      if (typeof account === 'string') scope.accounts.add(account)
    }
  }

  /** Adds persons of the collaborator accounts to the scope. */
  private async resolvePersons (ctx: MeasureContext<SessionData>, scope: DocGuestScope): Promise<void> {
    const accounts = [...scope.accounts].filter((it) => !scope.resolved.has(it))
    if (accounts.length === 0) return
    const persons = await this.provideFindAll(
      ctx,
      contact.class.Person,
      { personUuid: { $in: accounts } } as any,
      { projection: { _id: 1 } } as any
    )
    for (const person of persons) scope.persons.add(person._id)
    for (const account of accounts) scope.resolved.add(account)
  }

  /** Name and avatar only: no birthday, city, profile or mixin data. */
  private limitPerson<T extends Doc>(doc: T): T {
    const source = doc as unknown as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of personFields) if (source[key] !== undefined) result[key] = source[key]
    return result as unknown as T
  }

  /** The id and the person it belongs to, without the value of the identity. */
  private limitSocialIdentity<T extends Doc>(doc: T): T {
    const source = doc as unknown as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of socialIdentityFields) if (source[key] !== undefined) result[key] = source[key]
    return result as unknown as T
  }

  private limitToPresenter<T extends Doc>(doc: T): T | undefined {
    // Files of the linked document are readable through the front service, which asks for the blob.
    if (isDerivedSafe(this.context.hierarchy, doc._class, core.class.Blob)) {
      const blob = doc as unknown as Record<string, unknown>
      return {
        _id: doc._id,
        _class: doc._class,
        space: doc.space,
        contentType: blob.contentType,
        size: blob.size
      } as unknown as T
    }
    const presenter = this.context.hierarchy.classHierarchyMixin<Doc, ObjectPresenter>(
      doc._class,
      view.mixin.ObjectPresenter
    )
    const fields = presenter?.requiredFields
    if (fields === undefined) return undefined
    const source = doc as unknown as Record<string, unknown>
    const result: Record<string, unknown> = { _id: doc._id, _class: doc._class, space: doc.space }
    for (const field of fields) {
      if (source[field] !== undefined) result[field] = source[field]
    }
    return result as unknown as T
  }

  private sanitizeSpace<T extends Doc>(space: T): T {
    return { ...space, members: [], owners: [] }
  }

  // Nested results are copied because concurrent queries may share documents.
  private async filterNested (
    ctx: MeasureContext<SessionData>,
    scope: DocGuestScope,
    doc: WithLookup<Doc>
  ): Promise<WithLookup<Doc>> {
    if (doc.$lookup === undefined && doc.$associations === undefined) return doc
    const result: WithLookup<Doc> = { ...doc }
    await this.resolvePersons(ctx, scope)
    this.publishPeople(ctx, scope)

    const filterOne = async (target: WithLookup<Doc>): Promise<WithLookup<Doc> | undefined> => {
      const visible = await this.visibleDoc(ctx, scope, target)
      return visible === undefined ? undefined : await this.filterNested(ctx, scope, visible)
    }

    if (doc.$lookup !== undefined) {
      const lookup: Record<string, any> = {}
      for (const [key, value] of Object.entries(doc.$lookup as Record<string, any>)) {
        if (Array.isArray(value)) {
          const items = await Promise.all(value.map(filterOne))
          lookup[key] = items.filter((it) => it !== undefined)
        } else if (value !== undefined) {
          lookup[key] = await filterOne(value)
        }
      }
      result.$lookup = lookup
    }
    if (doc.$associations !== undefined) {
      const associations: Record<string, Doc[]> = {}
      for (const [key, targets] of Object.entries(doc.$associations)) {
        const items = await Promise.all(targets.map(filterOne))
        associations[key] = items.filter((it): it is WithLookup<Doc> => it !== undefined)
      }
      result.$associations = associations
    }
    return result
  }

  // ─── Closed operations ──────────────────────────────────────────────────────

  override async searchFulltext (
    ctx: MeasureContext<SessionData>,
    query: SearchQuery,
    options: SearchOptions
  ): Promise<SearchResult> {
    if (ctx.contextData?.account?.role === AccountRole.DocGuest) return { docs: [], total: 0 }
    return await this.provideSearchFulltext(ctx, query, options)
  }

  override async groupBy<T, P extends Doc>(
    ctx: MeasureContext<SessionData>,
    domain: Domain,
    field: string,
    query?: DocumentQuery<P>
  ): Promise<Map<T, number>> {
    if (ctx.contextData?.account?.role === AccountRole.DocGuest) return new Map<T, number>()
    return await this.provideGroupBy(ctx, domain, field, query)
  }

  // ─── Scope ──────────────────────────────────────────────────────────────────

  private async getScope (
    ctx: MeasureContext<SessionData>,
    linkId: string | undefined
  ): Promise<DocGuestScope | undefined> {
    // A DocGuest without a link is not bound to any document.
    if (linkId === undefined || linkId === '') return undefined
    const cached = this.scopes.get(linkId)
    if (cached !== undefined && Date.now() - cached.loadedAt < scopeTtlMs) return cached

    let loading = this.loading.get(linkId)
    if (loading === undefined) {
      loading = this.loadScope(ctx, linkId as Ref<Doc>)
      this.loading.set(linkId, loading)
      const clear = (): void => {
        if (this.loading.get(linkId) === loading) this.loading.delete(linkId)
      }
      loading.then(clear, clear)
    }
    return await loading
  }

  private async loadScope (ctx: MeasureContext<SessionData>, linkId: Ref<Doc>): Promise<DocGuestScope | undefined> {
    const links = await this.provideFindAll(ctx, publicLinkClass, { _id: linkId }, { limit: 1 })
    const link = links[0] as (Doc & { attachedTo?: Ref<Doc> }) | undefined
    if (link?.attachedTo === undefined) {
      this.scopes.delete(linkId)
      return undefined
    }
    const previous = this.scopes.get(linkId)
    const scope: DocGuestScope =
      previous !== undefined && previous.root === link.attachedTo
        ? { ...previous, loadedAt: Date.now() }
        : {
            linkId,
            root: link.attachedTo,
            loadedAt: Date.now(),
            owned: new Set([linkId, link.attachedTo]),
            refs: new Set(),
            spaces: new Set(),
            accounts: new Set(),
            persons: new Set(),
            resolved: new Set()
          }
    await this.loadCollaborators(ctx, scope)
    this.scopes.set(linkId, scope)
    return scope
  }

  // ─── Tx and broadcast ───────────────────────────────────────────────────────

  override async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const result = await this.provideTx(ctx, txes)
    for (const tx of txes) this.handleTx(tx)
    return result
  }

  override async handleBroadcast (ctx: MeasureContext<SessionData>): Promise<void> {
    for (const tx of ctx.contextData.broadcast.txes) this.handleTx(tx)

    // The DocGuest account is shared by all links, so a transaction is delivered to DocGuest sessions only when it
    // belongs to some active link.
    ctx.contextData.broadcast.targets.docGuest = async (tx) =>
      this.isRelatedToAnyScope(tx) ? undefined : { exclude: [docGuestAccountUuid] }

    await this.next?.handleBroadcast(ctx)
  }

  private handleTx (tx: Tx): void {
    if (!TxProcessor.isExtendsCUD(tx._class)) return
    const cud = tx as TxCUD<Doc>
    const h = this.context.hierarchy
    if (isDerivedSafe(h, cud.objectClass, publicLinkClass)) {
      // Revoked or retargeted link.
      if (cud._class !== core.class.TxCreateDoc) this.scopes.delete(cud.objectId)
      return
    }
    if (isDerivedSafe(h, cud.objectClass, core.class.Collaborator)) {
      // The people of the document changed: reload them with the next request.
      for (const scope of this.scopes.values()) {
        if (cud.attachedTo === scope.root || cud._class === core.class.TxRemoveDoc) scope.loadedAt = 0
      }
    }
    if (cud._class === core.class.TxRemoveDoc) {
      for (const scope of this.scopes.values()) {
        scope.owned.delete(cud.objectId)
        scope.refs.delete(cud.objectId)
      }
      return
    }
    if (cud._class === core.class.TxCreateDoc && cud.attachedTo !== undefined) {
      for (const scope of this.scopes.values()) {
        if (scope.owned.has(cud.attachedTo)) scope.owned.add(cud.objectId)
      }
    }
  }

  private isRelatedToAnyScope (tx: Tx): boolean {
    if (this.scopes.size === 0) return false
    if (!TxProcessor.isExtendsCUD(tx._class)) return false
    const cud = tx as TxCUD<Doc>
    for (const scope of this.scopes.values()) {
      if (scope.owned.has(cud.objectId) || scope.refs.has(cud.objectId)) return true
      if (cud.attachedTo !== undefined && scope.owned.has(cud.attachedTo)) return true
    }
    return false
  }
}
