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
  ACCESS_ROOT_FIELD,
  type AccessAudience,
  type AccessMarked,
  type AccountUuid,
  canReadByAudience,
  type Class,
  type ClassAccessPolicy,
  type Collaborator,
  DEFAULT_ACCESS_PARENT,
  type Doc,
  type DocumentQuery,
  type Domain,
  DOMAIN_MODEL,
  DOMAIN_TX,
  type FindOptions,
  getAccessAudience,
  getAccessMembers,
  getAccessOwners,
  getAccessParents,
  getAccessParticipants,
  getAccessPolicyClasses,
  getAccessReaders,
  getAccessRoot,
  getClassAccessPolicy,
  type Hierarchy,
  type MeasureContext,
  type Ref,
  type Space,
  systemAccountUuid
} from '@hcengineering/core'
import type { PipelineContext } from '@hcengineering/server-core'

/**
 * Unrestricted find used by the object access state (no security middlewares below it).
 * @public
 */
export type AccessFinder = <T extends Doc>(
  ctx: MeasureContext,
  _class: Ref<Class<T>>,
  query: DocumentQuery<T>,
  options?: FindOptions<T>
) => Promise<T[]>

/**
 * @public
 */
export interface AccessParentRef {
  _id: Ref<Doc>
  _class: Ref<Class<Doc>>
}

/**
 * @public
 */
export interface AccessRootInfo {
  _id: Ref<Doc>
  _class: Ref<Class<Doc>>
  space: Ref<Space>
  audience: AccessAudience
  members: Set<AccountUuid>
  owners: Set<AccountUuid>
  parent?: AccessParentRef
}

/**
 * `undefined` — not restricted (everyone with space access), otherwise the exact set of readers.
 * @public
 */
export type AccessReaders = Set<AccountUuid> | undefined

interface ParticipantsEntry {
  _class: Ref<Class<Doc>>
  // Attribute of the parent with AccountUuid[]; undefined means core.class.Collaborator.
  field?: string
  accounts: Set<AccountUuid>
  roots: Set<Ref<Doc>>
}

interface DomainInfo {
  domains: Set<Domain>
  parentFields: Map<Domain, Set<string>>
}

const DOC_ROOT_CACHE_SIZE = 50000

class BoundedCache<K, V> {
  private readonly map = new Map<K, V>()

  constructor (private readonly limit: number) {}

  get (key: K): V | undefined {
    return this.map.get(key)
  }

  set (key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    } else if (this.map.size >= this.limit) {
      const oldest = this.map.keys().next()
      if (oldest.done !== true) this.map.delete(oldest.value)
    }
    this.map.set(key, value)
  }

  delete (key: K): void {
    this.map.delete(key)
  }
}

const states = new WeakMap<PipelineContext, ObjectAccessState>()

/**
 * The state is shared between the object security middleware (user requests)
 * and the object access marker middleware (all transactions, including derived ones).
 * There is one transactor per workspace, so an in-memory state is consistent.
 * @public
 */
export function getObjectAccessState (context: PipelineContext): ObjectAccessState {
  let state = states.get(context)
  if (state === undefined) {
    state = new ObjectAccessState(context)
    states.set(context, state)
  }
  return state
}

/**
 * @public
 */
export class ObjectAccessState {
  private readonly roots = new Map<Ref<Doc>, AccessRootInfo>()
  private readonly participants = new Map<Ref<Doc>, ParticipantsEntry>()
  private readonly collaborators = new Map<Ref<Collaborator>, { parent: Ref<Doc>, account: AccountUuid }>()
  private readonly docRoots = new BoundedCache<Ref<Doc>, Ref<Doc> | null>(DOC_ROOT_CACHE_SIZE)
  private readonly readable = new Map<AccountUuid, Ref<Doc>[]>()
  private domainInfo: DomainInfo | undefined
  private finder: AccessFinder | undefined
  private initPromise: Promise<void> | undefined
  private initialized = false
  // Marks exist in the workspace. Once true it stays true: marks outlive their roots (e.g. stored txes
  // of a removed private object), so the filter must keep hiding them.
  private marked = false

