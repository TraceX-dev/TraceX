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
  ACCESS_ROOT_PROJECTION,
  type AccessAudience,
  type AccessMarked,
  type AccountUuid,
  canReadByAudience,
  type Class,
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
  getAccessPolicyClasses,
  getAccessReaders,
  getAccessRoot,
  getClassAccessPolicy,
  type Hierarchy,
  type MeasureContext,
  type Ref,
  type Space,
  systemAccountUuid,
  TxProcessor
} from '@hcengineering/core'
import type { PipelineContext } from '@hcengineering/server-core'

/**
 * Unrestricted find (no security middlewares below it).
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
export interface AccessRootInfo {
  _id: Ref<Doc>
  _class: Ref<Class<Doc>>
  space: Ref<Space>
  audience: AccessAudience
  members: Set<AccountUuid>
  owners: Set<AccountUuid>
  parent?: { _id: Ref<Doc>, _class: Ref<Class<Doc>> }
}

/**
 * `undefined` — everyone with space access, otherwise the exact set of readers.
 * @public
 */
export type AccessReaders = Set<AccountUuid> | undefined

/**
 * Pending roots of documents created earlier in the same request.
 * @public
 */
export type PendingRoots = Map<Ref<Doc>, Ref<Doc> | null>

interface ParentEntry {
  // Collaborator id -> account; an account may be added more than once.
  collaborators: Map<Ref<Collaborator>, AccountUuid>
  roots: Set<Ref<Doc>>
}

const DOC_ROOT_CACHE_SIZE = 50000

/**
 * Applies update operations of an AccountUuid[] attribute to its current value.
 * @public
 */
export function applyArrayUpdate (current: Iterable<AccountUuid>, ops: Record<string, any>, field: string): AccountUuid[] {
  const target: Record<string, any> = { [field]: Array.from(current) }
  const fieldOps: Record<string, any> = {}
  for (const key of Object.keys(ops)) {
    if (key === field) fieldOps[key] = ops[key]
    else if (key.startsWith('$') && ops[key]?.[field] !== undefined) fieldOps[key] = { [field]: ops[key][field] }
  }
  TxProcessor.applyUpdate(target as unknown as Doc, fieldOps)
  const value = target[field]
  return Array.isArray(value) ? value.filter((it): it is AccountUuid => typeof it === 'string') : []
}

const states = new WeakMap<PipelineContext, ObjectAccessState>()

