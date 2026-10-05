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
  ACCESS_ROOT_PROJECTION,
  type AccessAudience,
  type AccessMarked,
  type AccountUuid,
  type Class,
  type Collaborator,
  DEFAULT_ACCESS_PARENT,
  type Doc,
  type DocumentQuery,
  type Domain,
  DOMAIN_MODEL,
  DOMAIN_TRANSIENT,
  DOMAIN_TX,
  type FindOptions,
  getAccessAudience,
  getAccessMembers,
  getAccessOwners,
  getAccessParents,
  getAccessPolicyClasses,
  resetAccessPolicyClasses,
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
 * Roots of documents created earlier in the same request, by {@link markKey}.
 * @public
 */
export type PendingRoots = Map<string, Ref<Doc> | null>

/**
 * Storage addresses documents by id within a domain, so marks are keyed by both.
 * @public
 */
export function markKey (domain: Domain, _id: Ref<Doc>): string {
  return `${domain}/${_id}`
}

const ROOT_CACHE_SIZE = 10000
const PARENT_CACHE_SIZE = 10000
const DOC_ROOT_CACHE_SIZE = 50000
const MISSING_ROOT_CACHE_SIZE = 1000

/**
 * A Map that drops the least recently used entries above the limit.
 */
class BoundedMap<K, V> {
  private readonly map = new Map<K, V>()

  constructor (private readonly limit: number) {}

  get (key: K): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }

  set (key: K, value: V): void {
    this.map.delete(key)
    if (this.map.size >= this.limit) {
      const oldest = this.map.keys().next()
      if (oldest.done !== true) this.map.delete(oldest.value)
    }
    this.map.set(key, value)
  }

  delete (key: K): void {
    this.map.delete(key)
  }
}

interface AccessClasses {
  policy: Ref<Class<Doc>>[] // declaring a policy; a query by them returns subclasses too
  roots: Set<Ref<Class<Doc>>>
  protected: Set<Ref<Class<Doc>>> // roots and classes declaring AccessParent
  // Domains holding protected documents. Storage addresses documents by id within a domain, so any
  // transaction there is checked whatever class it claims; other domains are never looked at.
  domains: Set<Domain>
  parentFields: Set<string> // reference fields of AccessParent and policies
}

/**
 * Applies update operations of an AccountUuid[] attribute to its current value.
 * @public
 */