  constructor (readonly context: PipelineContext) {}

  get hierarchy (): Hierarchy {
    return this.context.hierarchy
  }

  setFinder (finder: AccessFinder): void {
    this.finder = finder
  }

  async init (ctx: MeasureContext): Promise<void> {
    if (this.initialized) return
    if (this.initPromise === undefined) {
      this.initPromise = ctx.with('init-object-access', {}, (ctx) => this.load(ctx))
    }
    try {
      await this.initPromise
      this.initialized = true
    } catch (err: any) {
      // Retry on the next request instead of failing forever.
      this.initPromise = undefined
      throw err
    }
  }

  /**
   * False when the workspace has never had restricted objects: all checks can be skipped.
   */
  isActive (): boolean {
    return this.marked || this.roots.size > 0
  }

  getRoot (_id: Ref<Doc>): AccessRootInfo | undefined {
    return this.roots.get(_id)
  }

  isRoot (_id: Ref<Doc>): boolean {
    return this.roots.has(_id)
  }

  // ---------------------------------------------------------------------------------------------
  // Domains

  onModelChanged (): void {
    this.domainInfo = undefined
  }

  private getDomainInfo (): DomainInfo {
    if (this.domainInfo !== undefined) return this.domainInfo
    const h = this.hierarchy
    const domains = new Set<Domain>([DOMAIN_TX])
    const parentFields = new Map<Domain, Set<string>>()
    for (const _class of h.getDescendants(core.class.Doc)) {
      if (h.isMixin(_class)) continue
      const domain = h.findDomain(_class)
      if (domain === undefined || domain === DOMAIN_MODEL || domain === DOMAIN_TX) continue
      const policy = getClassAccessPolicy(h, _class)
      const accessParent = h.classHierarchyMixin(_class, core.mixin.AccessParent)
      const hasAttachedTo = h.findAttribute(_class, DEFAULT_ACCESS_PARENT.field) !== undefined
      if (policy === undefined && accessParent === undefined && !hasAttachedTo) continue
      domains.add(domain)
      if (accessParent !== undefined || hasAttachedTo) {
        const fields = parentFields.get(domain) ?? new Set<string>()
        for (const ref of getAccessParents(h, _class)) {
          fields.add(ref.field)
        }
        parentFields.set(domain, fields)
      }
    }
    this.domainInfo = { domains, parentFields }
    return this.domainInfo
  }

  /**
   * True when documents of the domain may belong to a security root.
   */
  isProtectedDomain (domain: Domain): boolean {
    return this.getDomainInfo().domains.has(domain)
  }

  getProtectedDomains (): Domain[] {
    return Array.from(this.getDomainInfo().domains)
  }

  getParentFields (domain: Domain): string[] {
    return Array.from(this.getDomainInfo().parentFields.get(domain) ?? [])
  }

  // ---------------------------------------------------------------------------------------------
  // Loading

  private requireFinder (): AccessFinder {
    if (this.finder === undefined) {
      throw new Error('Object access finder is not configured')
    }
    return this.finder
  }

  private async load (ctx: MeasureContext): Promise<void> {
    const find = this.requireFinder()
    const policyClasses = getAccessPolicyClasses(this.hierarchy)
    const docs = new Map<Ref<Doc>, Doc>()
    for (const _class of policyClasses) {
      const result = await find(ctx, _class, {
        [ACCESS_ROOT_FIELD]: { $exists: true }
      })
      for (const doc of result) {
        // A root points to itself; descendants of other roots in the same domain are skipped.
        if (getAccessRoot(doc) === doc._id) docs.set(doc._id, doc)
      }
    }
    for (const doc of docs.values()) {
      const info = this.buildRootInfo(doc)
      if (info !== undefined) this.roots.set(info._id, info)
    }
    if (this.roots.size > 0) {
      this.marked = true
    } else if (policyClasses.length > 0) {
      // Roots may all be removed while their stored txes are still marked. The creation tx of a root is
      // always marked and the tx domain is indexed by objectClass, so this lookup is cheap.
      const classes = policyClasses.flatMap((it) => this.hierarchy.getDescendants(it))
      const txes = await find(
        ctx,
        core.class.Tx,
        { objectClass: { $in: classes }, [ACCESS_ROOT_FIELD]: { $exists: true } },
        { limit: 1, projection: { _id: 1 } }
      )
      this.marked = txes.length > 0
    }
    const parents = new Map<Ref<Doc>, AccessParentRef>()
    for (const info of this.roots.values()) {
      if (info.audience.kind === 'parentParticipants' && info.parent !== undefined) {
        parents.set(info.parent._id, info.parent)
      }
    }
    await this.loadParticipants(ctx, Array.from(parents.values()))
    for (const info of this.roots.values()) {
      if (info.parent !== undefined) {
        this.participants.get(info.parent._id)?.roots.add(info._id)
      }
    }
  }