/**
 * Shared by the security middleware (user requests) and the marker middleware (all transactions).
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
  private readonly parents = new Map<Ref<Doc>, ParentEntry>()
  private readonly docRoots = new Map<Ref<Doc>, Ref<Doc> | null>()
  private readonly readable = new Map<AccountUuid, Ref<Doc>[]>()
  private domains: { all: Set<Domain>, parentFields: Map<Domain, Set<string>> } | undefined
  private finder: AccessFinder | undefined
  private initPromise: Promise<void> | undefined
  private initialized = false
  // Marks outlive their roots (e.g. stored txes of a removed object), so once set the filter stays on.
  private marked = false

  constructor (readonly context: PipelineContext) {}

  get hierarchy (): Hierarchy {
    return this.context.hierarchy
  }

  setFinder (finder: AccessFinder): void {
    this.finder = finder
  }

  private readonly find: AccessFinder = async (ctx, _class, query, options) => {
    if (this.finder === undefined) throw new Error('Object access finder is not configured')
    return await this.finder(ctx, _class, query, options)
  }

  async init (ctx: MeasureContext): Promise<void> {
    if (this.initialized) return
    this.initPromise ??= ctx.with('init-object-access', {}, (ctx) => this.load(ctx))
    try {
      await this.initPromise
      this.initialized = true
    } catch (err: any) {
      this.initPromise = undefined // retry on the next request
      throw err
    }
  }

  /**
   * False until the workspace has a restricted object: all checks can be skipped.
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

  onModelChanged (): void {
    this.domains = undefined
  }

  private getDomains (): { all: Set<Domain>, parentFields: Map<Domain, Set<string>> } {
    if (this.domains !== undefined) return this.domains
    const h = this.hierarchy
    const all = new Set<Domain>([DOMAIN_TX])
    const parentFields = new Map<Domain, Set<string>>()
    for (const _class of h.getDescendants(core.class.Doc)) {
      if (h.isMixin(_class)) continue
      const domain = h.findDomain(_class)
      if (domain === undefined || domain === DOMAIN_MODEL || domain === DOMAIN_TX) continue
      const hasParent =
        h.classHierarchyMixin(_class, core.mixin.AccessParent) !== undefined ||
        h.findAttribute(_class, DEFAULT_ACCESS_PARENT.field) !== undefined
      if (!hasParent && getClassAccessPolicy(h, _class) === undefined) continue
      all.add(domain)
      if (hasParent) {
        const fields = parentFields.get(domain) ?? new Set<string>()
        for (const ref of getAccessParents(h, _class)) fields.add(ref.field)
        parentFields.set(domain, fields)
      }
    }
    this.domains = { all, parentFields }
    return this.domains
  }

  /**
   * True when documents of the domain may belong to a root.
   */
  isProtectedDomain (domain: Domain): boolean {
    return this.getDomains().all.has(domain)
  }

  getProtectedDomains (): Domain[] {
    return Array.from(this.getDomains().all)
  }

  getParentFields (domain: Domain): string[] {
    return Array.from(this.getDomains().parentFields.get(domain) ?? [])
  }

  private async load (ctx: MeasureContext): Promise<void> {
    const policyClasses = getAccessPolicyClasses(this.hierarchy)
    for (const _class of policyClasses) {
      for (const doc of await this.find(ctx, _class, { [ACCESS_ROOT_FIELD]: { $exists: true } })) {
        const info = getAccessRoot(doc) === doc._id ? this.buildRootInfo(doc) : undefined
        if (info !== undefined) this.roots.set(info._id, info)
      }
    }
    if (this.roots.size > 0) {
      this.marked = true
    } else if (policyClasses.length > 0) {
      // The creation tx of a root is always marked and the tx domain is indexed by objectClass.
      const classes = policyClasses.flatMap((it) => this.hierarchy.getDescendants(it))
      const txes = await this.find(
        ctx,
        core.class.Tx,
        { objectClass: { $in: classes }, [ACCESS_ROOT_FIELD]: { $exists: true } },
        { limit: 1, projection: { _id: 1 } }
      )
      this.marked = txes.length > 0
    }
    for (const info of this.roots.values()) {
      await this.trackParent(ctx, info)
    }
  }

  buildRootInfo (doc: Doc, audience?: AccessAudience, owners?: AccountUuid[]): AccessRootInfo | undefined {
    const policy = getClassAccessPolicy(this.hierarchy, doc._class)
    const read = audience ?? getAccessAudience(this.hierarchy, doc)
    if (policy === undefined || read === undefined) return undefined
    const ref = policy.parent ?? DEFAULT_ACCESS_PARENT
    const record = doc as unknown as Record<string, unknown>
    const parentId = record[ref.field]
    const parentClass = record[ref.classField]
    return {
      _id: doc._id,
      _class: doc._class,
      space: doc.space,
      audience: read,
      members: new Set(getAccessMembers(doc, policy)),
      owners: new Set(owners ?? getAccessOwners(this.hierarchy, doc)),
      parent:
        typeof parentId === 'string' && typeof parentClass === 'string'
          ? { _id: parentId as Ref<Doc>, _class: parentClass as Ref<Class<Doc>> }
          : undefined
    }
  }

  /**
   * Loads collaborators of the parent of a `parentParticipants` root.
   */
  private async trackParent (ctx: MeasureContext, info: AccessRootInfo): Promise<void> {
    if (info.parent === undefined) return
    let entry = this.parents.get(info.parent._id)
    if (entry === undefined && info.audience.kind === 'parentParticipants') {
      entry = { collaborators: new Map(), roots: new Set() }
      this.parents.set(info.parent._id, entry)
      for (const it of await this.find(ctx, core.class.Collaborator, { attachedTo: info.parent._id })) {
        entry.collaborators.set(it._id, it.collaborator)
      }
    }
    entry?.roots.add(info._id)
  }

  // ---------------------------------------------------------------------------------------------
  // Mutations (by the marker middleware)

  async setRoot (ctx: MeasureContext, info: AccessRootInfo): Promise<void> {
    const prev = this.roots.get(info._id)
    if (prev?.parent !== undefined && prev.parent._id !== info.parent?._id) {
      this.parents.get(prev.parent._id)?.roots.delete(info._id)
    }
    this.roots.set(info._id, info)
    this.marked = true
    this.docRoots.set(info._id, info._id)
    await this.trackParent(ctx, info)
    this.readable.clear()
  }

  removeRoot (_id: Ref<Doc>): void {
    const prev = this.roots.get(_id)
    if (prev === undefined) return
    this.roots.delete(_id)
    const entry = prev.parent !== undefined ? this.parents.get(prev.parent._id) : undefined
    entry?.roots.delete(_id)
    if (prev.parent !== undefined && entry?.roots.size === 0) this.parents.delete(prev.parent._id)
    this.readable.clear()
  }

  /**
   * A root created in the current request: documents produced by triggers (before the request state
   * is applied) must already resolve to it.
   */
  notePendingRoot (_id: Ref<Doc>): void {
    this.setDocRoot(_id, _id)
    this.marked = true
  }

  setDocRoot (_id: Ref<Doc>, root: Ref<Doc> | undefined): void {
    this.docRoots.delete(_id)
    if (this.docRoots.size >= DOC_ROOT_CACHE_SIZE) {
      const oldest = this.docRoots.keys().next()
      if (oldest.done !== true) this.docRoots.delete(oldest.value)
    }
    this.docRoots.set(_id, root ?? null)
  }

  forgetDoc (_id: Ref<Doc>): void {
    this.docRoots.delete(_id)
  }

  /**
   * `parentParticipants` roots whose readers depend on the collaborators of the parent.
   */
  getDependentRoots (parent: Ref<Doc>): AccessRootInfo[] {
    return Array.from(this.parents.get(parent)?.roots ?? [])
      .map((it) => this.roots.get(it))
      .filter((it): it is AccessRootInfo => it?.audience.kind === 'parentParticipants')
  }

  /**
   * Returns true when the collaborator belongs to a tracked parent.
   */
  addCollaborator (collaborator: Pick<Collaborator, '_id' | 'attachedTo' | 'collaborator'>): boolean {
    const entry = this.parents.get(collaborator.attachedTo)
    if (entry === undefined) return false
    entry.collaborators.set(collaborator._id, collaborator.collaborator)
    this.readable.clear()
    return true
  }

  /**
   * Returns the parent and account when the collaborator was tracked.
   */
  removeCollaborator (_id: Ref<Collaborator>): { parent: Ref<Doc>, account: AccountUuid } | undefined {
    for (const [parent, entry] of this.parents.entries()) {
      const account = entry.collaborators.get(_id)
      if (account === undefined) continue
      entry.collaborators.delete(_id)
      this.readable.clear()
      return { parent, account }
    }
    return undefined
  }

  // ---------------------------------------------------------------------------------------------
  // Queries

  private getParticipants (root: AccessRootInfo): Set<AccountUuid> | undefined {
    const entry = root.parent !== undefined ? this.parents.get(root.parent._id) : undefined
    return entry !== undefined ? new Set(entry.collaborators.values()) : undefined
  }

  getReaders (root: AccessRootInfo): AccessReaders {
    return getAccessReaders(root.audience, root.members, this.getParticipants(root))
  }

  canReadRoot (account: AccountUuid, rootId: Ref<Doc>): boolean {
    if (account === systemAccountUuid) return true
    const root = this.roots.get(rootId)
    // A mark pointing to an unknown root is closed.
    return root !== undefined && canReadByAudience(account, root.audience, root.members, this.getParticipants(root))
  }

  /**
   * Allow-list of the `accessRoot` query condition.
   */
  getReadableRoots (account: AccountUuid): Ref<Doc>[] {
    let result = this.readable.get(account)
    if (result === undefined) {
      result = Array.from(this.roots.keys()).filter((it) => this.canReadRoot(account, it))
      this.readable.set(account, result)
    }
    return result
  }

  async loadDoc (ctx: MeasureContext, _class: Ref<Class<Doc>>, _id: Ref<Doc>): Promise<Doc | undefined> {
    if (!this.hierarchy.hasClass(_class)) return undefined
    return (await this.find(ctx, _class, { _id }, { limit: 1 }))[0]
  }

  /**
   * Root of an existing document. The class only picks the domain: the lookup is by id, so a client
   * cannot hide a document behind another class of the same domain.
   */
  async resolveDocRoot (
    ctx: MeasureContext,
    _id: Ref<Doc>,
    _class: Ref<Class<Doc>> | undefined,
    pending?: PendingRoots
  ): Promise<Ref<Doc> | undefined> {
    if (this.roots.has(_id)) return _id
    const known = pending?.has(_id) === true ? pending.get(_id) : this.docRoots.get(_id)
    if (known !== undefined) return known ?? undefined
    if (!this.isActive() || _class === undefined || !this.hierarchy.hasClass(_class)) return undefined
    const domain = this.hierarchy.findDomain(_class)
    if (domain === undefined || domain === DOMAIN_MODEL || !this.isProtectedDomain(domain)) return undefined
    const options = { limit: 1, projection: ACCESS_ROOT_PROJECTION }
    const lowLevel = this.context.lowLevelStorage
    const docs =
      lowLevel !== undefined
        ? await lowLevel.rawFindAll<Doc>(domain, { _id }, options)
        : await this.find(ctx, _class, { _id }, options)
    if (docs.length === 0) return undefined
    const root = getAccessRoot(docs[0])
    this.setDocRoot(_id, root)
    return root
  }

  /**
   * Root of a new document, following its declared parent references.
   */
  async resolveNewDocRoot (ctx: MeasureContext, doc: Doc, pending?: PendingRoots): Promise<Ref<Doc> | undefined> {
    const record = doc as unknown as Record<string, unknown>
    for (const ref of getAccessParents(this.hierarchy, doc._class)) {
      const parentId = record[ref.field]
      if (typeof parentId !== 'string' || parentId === '' || parentId === doc._id) continue
      const parentClass = record[ref.classField]
      const _class = typeof parentClass === 'string' ? (parentClass as Ref<Class<Doc>>) : undefined
      const root = await this.resolveDocRoot(ctx, parentId as Ref<Doc>, _class, pending)
      if (root !== undefined) return root
    }
    return undefined
  }

  static mark (target: object, root: Ref<Doc> | undefined): void {
    const record = target as AccessMarked
    if (root === undefined) delete record.accessRoot
    else record.accessRoot = root
  }
}
