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
  type Account,
  AccountRole,
  type AccountUuid,
  type BroadcastResult,
  type BroadcastTargets,
  type Class,
  DEFAULT_ACCESS_PARENT,
  type Doc,
  type DocumentQuery,
  type FindResult,
  getAccessMembers,
  getAccessRoot,
  getClassAccessPolicy,
  hasAccountRole,
  isAccessAudience,
  type MeasureContext,
  type Projection,
  type Ref,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  type SessionData,
  systemAccountUuid,
  toFindResult,
  touchesAttribute,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
  type TxMixin,
  TxProcessor,
  type TxUpdateDoc,
  type WithLookup
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import {
  type AccessRootInfo,
  applyArrayUpdate,
  getObjectAccessState,
  type ObjectAccessState,
  type PendingRoots
} from './state'

const BROADCAST_TARGET = 'objectAccess'

function unwrapApply (txes: Tx[]): Tx[] {
  return txes.flatMap((tx) => (tx._class === core.class.TxApplyIf ? unwrapApply((tx as TxApplyIf).txes) : [tx]))
}

// Readability of roots within one request.
type AccessCache = Map<Ref<Doc>, boolean>

function forbidden (): PlatformError<any> {
  return new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
}

/**
 * Enforces object access policies for user requests. Requests touching only unprotected classes pass
 * untouched: no queries, no query conditions.
 * - Reads: results of protected classes (and `$lookup`, full-text) are filtered by the root mark. Filtering
 *   happens after the query, so a page of a mixed list may come shorter than its limit.
 * - Writes into a root the account cannot read are rejected; the policy is changed only by a `TxMixin`.
 * - Broadcast of marked transactions is narrowed to the readers.
 * Managers (change the level, remove private members): owners, maintainers who can read the object,
 * workspace owners (also without read access, for recovery). Members matter only for Private.
 * @public
 */