  /**
   * Builds the root description from a stored document (or a document built from a create tx).
   */
  buildRootInfo (
    doc: Doc,
    audienceOverride?: AccessAudience,
    ownersOverride?: AccountUuid[]
  ): AccessRootInfo | undefined {
    const policy = getClassAccessPolicy(this.hierarchy, doc._class)
    if (policy === undefined) return undefined
    const audience = audienceOverride ?? getAccessAudience(this.hierarchy, doc)
    if (audience === undefined) return undefined
    return {
      _id: doc._id,
      _class: doc._class,
      space: doc.space,
      audience,
      members: new Set(getAccessMembers(doc, policy)),
      owners: new Set(ownersOverride ?? getAccessOwners(this.hierarchy, doc)),
      parent: this.getPolicyParent(doc, policy)
    }
  }

  private getPolicyParent (doc: Doc, policy: ClassAccessPolicy): AccessParentRef | undefined {
    const ref = policy.parent ?? DEFAULT_ACCESS_PARENT
    const record = doc as unknown as Record<string, unknown>
    const _id = record[ref.field]
    const _class = record[ref.classField]
    if (typeof _id !== 'string' || typeof _class !== 'string') return undefined
    return { _id: _id as Ref<Doc>, _class: _class as Ref<Class<Doc>> }
  }

  private async loadParticipants (ctx: MeasureContext, parents: AccessParentRef[]): Promise<void> {
    const missing = parents.filter((it) => !this.participants.has(it._id))
    if (missing.length === 0) return
    const find = this.requireFinder()
    const byCollaborators: Ref<Doc>[] = []
    const byField = new Map<Ref<Class<Doc>>, { field: string, ids: Ref<Doc>[] }>()
    for (const parent of missing) {
      const field = getAccessParticipants(this.hierarchy, parent._class)?.membersField
      this.participants.set(parent._id, { _class: parent._class, field, accounts: new Set(), roots: new Set() })
      if (field === undefined) {
        byCollaborators.push(parent._id)
      } else {
        const entry = byField.get(parent._class) ?? { field, ids: [] }
        entry.ids.push(parent._id)
        byField.set(parent._class, entry)
      }
    }
    if (byCollaborators.length > 0) {
      const collaborators = await find(ctx, core.class.Collaborator, { attachedTo: { $in: byCollaborators } })
      for (const collaborator of collaborators) {
        this.addCollaborator(collaborator)
      }
    }
    for (const [_class, { field, ids }] of byField.entries()) {
      if (!this.hierarchy.hasClass(_class)) continue
      const docs = await find(ctx, _class, { _id: { $in: ids } })
      for (const doc of docs) {
        const entry = this.participants.get(doc._id)
        const value = (doc as unknown as Record<string, unknown>)[field]
        if (entry !== undefined && Array.isArray(value)) {
          entry.accounts = new Set(value.filter((it): it is AccountUuid => typeof it === 'string'))
        }
      }
    }
    this.invalidate()
  }

  // ---------------------------------------------------------------------------------------------
  // Mutations (called by the marker middleware)

