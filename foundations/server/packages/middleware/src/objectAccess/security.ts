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
  type Account,
  AccountRole,
  type AccountUuid,
  type BroadcastResult,
  type BroadcastTargets,
  type Class,
  type Doc,
  type DocumentQuery,
  DOMAIN_MODEL,
  type FindResult,
  getAccessMembers,
  getAccessParents,
  getAccessRoot,
  getClassAccessPolicy,
  hasAccountRole,
  isAccessAudience,
  type LookupData,
  type MeasureContext,
  type Ref,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  type SessionData,
  systemAccountUuid,
  touchesAttribute,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
  type TxMixin,
  TxProcessor,
  type TxUpdateDoc
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import { type AccessRootInfo, applyArrayUpdate, getObjectAccessState, type ObjectAccessState, type PendingRoots } from './state'

const BROADCAST_TARGET = 'objectAccess'

function forbidden (): PlatformError<any> {
  return new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
}

/**
 * Enforces object access policies for user requests: filters reads (queries, lookups, full-text) by the
 * readable roots, checks writes and policy changes, narrows broadcast to readers.
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

  private isUnrestricted (account: Account | undefined): boolean {
    return account === undefined || account.uuid === systemAccountUuid
  }


  override async findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    await this.state.init(ctx)
    const account = ctx.contextData?.account
    if (!this.state.isActive() || this.isUnrestricted(account)) {
      return await this.provideFindAll(ctx, _class, query, options)
    }
    const readable = this.state.getReadableRoots(account.uuid)
    const domain = this.context.hierarchy.findDomain(_class)
    let newQuery = query
    if (domain !== undefined && domain !== DOMAIN_MODEL && this.state.isProtectedDomain(domain)) {
      // Unmarked documents are not restricted. A string goes first: postgres infers the array type from it.
      const condition = readable.length > 0 ? { $in: [...readable, null] } : { $exists: false }
      newQuery = { ...query, [ACCESS_ROOT_FIELD]: condition }
    }
    const result = await this.provideFindAll(ctx, _class, newQuery, options)
    if (options?.lookup !== undefined) {
      const readableSet = new Set(readable)
      for (const doc of result) {
        if (doc.$lookup !== undefined) this.filterLookup(doc.$lookup, readableSet)
      }
    }
    return result
  }

  private isReadableDoc (doc: unknown, readable: Set<Ref<Doc>>): boolean {
    if (typeof doc !== 'object' || doc === null) return true
    const root = getAccessRoot(doc)
    return root === undefined || readable.has(root)
  }

  private filterLookup<T extends Doc>(lookup: LookupData<T>, readable: Set<Ref<Doc>>): void {
    const record = lookup as Record<string, any>
    for (const key of Object.keys(record)) {
      const value = record[key]
      if (Array.isArray(value)) {
        const filtered = value.filter((it) => this.isReadableDoc(it, readable))
        for (const it of filtered) {
          if (it?.$lookup !== undefined) this.filterLookup(it.$lookup, readable)
        }
        record[key] = filtered
      } else if (value !== undefined && value !== null) {
        if (!this.isReadableDoc(value, readable)) {
          record[key] = undefined
        } else if (value.$lookup !== undefined) {
          this.filterLookup(value.$lookup, readable)
        }
      }
    }
  }

  override async searchFulltext (
    ctx: MeasureContext<SessionData>,
    query: SearchQuery,
    options: SearchOptions
  ): Promise<SearchResult> {
    await this.state.init(ctx)
    const result = await this.provideSearchFulltext(ctx, query, options)
    const account = ctx.contextData?.account
    if (!this.state.isActive() || this.isUnrestricted(account)) return result
    const readable = new Set(this.state.getReadableRoots(account.uuid))
    const docs: SearchResult['docs'] = []
    for (const item of result.docs) {
      const _id = item.doc?._id ?? item.id
      const root = await this.state.resolveDocRoot(ctx, _id, item.doc?._class)
      if (root === undefined || readable.has(root)) docs.push(item)
    }
    const removed = result.docs.length - docs.length
    return {
      ...result,
      docs,
      total: result.total !== undefined ? Math.max(0, result.total - removed) : undefined
    }
  }


  override async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    await this.state.init(ctx)
    const account = ctx.contextData?.account
    if (!this.isUnrestricted(account)) {
      const pending: PendingRoots = new Map()
      for (const tx of txes) {
        await this.checkTx(ctx, account, tx, pending)
      }
    }
    return await this.provideTx(ctx, txes)
  }

  private async checkTx (ctx: MeasureContext<SessionData>, account: Account, tx: Tx, pending: PendingRoots): Promise<void> {
    if (tx._class === core.class.TxApplyIf) {
      for (const it of (tx as TxApplyIf).txes) {
        await this.checkTx(ctx, account, it, pending)
      }
      return
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return
    const cud = tx as TxCUD<Doc>
    if (cud.objectSpace === core.space.Model || !this.context.hierarchy.hasClass(cud.objectClass)) return
    switch (cud._class) {
      case core.class.TxCreateDoc:
        await this.checkCreate(ctx, account, cud as TxCreateDoc<Doc>, pending)
        break
      case core.class.TxUpdateDoc:
        await this.checkUpdate(ctx, account, cud as TxUpdateDoc<Doc>, pending)
        break
      case core.class.TxMixin:
        await this.checkMixin(ctx, account, cud as TxMixin<Doc, Doc>, pending)
        break
      case core.class.TxRemoveDoc:
        await this.checkWritable(ctx, account, cud, pending)
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

  // For a public object (no info) the owners are passed explicitly.
  private canManage (account: Account, info: AccessRootInfo | undefined, owners: Iterable<AccountUuid>): boolean {
    if (hasAccountRole(account, AccountRole.Owner)) return true
    if (new Set(owners).has(account.uuid)) return true
    if (!hasAccountRole(account, AccountRole.Maintainer)) return false
    return info === undefined || this.state.canReadRoot(account.uuid, info._id)
  }

  // Writing requires reading the root; a root itself may also be written by its managers (recovery).
  private async checkWritable (
    ctx: MeasureContext,
    account: Account,
    tx: TxCUD<Doc>,
    pending: PendingRoots
  ): Promise<Ref<Doc> | undefined> {
    const root = await this.state.resolveDocRoot(ctx, tx.objectId, tx.objectClass, pending)
    if (root === undefined || this.state.canReadRoot(account.uuid, root)) return root
    if (root === tx.objectId) {
      const info = this.state.getRoot(root)
      if (this.canManage(account, info, info?.owners ?? [])) return root
    }
    this.deny(ctx, account, tx, 'root-not-readable')
  }

  private async checkCreate (
    ctx: MeasureContext,
    account: Account,
    tx: TxCreateDoc<Doc>,
    pending: PendingRoots
  ): Promise<void> {
    const h = this.context.hierarchy
    const attributes = tx.attributes as Record<string, any>
    const doc = TxProcessor.createDoc2Doc(tx, false)
    const parentRoot = await this.state.resolveNewDocRoot(ctx, doc, pending)
    if (parentRoot !== undefined && !this.state.canReadRoot(account.uuid, parentRoot)) {
      this.deny(ctx, account, tx, 'parent-not-readable')
    }

    const mixin = attributes[core.mixin.AccessControlled]
    if (mixin === undefined) {
      pending.set(tx.objectId, parentRoot ?? null)
      return
    }

    const policy = getClassAccessPolicy(h, tx.objectClass)
    if (policy === undefined) this.deny(ctx, account, tx, 'class-has-no-access-policy')
    if (
      typeof mixin !== 'object' ||
      mixin === null ||
      !isAccessAudience(mixin.read) ||
      Object.keys(mixin).some((it) => it !== 'read' && it !== 'owners')
    ) {
      this.deny(ctx, account, tx, 'invalid-access-policy')
    }
    if (parentRoot !== undefined) {
      // A restricted object inside another restricted object is not supported yet.
      this.deny(ctx, account, tx, 'nested-security-root')
    }
    // Owners are server-managed; the creator of a private object is also its member.
    mixin.owners = [account.uuid]
    const members = getAccessMembers(doc, policy)
    if (mixin.read.kind === 'members' && !members.includes(account.uuid)) {
      attributes[policy.membersField] = [...members, account.uuid]
    }
    pending.set(tx.objectId, tx.objectId)
  }

  private async checkUpdate (
    ctx: MeasureContext,
    account: Account,
    tx: TxUpdateDoc<Doc>,
    pending: PendingRoots
  ): Promise<void> {
    const ops = tx.operations as Record<string, any>
    if (touchesAttribute(ops, ACCESS_ROOT_FIELD)) {
      this.deny(ctx, account, tx, 'access-root-is-server-managed')
    }
    // The policy is changed only by a validated TxMixin.
    if (touchesAttribute(ops, core.mixin.AccessControlled)) {
      this.deny(ctx, account, tx, 'access-policy-update-requires-mixin-tx')
    }
    const root = await this.checkWritable(ctx, account, tx, pending)
    await this.checkReparent(ctx, account, tx, root, ops, pending)

    const info = root === tx.objectId ? this.state.getRoot(tx.objectId) : undefined
    if (info === undefined || info.audience.kind !== 'members') return
    const policy = getClassAccessPolicy(this.context.hierarchy, info._class)
    if (policy === undefined || !touchesAttribute(ops, policy.membersField)) return
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
    const manage = this.canManage(account, info, info.owners)
    const isMember = info.members.has(self)
    // Members may invite and leave; only managers may remove somebody else.
    if (added.length > 0 && !isMember && !manage) this.deny(ctx, account, tx, 'invite-requires-membership')
    if (removed.some((it) => it !== self) && !manage) this.deny(ctx, account, tx, 'removal-requires-manage')
    if (after.size === 0) {
      this.deny(ctx, account, tx, 'private-object-needs-a-member')
    }
  }

  // Moving a document between roots would leave stale marks.
  private async checkReparent (
    ctx: MeasureContext,
    account: Account,
    tx: TxUpdateDoc<Doc>,
    root: Ref<Doc> | undefined,
    ops: Record<string, any>,
    pending: PendingRoots
  ): Promise<void> {
    const h = this.context.hierarchy
    const policy = getClassAccessPolicy(h, tx.objectClass)
    if (root === tx.objectId && policy !== undefined) {
      const parentField = policy.parent?.field ?? 'attachedTo'
      if (touchesAttribute(ops, parentField)) this.deny(ctx, account, tx, 'restricted-object-move')
      return
    }
    for (const ref of getAccessParents(h, tx.objectClass)) {
      const target = ops[ref.field]
      if (typeof target !== 'string') continue
      const targetClass = typeof ops[ref.classField] === 'string' ? ops[ref.classField] : undefined
      const targetRoot = await this.state.resolveDocRoot(ctx, target as Ref<Doc>, targetClass, pending)
      if (targetRoot !== root) this.deny(ctx, account, tx, 'move-between-security-roots')
    }
  }

  private resolveCreatorAccount (ctx: MeasureContext<SessionData>, doc: Doc): AccountUuid | undefined {
    const creator = doc.createdBy ?? doc.modifiedBy
    return ctx.contextData?.socialStringsToUsers?.get(creator)?.accontUuid
  }

  private async checkMixin (
    ctx: MeasureContext<SessionData>,
    account: Account,
    tx: TxMixin<Doc, Doc>,
    pending: PendingRoots
  ): Promise<void> {
    const h = this.context.hierarchy
    if (!h.hasClass(tx.mixin) || !h.isDerived(tx.mixin, core.mixin.AccessControlled)) {
      await this.checkWritable(ctx, account, tx, pending)
      return
    }

    const policy = getClassAccessPolicy(h, tx.objectClass)
    if (policy === undefined) this.deny(ctx, account, tx, 'class-has-no-access-policy')
    const attributes = tx.attributes as Record<string, any>
    const audience: AccessAudience | undefined = isAccessAudience(attributes.read) ? attributes.read : undefined
    if (audience === undefined || Object.keys(attributes).some((it) => it !== 'read')) {
      this.deny(ctx, account, tx, 'invalid-access-policy')
    }

    const info = this.state.getRoot(tx.objectId)
    let members: AccountUuid[]
    if (info !== undefined) {
      if (!this.canManage(account, info, info.owners)) this.deny(ctx, account, tx, 'policy-change-requires-manage')
      members = Array.from(info.members)
    } else {
      const doc = await this.state.loadDoc(ctx, tx.objectClass, tx.objectId)
      if (doc === undefined) this.deny(ctx, account, tx, 'object-not-found')
      const docRoot = getAccessRoot(doc)
      if (docRoot !== undefined && docRoot !== doc._id) this.deny(ctx, account, tx, 'nested-security-root')
      const creator = this.resolveCreatorAccount(ctx, doc)
      const owners = creator !== undefined ? [creator] : []
      if (!this.canManage(account, undefined, owners)) this.deny(ctx, account, tx, 'policy-change-requires-manage')
      // The first restriction stores the owners; afterwards they are server-managed.
      attributes.owners = owners.length > 0 ? owners : [account.uuid]
      members = getAccessMembers(doc, policy)
    }
    if (audience.kind === 'members' && members.length === 0) {
      this.deny(ctx, account, tx, 'private-object-needs-a-member')
    }
  }


  override async handleBroadcast (ctx: MeasureContext<SessionData>): Promise<void> {
    const targets = ctx.contextData.broadcast.targets
    if (this.state.isActive() && targets[BROADCAST_TARGET] === undefined) {
      // The first defined target wins: ours goes first, evaluates all others at broadcast time
      // (including ones added below) and narrows the result to the readers.
      const others = Object.entries(targets)
      for (const [key] of others) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete targets[key]
      }
      targets[BROADCAST_TARGET] = async (tx) => this.restrictBroadcast(tx, await this.resolveBase(targets, tx))
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

  private restrictBroadcast (tx: Tx, base: BroadcastResult): BroadcastResult {
    if (!TxProcessor.isExtendsCUD(tx._class)) return base
    const root = getAccessRoot(tx)
    if (root === undefined) return base
    const info = this.state.getRoot(root)
    if (info === undefined) {
      // The root was removed in this request: a removal reveals nothing but ids.
      return tx._class === core.class.TxRemoveDoc ? base : { target: [systemAccountUuid] }
    }
    const readers = this.state.getReaders(info)
    if (readers === undefined) return base
    readers.add(systemAccountUuid)
    if (base === undefined) return { target: Array.from(readers) }
    if ('exclude' in base) {
      const excluded = new Set(base.exclude)
      return { target: Array.from(readers).filter((it) => !excluded.has(it)) }
    }
    return { target: base.target.filter((it) => readers.has(it)) }
  }
}