export class ObjectSecurityMiddleware extends BaseMiddleware implements Middleware {
  private readonly state: ObjectAccessState

  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
    this.state = getObjectAccessState(context)
  }

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<ObjectSecurityMiddleware> {
    return new ObjectSecurityMiddleware(context, next)
  }

  private isUnrestricted (account: Account | undefined): account is undefined {
    return account === undefined || account.uuid === systemAccountUuid
  }

  private async canRead (ctx: MeasureContext, account: Account, root: Ref<Doc>, cache: AccessCache): Promise<boolean> {
    let result = cache.get(root)
    if (result === undefined) {
      result = await this.state.canRead(ctx, account.uuid, root)
      cache.set(root, result)
    }
    return result
  }

  // ---------------------------------------------------------------------------------------------
  // Reads

  override async findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    const account = ctx.contextData?.account
    if (this.isUnrestricted(account)) return await this.provideFindAll(ctx, _class, query, options)
    const checkDocs = this.state.mayReturnProtected(_class)
    if (!checkDocs && options?.lookup === undefined && options?.associations === undefined) {
      return await this.provideFindAll(ctx, _class, query, options)
    }

    const findOptions = checkDocs ? withMarkProjection(options) : options
    const result = await this.provideFindAll(ctx, _class, query, findOptions)

    const cache: AccessCache = new Map()
    const docs: Array<WithLookup<T>> = []
    let changed = false
    let hidden = 0
    for (const doc of result) {
      const root = checkDocs ? this.trustedRoot(doc) : undefined
      if (checkDocs && this.state.isProtectedClass(doc._class)) this.state.noteDoc(doc._class, doc._id, root)
      if (root !== undefined && !(await this.canRead(ctx, account, root, cache))) {
        changed = true
        hidden++
        continue
      }
      const filtered = await this.filterLookup(ctx, account, doc, cache)
      changed ||= filtered !== doc
      docs.push(filtered)
    }
    let total = result.total
    if (checkDocs && total > 0) {
      // The total must not count hidden documents, it would reveal matches inside them.
      total =
        total > result.length
          ? Math.max(result.length - hidden, total - (await this.countHidden(ctx, account, _class, query, cache)))
          : Math.max(0, total - hidden)
    }
    if (!changed && total === result.total) return result
    return toFindResult<T>(docs, total, result.lookupMap)
  }

  // Only marked documents can be hidden: they are counted per root, one row per root.
  private async countHidden<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    account: Account,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    cache: AccessCache
  ): Promise<number> {
    const h = this.context.hierarchy
    const marked: Record<string, any> = { ...query, [ACCESS_ROOT_FIELD]: { $exists: true } }
    let count = 0
    if (!h.isMixin(_class)) {
      const byClass: DocumentQuery<Doc> = { ...marked, _class: { $in: h.getDescendants(_class) } }
      const byRoot = await this.provideGroupBy<Ref<Doc>, Doc>(ctx, h.getDomain(_class), ACCESS_ROOT_FIELD, byClass)
      for (const [root, value] of byRoot) {
        if (!(await this.canRead(ctx, account, root, cache))) count += value
      }
      return count
    }
    const projection: Projection<Doc> = ACCESS_ROOT_PROJECTION
    for (const doc of await this.provideFindAll(ctx, _class, marked, { projection })) {
      const root = getAccessRoot(doc)
      if (root !== undefined && !(await this.canRead(ctx, account, root, cache))) count++
    }
    return count
  }

  // Marks are set by the server on protected documents and their transactions only.
  private trustedRoot (doc: Doc): Ref<Doc> | undefined {
    if (!this.state.isProtectedClass(doc._class) && !TxProcessor.isExtendsCUD(doc._class)) return undefined
    return getAccessRoot(doc)
  }

  // Results may be shared with concurrent queries (query joining), so documents are copied, not changed.
  private async filterLookup<T extends Doc>(
    ctx: MeasureContext,
    account: Account,
    doc: WithLookup<T>,
    cache: AccessCache
  ): Promise<WithLookup<T>> {
    if (doc.$lookup === undefined && doc.$associations === undefined) return doc
    const isVisible = async (value: Doc): Promise<boolean> => {
      const root = this.trustedRoot(value)
      return root === undefined || (await this.canRead(ctx, account, root, cache))
    }
    let changed = false
    const associations: Record<string, Doc[]> = {}
    for (const [key, value] of Object.entries(doc.$associations ?? {})) {
      const visible: Doc[] = []
      for (const it of value) {
        if (await isVisible(it)) visible.push(it)
      }
      changed ||= visible.length !== value.length
      associations[key] = visible
    }
    const lookup: Record<string, any> = {}
    for (const [key, value] of Object.entries((doc.$lookup ?? {}) as Record<string, any>)) {
      if (Array.isArray(value)) {
        const visible: Doc[] = []
        for (const it of value) {
          if (typeof it !== 'object' || it === null) {
            visible.push(it)
          } else if (await isVisible(it)) {
            const filtered = await this.filterLookup(ctx, account, it, cache)
            changed ||= filtered !== it
            visible.push(filtered)
          } else {
            changed = true
          }
        }
        lookup[key] = visible
      } else if (typeof value === 'object' && value !== null) {
        if (await isVisible(value)) {
          const filtered = await this.filterLookup(ctx, account, value, cache)
          changed ||= filtered !== value
          lookup[key] = filtered
        } else {
          changed = true
          lookup[key] = undefined
        }
      } else {
        lookup[key] = value
      }
    }
    if (!changed) return doc
    return {
      ...doc,
      ...(doc.$lookup !== undefined ? { $lookup: lookup as WithLookup<T>['$lookup'] } : {}),
      ...(doc.$associations !== undefined ? { $associations: associations } : {})
    }
  }

  override async searchFulltext (
    ctx: MeasureContext<SessionData>,
    query: SearchQuery,
    options: SearchOptions
  ): Promise<SearchResult> {
    const result = await this.provideSearchFulltext(ctx, query, options)
    const account = ctx.contextData?.account
    if (this.isUnrestricted(account)) return result
    const items = result.docs.map((it) => ({ item: it, _id: it.doc?._id ?? it.id, _class: it.doc?._class }))
    const protectedItems = items.filter((it) => this.state.isProtectedClass(it._class))
    if (protectedItems.length === 0) return result
    await this.state.prefetch(protectedItems.map((it) => ({ _id: it._id, _class: it._class })))
    const cache: AccessCache = new Map()
    const docs: SearchResult['docs'] = []
    for (const { item, _id, _class } of items) {
      const root = this.state.isProtectedClass(_class) ? await this.state.resolveDocRoot(_id, _class) : undefined
      if (root === undefined || (await this.canRead(ctx, account, root, cache))) docs.push(item)
    }
    if (docs.length === result.docs.length) return result
    const removed = result.docs.length - docs.length
    return {
      ...result,
      docs,
      total: result.total !== undefined ? Math.max(0, result.total - removed) : undefined
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Writes

  override async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const account = ctx.contextData?.account
    if (!this.isUnrestricted(account)) {
      const cuds = unwrapApply(txes).filter((it): it is TxCUD<Doc> => TxProcessor.isExtendsCUD(it._class))
      // Marks are server-managed: dropped from every client transaction (property deletes, no queries).
      for (const cud of cuds) stripClientMarks(cud)
      const scope: RequestScope = { pending: new Map(), newRoots: new Set(), cache: new Map() }
      const checked = cuds.filter((it) => this.state.isProtectedDomainClass(it.objectClass))
      if (checked.length > 0) {
        await this.state.prefetch(
          checked
            .filter((it) => it._class !== core.class.TxCreateDoc)
            .map((it) => ({ _id: it.objectId, _class: it.objectClass }))
        )
        for (const cud of checked) {
          await this.checkCud(ctx, account, cud, scope)
        }
      }
    }
    return await this.provideTx(ctx, txes)
  }

  // Storage addresses documents by id within the domain of the claimed class, so the class and the space
  // are not trusted: every transaction of a domain holding protected documents is checked.
  private async checkCud (
    ctx: MeasureContext<SessionData>,
    account: Account,
    cud: TxCUD<Doc>,
    scope: RequestScope
  ): Promise<void> {
    switch (cud._class) {
      case core.class.TxCreateDoc:
        await this.checkCreate(ctx, account, cud as TxCreateDoc<Doc>, scope)
        break
      case core.class.TxUpdateDoc:
        await this.checkUpdate(ctx, account, cud as TxUpdateDoc<Doc>, scope)
        break
      case core.class.TxMixin:
        await this.checkMixin(ctx, account, cud as TxMixin<Doc, Doc>, scope)
        break
      case core.class.TxRemoveDoc:
        await this.checkWritable(ctx, account, cud, scope)
        break
    }
  }

  private deny (ctx: MeasureContext, account: Account, tx: TxCUD<Doc>, reason: string): never {
    ctx.warn('object access: transaction rejected', {
      reason,
      account: account.uuid,
      txClass: tx._class,
      objectClass: tx.objectClass,
      objectId: tx.objectId
    })
    throw forbidden()
  }

  private async canManage (
    ctx: MeasureContext,
    account: Account,
    info: AccessRootInfo,
    cache: AccessCache
  ): Promise<boolean> {
    if (hasAccountRole(account, AccountRole.Owner)) return true
    if (info.owners.has(account.uuid)) return true
    if (!hasAccountRole(account, AccountRole.Maintainer)) return false
    return await this.canRead(ctx, account, info._id, cache)
  }

  // Writing requires reading the root; a root itself may also be written by its managers (recovery).
  // The stored mark decides: documents created in the request are not trusted here, as a create may be
  // skipped (a failed apply) or rejected by storage (an existing id).
  private async checkWritable (
    ctx: MeasureContext,
    account: Account,
    tx: TxCUD<Doc>,
    scope: RequestScope
  ): Promise<Ref<Doc> | undefined> {
    const root = await this.state.resolveDocRoot(tx.objectId, tx.objectClass)
    if (root === undefined || scope.newRoots.has(root) || (await this.canRead(ctx, account, root, scope.cache))) {
      return root
    }
    if (root === tx.objectId) {
      const info = await this.state.getRoot(ctx, root)
      if (info !== undefined && (await this.canManage(ctx, account, info, scope.cache))) return root
    }
    this.deny(ctx, account, tx, 'root-not-readable')
  }

  private async checkCreate (
    ctx: MeasureContext,
    account: Account,
    tx: TxCreateDoc<Doc>,
    scope: RequestScope
  ): Promise<void> {
    if (!this.state.isProtectedClass(tx.objectClass)) return
    const attributes = tx.attributes as Record<string, any>
    const doc = TxProcessor.createDoc2Doc(tx, false)
    const policy = getClassAccessPolicy(this.context.hierarchy, tx.objectClass)
    if (policy === undefined) {
      // Stored marks win over creates of the request: a create may be skipped (a failed apply).
      const root = await this.state.resolveNewDocRoot(doc, scope.pending, true)
      if (root !== undefined && !scope.newRoots.has(root) && !(await this.canRead(ctx, account, root, scope.cache))) {
        this.deny(ctx, account, tx, 'parent-not-readable')
      }
      const key = this.state.keyOf(tx.objectClass, tx.objectId)
      if (key !== undefined) scope.pending.set(key, root ?? null)
      return
    }

    // A restricted object inside another restricted object is not supported.
    const parentRef = policy.parent ?? DEFAULT_ACCESS_PARENT
    const parentId = attributes[parentRef.field]
    const parentClass = attributes[parentRef.classField]
    if (
      typeof parentId === 'string' &&
      typeof parentClass === 'string' &&
      this.state.isProtectedClass(parentClass as Ref<Class<Doc>>) &&
      (await this.state.resolveDocRoot(parentId as Ref<Doc>, parentClass as Ref<Class<Doc>>, scope.pending, true)) !==
        undefined
    ) {
      this.deny(ctx, account, tx, 'nested-security-root')
    }
    const mixin = attributes[core.mixin.AccessControlled] ?? { read: { kind: 'space' } }
    if (
      typeof mixin !== 'object' ||
      mixin === null ||
      !isAccessAudience(mixin.read) ||
      Object.keys(mixin).some((it) => it !== 'read' && it !== 'owners')
    ) {
      this.deny(ctx, account, tx, 'invalid-access-policy')
    }
    // Ownership of a new root is trusted within the request, so its id must really be new.
    if (await this.state.exists(tx.objectClass, tx.objectId)) this.deny(ctx, account, tx, 'object-exists')
    // Every object of the class is a root from the start; owners are server-managed (the creator).
    mixin.owners = [account.uuid]
    attributes[core.mixin.AccessControlled] = mixin
    const members = getAccessMembers(doc, policy)
    if (mixin.read.kind === 'members' && !members.includes(account.uuid)) {
      attributes[policy.membersField] = [...members, account.uuid]
    }
    scope.newRoots.add(tx.objectId)
    const key = this.state.keyOf(tx.objectClass, tx.objectId)
    if (key !== undefined) scope.pending.set(key, tx.objectId)
  }

  private async checkUpdate (
    ctx: MeasureContext,
    account: Account,
    tx: TxUpdateDoc<Doc>,
    scope: RequestScope
  ): Promise<void> {
    const ops = tx.operations as Record<string, any>
    // The policy is changed only by a validated TxMixin.
    if (touchesAttribute(ops, core.mixin.AccessControlled)) {
      this.deny(ctx, account, tx, 'access-policy-update-requires-mixin-tx')
    }
    const root = await this.checkWritable(ctx, account, tx, scope)
    await this.checkReparent(ctx, account, tx, root, ops)

    if (root !== tx.objectId) return
    const info = await this.state.getRoot(ctx, tx.objectId)
    // The class of the stored root, not the claimed one.
    const policy = info !== undefined ? getClassAccessPolicy(this.context.hierarchy, info._class) : undefined
    if (info === undefined || policy === undefined || !touchesAttribute(ops, policy.membersField)) return
    if (info.audience.kind !== 'members') {
      // Members matter only for a private object: set up by managers, so nobody joins in advance.
      if (!(await this.canManage(ctx, account, info, scope.cache))) {
        this.deny(ctx, account, tx, 'members-require-manage')
      }
      return
    }
    const field = policy.membersField
    const dotted = Object.keys(ops).some(
      (key) =>
        key.startsWith(`${field}.`) ||
        (key.startsWith('$') && Object.keys(ops[key] ?? {}).some((it) => it.startsWith(`${field}.`)))
    )
    if (dotted) this.deny(ctx, account, tx, 'members-must-be-updated-as-a-whole')

    const after = new Set(applyArrayUpdate(info.members, ops, field))
    const added = Array.from(after).filter((it) => !info.members.has(it))
    const removed = Array.from(info.members).filter((it) => !after.has(it))
    const self = account.uuid
    const manage = await this.canManage(ctx, account, info, scope.cache)
    // Members may invite and leave; only managers may remove somebody else.
    if (added.length > 0 && !info.members.has(self) && !manage) {
      this.deny(ctx, account, tx, 'invite-requires-membership')
    }
    if (removed.some((it) => it !== self) && !manage) this.deny(ctx, account, tx, 'removal-requires-manage')
    if (after.size === 0) this.deny(ctx, account, tx, 'private-object-needs-a-member')
  }

  // Moving a document between roots would leave stale marks. The claimed class is not trusted, so every
  // reference field used by object access is checked against all protected domains.
  private async checkReparent (
    ctx: MeasureContext,
    account: Account,
    tx: TxUpdateDoc<Doc>,
    root: Ref<Doc> | undefined,
    ops: Record<string, any>
  ): Promise<void> {
    for (const field of this.state.getParentFields()) {
      if (!touchesAttribute(ops, field)) continue
      if (root === tx.objectId) this.deny(ctx, account, tx, 'restricted-object-move')
      const target = ops[field]
      // Operator forms ($unset, $rename...) of a reference field are not supported.
      if (typeof target !== 'string') this.deny(ctx, account, tx, 'invalid-reference-update')
      if ((await this.state.resolveAnyRoot(target as Ref<Doc>)) !== root) {
        this.deny(ctx, account, tx, 'move-between-security-roots')
      }
    }
  }

  private async checkMixin (
    ctx: MeasureContext<SessionData>,
    account: Account,
    tx: TxMixin<Doc, Doc>,
    scope: RequestScope
  ): Promise<void> {
    if (tx.mixin !== core.mixin.AccessControlled) {
      await this.checkWritable(ctx, account, tx, scope)
      return
    }
    if (!this.state.isRootClass(tx.objectClass)) this.deny(ctx, account, tx, 'class-has-no-access-policy')
    const attributes = tx.attributes as Record<string, any>
    const audience: AccessAudience | undefined = isAccessAudience(attributes.read) ? attributes.read : undefined
    if (audience === undefined || Object.keys(attributes).some((it) => it !== 'read')) {
      this.deny(ctx, account, tx, 'invalid-access-policy')
    }
    // Created in this request by this account (its owner); its id was checked to be new.
    if (scope.newRoots.has(tx.objectId)) return
    // Objects created before the class got its policy are not marked and cannot be restricted.
    const info = await this.state.getRoot(ctx, tx.objectId)
    if (info === undefined) this.deny(ctx, account, tx, 'object-is-not-a-root')
    if (!(await this.canManage(ctx, account, info, scope.cache))) {
      this.deny(ctx, account, tx, 'policy-change-requires-manage')
    }
    if (audience.kind === 'members' && info.members.size === 0) {
      this.deny(ctx, account, tx, 'private-object-needs-a-member')
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Broadcast

  override async handleBroadcast (ctx: MeasureContext<SessionData>): Promise<void> {
    const { targets, txes } = ctx.contextData.broadcast
    if (targets[BROADCAST_TARGET] === undefined && txes.some((it) => getAccessRoot(it) !== undefined)) {
      // The first defined target wins: ours goes first, evaluates all others at broadcast time
      // (including ones added below) and narrows the result to the readers.
      const others = Object.entries(targets)
      for (const [key] of others) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete targets[key]
      }
      targets[BROADCAST_TARGET] = async (tx) => await this.restrictBroadcast(ctx, tx, targets)
      for (const [key, value] of others) {
        targets[key] = value
      }
    }
    await this.next?.handleBroadcast(ctx)
  }

  private async resolveBase (targets: BroadcastTargets, tx: Tx): Promise<BroadcastResult> {
    for (const [key, target] of Object.entries(targets)) {
      if (key === BROADCAST_TARGET) continue
      const result = await target(tx)
      if (result !== undefined) return result
    }
    return undefined
  }

  private async restrictBroadcast (ctx: MeasureContext, tx: Tx, targets: BroadcastTargets): Promise<BroadcastResult> {
    // Unmarked transactions are left to the other targets, which the broadcast evaluates next.
    const root = TxProcessor.isExtendsCUD(tx._class) ? getAccessRoot(tx) : undefined
    if (root === undefined) return undefined
    const base = await this.resolveBase(targets, tx)
    const readers = await this.state.getReaders(ctx, root)
    if (readers === null) {
      // The root is gone (e.g. removed in this request): a removal reveals nothing but ids.
      return tx._class === core.class.TxRemoveDoc ? base : { target: [systemAccountUuid] }
    }
    if (readers === undefined) return base
    const allowed = new Set<AccountUuid>([...readers, systemAccountUuid])
    if (base === undefined) return { target: Array.from(allowed) }
    if ('exclude' in base) {
      const excluded = new Set(base.exclude)
      return { target: Array.from(allowed).filter((it) => !excluded.has(it)) }
    }
    return { target: base.target.filter((it) => allowed.has(it)) }
  }
}

interface RequestScope {
  // Roots of documents created earlier in the request: used only to resolve their new children.
  pending: PendingRoots
  // Roots created in the request by this account, with ids checked to be new.
  newRoots: Set<Ref<Doc>>
  cache: AccessCache
}

function stripClientMarks (tx: TxCUD<Doc>): void {
  delete (tx as AccessMarked).accessRoot
  if (tx._class === core.class.TxCreateDoc) {
    delete ((tx as TxCreateDoc<Doc>).attributes as AccessMarked).accessRoot
  } else if (tx._class === core.class.TxUpdateDoc) {
    const ops = (tx as TxUpdateDoc<Doc>).operations as Record<string, any>
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete ops[ACCESS_ROOT_FIELD]
    for (const key of Object.keys(ops)) {
      if (key.startsWith('$') && typeof ops[key] === 'object') delete ops[key]?.[ACCESS_ROOT_FIELD]
    }
  }
}

// The mark must come back with the results: added to an inclusive projection, kept in an exclusive one.
function withMarkProjection<T extends Doc> (
  options: ServerFindOptions<T> | undefined
): ServerFindOptions<T> | undefined {
  if (options?.projection === undefined) return options
  const projection: Record<string, any> = { ...options.projection }
  if (Object.values(projection).some((it) => it === 1)) {
    projection[ACCESS_ROOT_FIELD] = 1
    projection._class = 1 // marks are trusted by class
  } else {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete projection[ACCESS_ROOT_FIELD]
  }
  return { ...options, projection: projection as Projection<T> }
}