  async setRoot (ctx: MeasureContext, info: AccessRootInfo): Promise<void> {
    const prev = this.roots.get(info._id)
    if (prev?.parent !== undefined && prev.parent._id !== info.parent?._id) {
      this.participants.get(prev.parent._id)?.roots.delete(info._id)
    }
    this.roots.set(info._id, info)
    this.marked = true
    this.docRoots.set(info._id, info._id)
    if (info.parent !== undefined) {
      if (info.audience.kind === 'parentParticipants') {
        await this.loadParticipants(ctx, [info.parent])
      }
      this.participants.get(info.parent._id)?.roots.add(info._id)
    }
    this.invalidate()
  }

  removeRoot (_id: Ref<Doc>): void {
    const prev = this.roots.get(_id)
    if (prev === undefined) return
    this.roots.delete(_id)
    if (prev.parent !== undefined) {
      const entry = this.participants.get(prev.parent._id)
      entry?.roots.delete(_id)
      if (entry !== undefined && entry.roots.size === 0) {
        this.participants.delete(prev.parent._id)
        for (const [id, value] of this.collaborators.entries()) {
          if (value.parent === prev.parent._id) this.collaborators.delete(id)
        }
      }
    }
    this.invalidate()
  }

  /**
   * A root created in the current request: derived documents produced by triggers (which run before
   * the request state is applied) must already resolve to it.
   */
  notePendingRoot (_id: Ref<Doc>): void {
    this.docRoots.set(_id, _id)
    this.marked = true
  }

  setDocRoot (_id: Ref<Doc>, root: Ref<Doc> | undefined): void {
    this.docRoots.set(_id, root ?? null)
  }

  forgetDoc (_id: Ref<Doc>): void {
    this.docRoots.delete(_id)
  }

  isTrackedParent (_id: Ref<Doc>): boolean {
    return this.participants.has(_id)
  }

  getParticipantsField (_id: Ref<Doc>): string | undefined {
    return this.participants.get(_id)?.field
  }

  getParentParticipants (_id: Ref<Doc>): ReadonlySet<AccountUuid> | undefined {
    return this.participants.get(_id)?.accounts
  }

  /**
   * Roots whose readers depend on the participants of the given parent.
   */
  getDependentRoots (parent: Ref<Doc>): Ref<Doc>[] {
    return Array.from(this.participants.get(parent)?.roots ?? []).filter(
      (it) => this.roots.get(it)?.audience.kind === 'parentParticipants'
    )
  }

  setParentParticipants (parent: Ref<Doc>, accounts: Iterable<AccountUuid>): void {
    const entry = this.participants.get(parent)
    if (entry === undefined) return
    entry.accounts = new Set(accounts)
    this.invalidate()
  }

  /**
   * Returns true when the collaborator belongs to a tracked parent.
   */
  addCollaborator (collaborator: Pick<Collaborator, '_id' | 'attachedTo' | 'collaborator'>): boolean {
    const entry = this.participants.get(collaborator.attachedTo)
    if (entry === undefined || entry.field !== undefined) return false
    entry.accounts.add(collaborator.collaborator)
    this.collaborators.set(collaborator._id, { parent: collaborator.attachedTo, account: collaborator.collaborator })
    this.invalidate()
    return true
  }

  /**
   * Returns the affected parent and account when the collaborator was tracked.
   */
  removeCollaborator (_id: Ref<Collaborator>): { parent: Ref<Doc>, account: AccountUuid } | undefined {
    const value = this.collaborators.get(_id)
    if (value === undefined) return undefined
    this.collaborators.delete(_id)
    const entry = this.participants.get(value.parent)
    if (entry !== undefined) {
      const stillPresent = Array.from(this.collaborators.values()).some(
        (it) => it.parent === value.parent && it.account === value.account
      )
      if (!stillPresent) entry.accounts.delete(value.account)
    }
    this.invalidate()
    return value
  }

  private invalidate (): void {
    this.readable.clear()
  }

  // ---------------------------------------------------------------------------------------------
  // Queries

  getReaders (root: AccessRootInfo): AccessReaders {
    const participants = root.parent !== undefined ? this.participants.get(root.parent._id)?.accounts : undefined
    return getAccessReaders(root.audience, root.members, participants)
  }