export function applyArrayUpdate (
  current: Iterable<AccountUuid>,
  ops: Record<string, any>,
  field: string
): AccountUuid[] {
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
 * Nothing is loaded upfront: roots, parent participants and document marks are read on demand and cached.
 * There is one transactor per workspace, so the caches are kept in sync by the marker middleware.
 * Only classes with a `ClassAccessPolicy` or an `AccessParent` are ever looked at.
 * @public
 */
export class ObjectAccessState {
  private classes: AccessClasses | undefined
  private readonly roots = new BoundedMap<Ref<Doc>, AccessRootInfo>(ROOT_CACHE_SIZE)
  // Marks pointing to nothing (e.g. a removed root); kept apart so probing ids cannot evict real roots.
  private readonly missingRoots = new BoundedMap<Ref<Doc>, true>(MISSING_ROOT_CACHE_SIZE)
  // Parent object -> its collaborators (collaborator id -> account).
  private readonly participants = new BoundedMap<Ref<Doc>, Map<Ref<Collaborator>, AccountUuid>>(PARENT_CACHE_SIZE)
  // markKey -> root of the document (null: not restricted).
  private readonly docRoots = new BoundedMap<string, Ref<Doc> | null>(DOC_ROOT_CACHE_SIZE)
  // Collaborator id -> parent, for collaborators of cached parents.
  private readonly collaboratorParents = new BoundedMap<Ref<Collaborator>, Ref<Doc>>(DOC_ROOT_CACHE_SIZE)
  // Bumped on invalidation: a load that started earlier does not store its (possibly stale) result.
  private rootsVersion = 0
  private participantsVersion = 0
  private finder: AccessFinder | undefined

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

  // ---------------------------------------------------------------------------------------------
  // Classes (from the model, in memory)

  // Called before and after a model change is applied to the hierarchy.
  onModelChanged (): void {
    this.classes = undefined
    resetAccessPolicyClasses(this.hierarchy)
  }

  private getClasses (): AccessClasses {
    if (this.classes !== undefined) return this.classes
    const h = this.hierarchy
    const roots = new Set<Ref<Class<Doc>>>()
    const prot = new Set<Ref<Class<Doc>>>()
    const domains = new Set<Domain>()
    const parentFields = new Set<string>()
    for (const _class of h.getDescendants(core.class.Doc)) {
      if (h.isMixin(_class)) continue
      const policy = getClassAccessPolicy(h, _class)
      const parents = getAccessParents(h, _class)
      if (policy === undefined && parents.length === 0) continue
      if (policy !== undefined) {
        roots.add(_class)
        parentFields.add((policy.parent ?? DEFAULT_ACCESS_PARENT).field)
      }
      for (const ref of parents) parentFields.add(ref.field)
      prot.add(_class)
      const domain = h.findDomain(_class)
      // Transient and model documents are not stored, marks cannot be read back from them.
      if (domain !== undefined && domain !== DOMAIN_TRANSIENT && domain !== DOMAIN_MODEL) domains.add(domain)
    }
    this.classes = { policy: getAccessPolicyClasses(h), roots, protected: prot, domains, parentFields }
    return this.classes
  }

  getParentFields (): Set<string> {
    return this.getClasses().parentFields
  }

  getDomain (_class: Ref<Class<Doc>> | undefined): Domain | undefined {
    if (_class === undefined || !this.hierarchy.hasClass(_class)) return undefined
    return this.hierarchy.findDomain(_class)
  }

  /**
   * True when transactions of the class may touch protected documents (its domain holds them).
   */
  isProtectedDomainClass (_class: Ref<Class<Doc>> | undefined): boolean {
    const domain = this.getDomain(_class)
    return domain !== undefined && this.getClasses().domains.has(domain)
  }

  isRootClass (_class: Ref<Class<Doc>> | undefined): boolean {
    return _class !== undefined && this.getClasses().roots.has(_class)
  }

  isProtectedClass (_class: Ref<Class<Doc>> | undefined): boolean {
    return _class !== undefined && this.getClasses().protected.has(_class)
  }

  /**
   * True when a query by the class (a mixin or a base class too) may return marked documents or transactions.
   */
  mayReturnProtected (_class: Ref<Class<Doc>>): boolean {
    const domain = this.getDomain(_class)
    return domain !== undefined && (domain === DOMAIN_TX || this.getClasses().domains.has(domain))
  }

  // ---------------------------------------------------------------------------------------------
  // Roots

  buildRootInfo (doc: Doc, audience?: AccessAudience, owners?: AccountUuid[]): AccessRootInfo | undefined {
    const policy = getClassAccessPolicy(this.hierarchy, doc._class)
    if (policy === undefined) return undefined
    const ref = policy.parent ?? DEFAULT_ACCESS_PARENT
    const record = doc as unknown as Record<string, unknown>
    const parentId = record[ref.field]
    const parentClass = record[ref.classField]
    return {
      _id: doc._id,
      _class: doc._class,
      space: doc.space,
      audience: audience ?? getAccessAudience(this.hierarchy, doc) ?? { kind: 'space' },
      members: new Set(getAccessMembers(doc, policy)),
      owners: new Set(owners ?? getAccessOwners(this.hierarchy, doc)),
      parent:
        typeof parentId === 'string' && typeof parentClass === 'string'
          ? { _id: parentId as Ref<Doc>, _class: parentClass as Ref<Class<Doc>> }
          : undefined
    }
  }

  /**
   * A root mark that points to nothing (e.g. a removed root) is closed.
   */
  async getRoot (ctx: MeasureContext, _id: Ref<Doc>): Promise<AccessRootInfo | undefined> {
    const cached = this.roots.get(_id)
    if (cached !== undefined) return cached
    if (this.missingRoots.get(_id) !== undefined) return undefined
    const version = this.rootsVersion
    let doc: Doc | undefined
    for (const _class of this.getClasses().policy) {
      doc = (await this.find(ctx, _class, { _id }, { limit: 1 }))[0]
      if (doc !== undefined) break
    }
    const info = doc !== undefined && getAccessRoot(doc) === doc._id ? this.buildRootInfo(doc) : undefined
    if (version === this.rootsVersion) {
      if (info !== undefined) this.roots.set(_id, info)
      else this.missingRoots.set(_id, true)
    }
    return info
  }

  setRoot (info: AccessRootInfo): void {
    this.rootsVersion++
    this.missingRoots.delete(info._id)
    this.roots.set(info._id, info)
    const domain = this.getDomain(info._class)
    if (domain !== undefined) this.docRoots.set(markKey(domain, info._id), info._id)
  }

  /**
   * Reloaded on the next use.
   */
  forgetRoot (_id: Ref<Doc>): void {
    this.rootsVersion++
    this.roots.delete(_id)
    this.missingRoots.delete(_id)
  }

  // ---------------------------------------------------------------------------------------------
  // Parent participants

  private async getParticipants (ctx: MeasureContext, parent: Ref<Doc>): Promise<Set<AccountUuid>> {
    let entry = this.participants.get(parent)
    if (entry === undefined) {
      const version = this.participantsVersion
      entry = new Map()
      for (const it of await this.find(ctx, core.class.Collaborator, { attachedTo: parent })) {
        entry.set(it._id, it.collaborator)
      }
      if (version === this.participantsVersion) {
        this.participants.set(parent, entry)
        for (const id of entry.keys()) this.collaboratorParents.set(id, parent)
      }
    }
    return new Set(entry.values())
  }

  /**
   * Any collaborator change: a participants load running meanwhile must not store its result.
   */
  onCollaboratorChange (): void {
    this.participantsVersion++
  }

  /**
   * Collaborators of the parent changed: returns true when it was cached (some restricted object depends
   * on it). It is reloaded on the next use.
   */
  forgetParticipants (parent: Ref<Doc>): boolean {
    if (this.participants.get(parent) === undefined) return false
    this.participantsVersion++
    this.participants.delete(parent)
    return true
  }

  /**
   * A collaborator is removed: drops its parent from the cache right away (also before the removal is
   * stored), returns the parent when it was cached.
   */
  onCollaboratorRemoved (_id: Ref<Collaborator>): Ref<Doc> | undefined {
    const parent = this.collaboratorParents.get(_id)
    if (parent === undefined) return undefined
    this.collaboratorParents.delete(_id)
    this.participantsVersion++
    this.participants.delete(parent)
    return parent
  }

  // ---------------------------------------------------------------------------------------------
  // Readers

  /**
   * `null` — the root is unknown, nobody but the system reads it.
   */
  async getReaders (ctx: MeasureContext, rootId: Ref<Doc>): Promise<AccessReaders | null> {
    const info = await this.getRoot(ctx, rootId)
    if (info === undefined) return null
    const participants =
      info.audience.kind === 'parentParticipants' && info.parent !== undefined
        ? await this.getParticipants(ctx, info.parent._id)
        : undefined
    return getAccessReaders(info.audience, info.members, participants)
  }

  async canRead (ctx: MeasureContext, account: AccountUuid, rootId: Ref<Doc>): Promise<boolean> {
    if (account === systemAccountUuid) return true
    const readers = await this.getReaders(ctx, rootId)
    return readers !== null && (readers === undefined || readers.has(account))
  }

  // ---------------------------------------------------------------------------------------------
  // Document marks

  /**
   * Key of a document of a protected domain, or undefined when its class is outside protected domains.
   */
  keyOf (_class: Ref<Class<Doc>> | undefined, _id: Ref<Doc>): string | undefined {
    const domain = this.getDomain(_class)
    return domain !== undefined && this.getClasses().domains.has(domain) ? markKey(domain, _id) : undefined
  }

  noteDoc (_class: Ref<Class<Doc>> | undefined, _id: Ref<Doc>, root: Ref<Doc> | undefined): void {
    const key = this.keyOf(_class, _id)
    if (key !== undefined) this.docRoots.set(key, root ?? null)
  }

  forgetDoc (_class: Ref<Class<Doc>> | undefined, _id: Ref<Doc>): void {
    const key = this.keyOf(_class, _id)
    if (key !== undefined) this.docRoots.delete(key)
  }

  /**
   * Root of an existing document. The class only picks the domain: the lookup is by id, so a client
   * cannot hide a document behind another class of the same domain. Pending entries (documents created
   * earlier in the request) win over stored ones.
   */
  async resolveDocRoot (
    _id: Ref<Doc>,
    _class: Ref<Class<Doc>> | undefined,
    pending?: PendingRoots,
    storedFirst: boolean = false
  ): Promise<Ref<Doc> | undefined> {
    const domain = this.getDomain(_class)
    if (domain === undefined || !this.getClasses().domains.has(domain)) return undefined
    const key = markKey(domain, _id)
    if (!storedFirst && pending?.has(key) === true) return pending.get(key) ?? undefined
    if (this.docRoots.get(key) === undefined) await this.loadMarks(domain, [_id])
    const stored = this.docRoots.get(key)
    if (stored !== undefined) return stored ?? undefined
    return pending?.get(key) ?? undefined
  }

  /**
   * True when a document with the id is stored in the domain of the class.
   */
  async exists (_class: Ref<Class<Doc>>, _id: Ref<Doc>): Promise<boolean> {
    const domain = this.getDomain(_class)
    if (domain === undefined) return false
    if (this.getClasses().domains.has(domain) && this.docRoots.get(markKey(domain, _id)) !== undefined) return true
    return (await this.loadMarks(domain, [_id])) > 0
  }

  /**
   * Root of a document of any protected domain (when its class is not trusted).
   */
  async resolveAnyRoot (_id: Ref<Doc>): Promise<Ref<Doc> | undefined> {
    for (const domain of this.getClasses().domains) {
      const key = markKey(domain, _id)
      if (this.docRoots.get(key) === undefined) await this.loadMarks(domain, [_id])
      const root = this.docRoots.get(key)
      if (root !== undefined) return root ?? undefined
    }
    return undefined
  }

  /**
   * Loads the marks of the documents in one query per domain.
   */
  async prefetch (docs: Array<{ _id: Ref<Doc>, _class: Ref<Class<Doc>> }>): Promise<void> {
    const byDomain = new Map<Domain, Ref<Doc>[]>()
    for (const doc of docs) {
      const domain = this.getDomain(doc._class)
      if (domain === undefined || !this.getClasses().domains.has(domain)) continue
      if (this.docRoots.get(markKey(domain, doc._id)) !== undefined) continue
      const ids = byDomain.get(domain)
      if (ids !== undefined) ids.push(doc._id)
      else byDomain.set(domain, [doc._id])
    }
    for (const [domain, ids] of byDomain) {
      await this.loadMarks(domain, ids)
    }
  }

  private async loadMarks (domain: Domain, ids: Ref<Doc>[]): Promise<number> {
    const lowLevel = this.context.lowLevelStorage
    if (lowLevel === undefined) throw new Error('Object access requires the low level storage')
    const docs = await lowLevel.rawFindAll<Doc>(
      domain,
      { _id: ids.length === 1 ? ids[0] : { $in: ids } },
      { projection: ACCESS_ROOT_PROJECTION }
    )
    if (this.getClasses().domains.has(domain)) {
      for (const doc of docs) this.docRoots.set(markKey(domain, doc._id), getAccessRoot(doc) ?? null)
    }
    return docs.length
  }

  /**
   * Root of a new document, following its declared references. References to documents of
   * unprotected classes are skipped without any lookup.
   */
  async resolveNewDocRoot (
    doc: Doc,
    pending?: PendingRoots,
    storedFirst: boolean = false
  ): Promise<Ref<Doc> | undefined> {
    const record = doc as unknown as Record<string, unknown>
    for (const ref of getAccessParents(this.hierarchy, doc._class)) {
      const parentId = record[ref.field]
      const parentClass = record[ref.classField]
      if (typeof parentId !== 'string' || parentId === '' || parentId === doc._id) continue
      if (typeof parentClass !== 'string' || !this.isProtectedClass(parentClass as Ref<Class<Doc>>)) continue
      const root = await this.resolveDocRoot(parentId as Ref<Doc>, parentClass as Ref<Class<Doc>>, pending, storedFirst)
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