  canReadRoot (account: AccountUuid, rootId: Ref<Doc>): boolean {
    if (account === systemAccountUuid) return true
    const root = this.roots.get(rootId)
    // A mark pointing to an unknown root is closed (fail-closed).
    if (root === undefined) return false
    const participants = root.parent !== undefined ? this.participants.get(root.parent._id)?.accounts : undefined
    return canReadByAudience(account, root.audience, root.members, participants)
  }

  /**
   * All roots the account can read. Used as the allow-list of the `accessRoot` query condition.
   */
  getReadableRoots (account: AccountUuid): Ref<Doc>[] {
    let result = this.readable.get(account)
    if (result === undefined) {
      result = []
      for (const _id of this.roots.keys()) {
        if (this.canReadRoot(account, _id)) result.push(_id)
      }
      this.readable.set(account, result)
    }
    return result
  }

  /**
   * Loads a document without security checks.
   */
  async loadDoc (ctx: MeasureContext, _class: Ref<Class<Doc>>, _id: Ref<Doc>): Promise<Doc | undefined> {
    if (!this.hierarchy.hasClass(_class)) return undefined
    const docs = await this.requireFinder()(ctx, _class, { _id }, { limit: 1 })
    return docs[0]
  }

  /**
   * Resolves the security root of an existing document.
   * The class is only used to pick the domain: the lookup is by id, so a client cannot hide a document
   * of the same domain behind another class.
   * `pending` holds roots of documents created earlier in the same request.
   */
  async resolveDocRoot (
    ctx: MeasureContext,
    _id: Ref<Doc>,
    _class: Ref<Class<Doc>> | undefined,
    pending?: Map<Ref<Doc>, Ref<Doc> | null>
  ): Promise<Ref<Doc> | undefined> {
    if (this.roots.has(_id)) return _id
    const fromPending = pending?.get(_id)
    if (fromPending !== undefined) return fromPending ?? undefined
    const cached = this.docRoots.get(_id)
    if (cached !== undefined) return cached ?? undefined
    if (!this.isActive() || _class === undefined || !this.hierarchy.hasClass(_class)) return undefined
    const domain = this.hierarchy.findDomain(_class)
    if (domain === undefined || domain === DOMAIN_MODEL || !this.isProtectedDomain(domain)) return undefined
    const projection = { _id: 1, [ACCESS_ROOT_FIELD]: 1 } as unknown as FindOptions<Doc>['projection']
    const lowLevel = this.context.lowLevelStorage
    const docs =
      lowLevel !== undefined
        ? await lowLevel.rawFindAll<Doc>(domain, { _id }, { limit: 1, projection })
        : await this.requireFinder()(ctx, _class, { _id }, { limit: 1, projection })
    if (docs.length === 0) return undefined
    const root = getAccessRoot(docs[0])
    this.docRoots.set(_id, root ?? null)
    return root
  }

  /**
   * Resolves the root a new document belongs to, following its declared parent references.
   */
  async resolveNewDocRoot (
    ctx: MeasureContext,
    doc: Doc,
    pending?: Map<Ref<Doc>, Ref<Doc> | null>
  ): Promise<Ref<Doc> | undefined> {
    const record = doc as unknown as Record<string, unknown>
    for (const ref of getAccessParents(this.hierarchy, doc._class)) {
      const parentId = record[ref.field]
      if (typeof parentId !== 'string' || parentId === '' || parentId === doc._id) continue
      const parentClass = record[ref.classField]
      const root = await this.resolveDocRoot(
        ctx,
        parentId as Ref<Doc>,
        typeof parentClass === 'string' ? (parentClass as Ref<Class<Doc>>) : undefined,
        pending
      )
      if (root !== undefined) return root
    }
    return undefined
  }

  /**
   * Marks a document (or a transaction) as belonging to a root.
   */
  static mark (target: object, root: Ref<Doc> | undefined): void {
    const record = target as AccessMarked
    if (root === undefined) {
      delete record.accessRoot
    } else {
      record.accessRoot = root
    }
  }
}
