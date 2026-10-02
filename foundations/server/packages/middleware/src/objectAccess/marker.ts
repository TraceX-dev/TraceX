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
  type AccountUuid,
  type Class,
  type Collaborator,
  type Doc,
  type DocumentQuery,
  DOMAIN_TX,
  generateId,
  getAccessRoot,
  getClassAccessPolicy,
  isAccessAudience,
  makeAccessRootUpdate,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Space,
  systemAccountUuid,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
  type TxMixin,
  TxProcessor,
  type TxUpdateDoc,
  type TxWorkspaceEvent,
  WorkspaceEvent
} from '@hcengineering/core'
import { BaseMiddleware, type Middleware, type PipelineContext, type TxMiddlewareResult } from '@hcengineering/server-core'
import {
  type AccessReaders,
  type AccessRootInfo,
  applyArrayUpdate,
  getObjectAccessState,
  ObjectAccessState,
  type PendingRoots
} from './state'

const BACKFILL_CHUNK = 500
const BACKFILL_MAX_DEPTH = 16

interface SecurityEvent {
  space: Ref<Space>
  accounts: AccessReaders // undefined: everybody
}

/**
 * State changes are applied after the transactions are stored, so a rejected request never leaves
 * an over-granted state behind.
 */
type Effect = (ctx: MeasureContext, events: SecurityEvent[]) => Promise<void> | void

interface Batch {
  pending: PendingRoots
  effects: Effect[]
  events: SecurityEvent[]
}

function union (a: AccessReaders, b: AccessReaders): AccessReaders {
  return a === undefined || b === undefined ? undefined : new Set([...a, ...b])
}

function chunks<T> (items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

function readOwners (attributes: Record<string, any>): AccountUuid[] | undefined {
  return Array.isArray(attributes.owners) ? attributes.owners : undefined
}

/**
 * Marks documents and transactions of security roots with `accessRoot` and keeps the shared state in sync.
 * Placed after ApplyTxMiddleware (sees unpacked user and trigger txes) and before TxMiddleware
 * (stored txes carry the mark).
 * @public
 */
export class ObjectAccessMarkerMiddleware extends BaseMiddleware implements Middleware {
  private readonly state: ObjectAccessState

  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
    this.state = getObjectAccessState(context)
    this.state.setFinder(async (ctx, _class, query, options) => (await this.next?.findAll(ctx, _class, query, options)) ?? [])
  }

  static async create (ctx: MeasureContext, context: PipelineContext, next?: Middleware): Promise<ObjectAccessMarkerMiddleware> {
    return new ObjectAccessMarkerMiddleware(context, next)
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    await this.state.init(ctx)
    const batch: Batch = { pending: new Map(), effects: [], events: [] }
    for (const tx of txes) {
      if (!TxProcessor.isExtendsCUD(tx._class)) continue
      const cud = tx as TxCUD<Doc>
      if (cud.objectSpace === core.space.Model) {
        this.state.onModelChanged()
      } else if (this.context.hierarchy.hasClass(cud.objectClass)) {
        await this.processCud(ctx, cud, batch)
      }
    }
    const result = await this.provideTx(ctx, txes)
    for (const effect of batch.effects) {
      await effect(ctx, batch.events)
    }
    this.emitEvents(ctx, batch.events)
    return result
  }

  private async processCud (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>, batch: Batch): Promise<void> {
    if (tx._class === core.class.TxCreateDoc) {
      await this.processCreate(ctx, tx as TxCreateDoc<Doc>, batch)
      return
    }
    if (tx._class === core.class.TxUpdateDoc) {
      this.processUpdate(tx as TxUpdateDoc<Doc>, batch)
    } else if (tx._class === core.class.TxMixin) {
      await this.processMixin(ctx, tx as TxMixin<Doc, Doc>, batch)
    } else if (tx._class === core.class.TxRemoveDoc) {
      this.processRemove(tx, batch)
    }
    ObjectAccessState.mark(tx, await this.state.resolveDocRoot(ctx, tx.objectId, tx.objectClass, batch.pending))
  }

  private async processCreate (ctx: MeasureContext, tx: TxCreateDoc<Doc>, batch: Batch): Promise<void> {
    ObjectAccessState.mark(tx.attributes, undefined) // never trust a client mark
    const doc = TxProcessor.createDoc2Doc(tx, false)
    const mixin = (tx.attributes as Record<string, any>)[core.mixin.AccessControlled]
    if (getClassAccessPolicy(this.context.hierarchy, tx.objectClass) !== undefined && isAccessAudience(mixin?.read)) {
      const info = this.state.buildRootInfo(doc, mixin.read, readOwners(mixin))
      if (info === undefined) throw new Error(`Cannot restrict ${tx.objectId}: invalid access policy`)
      ObjectAccessState.mark(tx.attributes, tx.objectId)
      ObjectAccessState.mark(tx, tx.objectId)
      batch.pending.set(tx.objectId, tx.objectId)
      this.state.notePendingRoot(tx.objectId)
      batch.effects.push(async (ctx) => {
        await this.state.setRoot(ctx, info)
      })
      return
    }

    const root = await this.state.resolveNewDocRoot(ctx, doc, batch.pending)
    ObjectAccessState.mark(tx.attributes, root)
    ObjectAccessState.mark(tx, root)
    batch.pending.set(tx.objectId, root ?? null)
    this.state.setDocRoot(tx.objectId, root)

    if (this.context.hierarchy.isDerived(tx.objectClass, core.class.Collaborator)) {
      const collaborator = doc as Collaborator
      batch.effects.push((_ctx, events) => {
        if (this.state.addCollaborator(collaborator)) {
          this.pushParentEvents(collaborator.attachedTo, collaborator.collaborator, events)
        }
      })
    }
  }

  private processUpdate (tx: TxUpdateDoc<Doc>, batch: Batch): void {
    const ops = tx.operations as Record<string, any>
    // The mark is server-managed.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete ops[ACCESS_ROOT_FIELD]
    for (const key of Object.keys(ops)) {
      if (key.startsWith('$') && typeof ops[key] === 'object') delete ops[key]?.[ACCESS_ROOT_FIELD]
    }
    if (!this.state.isRoot(tx.objectId)) return
    batch.effects.push(async (ctx, events) => {
      const info = this.state.getRoot(tx.objectId)
      if (info !== undefined) await this.updateRootFromOps(ctx, info, ops, events)
    })
  }

  private async updateRootFromOps (
    ctx: MeasureContext,
    info: AccessRootInfo,
    ops: Record<string, any>,
    events: SecurityEvent[]
  ): Promise<void> {
    const policy = getClassAccessPolicy(this.context.hierarchy, info._class)
    if (policy === undefined) return
    const next: AccessRootInfo = { ...info }
    if (TxProcessor.hasUpdate(ops, policy.membersField)) {
      next.members = new Set(applyArrayUpdate(info.members, ops, policy.membersField))
    }
    const parentId: unknown = ops[policy.parent?.field ?? 'attachedTo']
    const parentClass: unknown = ops[policy.parent?.classField ?? 'attachedToClass']
    if (typeof parentId === 'string') {
      const _class = typeof parentClass === 'string' ? (parentClass as Ref<Class<Doc>>) : info.parent?._class
      next.parent = _class !== undefined ? { _id: parentId as Ref<Doc>, _class } : undefined
    }
    if (typeof ops.space === 'string') next.space = ops.space as Ref<Space>
    const before = this.state.getReaders(info)
    await this.state.setRoot(ctx, next)
    events.push({ space: next.space, accounts: union(before, this.state.getReaders(next)) })
  }

  private async processMixin (ctx: MeasureContext<SessionData>, tx: TxMixin<Doc, Doc>, batch: Batch): Promise<void> {
    const h = this.context.hierarchy
    const attributes = tx.attributes as Record<string, any>
    const isPolicy =
      h.hasClass(tx.mixin) &&
      h.isDerived(tx.mixin, core.mixin.AccessControlled) &&
      getClassAccessPolicy(h, tx.objectClass) !== undefined
    if (isPolicy && isAccessAudience(attributes.read)) {
      await this.changeAudience(ctx, tx, attributes.read, readOwners(attributes), batch)
    }
  }

  private async changeAudience (
    ctx: MeasureContext,
    tx: TxMixin<Doc, Doc>,
    audience: AccessAudience,
    owners: AccountUuid[] | undefined,
    batch: Batch
  ): Promise<void> {
    if (this.state.isRoot(tx.objectId)) {
      batch.effects.push(async (ctx, events) => {
        const info = this.state.getRoot(tx.objectId)
        if (info === undefined) return
        const next: AccessRootInfo = { ...info, audience, owners: owners !== undefined ? new Set(owners) : info.owners }
        const before = this.state.getReaders(info)
        await this.state.setRoot(ctx, next)
        events.push({ space: next.space, accounts: union(before, this.state.getReaders(next)) })
      })
      return
    }
    if (audience.kind === 'space') return // an unmarked object is already public

    // A public object becomes restricted: mark it and its subtree. Every failure is an error,
    // a silent skip would store a policy that is not enforced.
    const doc = await this.state.loadDoc(ctx, tx.objectClass, tx.objectId)
    if (doc === undefined) throw new Error(`Cannot restrict ${tx.objectId}: the object is not found`)
    const existingRoot = getAccessRoot(doc)
    if (existingRoot !== undefined && existingRoot !== doc._id) {
      throw new Error(`Cannot restrict ${tx.objectId}: it already belongs to a restricted object`)
    }
    const info = this.state.buildRootInfo(doc, audience, owners)
    if (info === undefined) throw new Error(`Cannot restrict ${tx.objectId}: invalid access policy`)

    // Registered before the backfill, so documents created meanwhile are marked as well.
    await this.state.setRoot(ctx, info)
    try {
      await ctx.with('object-access-backfill', { _class: tx.objectClass }, (ctx) => this.backfill(ctx, info._id))
    } catch (err: any) {
      // Partially marked documents stay hidden (unknown root); the policy is not stored, so it can be retried.
      this.state.removeRoot(info._id)
      throw err
    }
    batch.events.push({ space: info.space, accounts: undefined }) // the content was public
  }

  /**
   * Marks an existing object, its descendants (by declared parent fields) and their stored txes.
   */
  private async backfill (ctx: MeasureContext, rootId: Ref<Doc>): Promise<void> {
    const lowLevel = this.context.lowLevelStorage
    if (lowLevel === undefined) throw new Error('Low level storage is required to restrict an existing object')
    const root = this.state.getRoot(rootId)
    if (root === undefined) return
    await lowLevel.rawUpdate(this.context.hierarchy.getDomain(root._class), { _id: rootId }, makeAccessRootUpdate(rootId))

    const marked = new Set<Ref<Doc>>([rootId])
    let frontier: Ref<Doc>[] = [rootId]
    for (let depth = 0; depth < BACKFILL_MAX_DEPTH && frontier.length > 0; depth++) {
      const found: Ref<Doc>[] = []
      for (const domain of this.state.getProtectedDomains()) {
        if (domain === DOMAIN_TX) continue
        for (const field of this.state.getParentFields(domain)) {
          for (const chunk of chunks(frontier, BACKFILL_CHUNK)) {
            const query = { [field]: { $in: chunk } } as unknown as DocumentQuery<Doc>
            const docs = await lowLevel.rawFindAll(domain, query, { projection: ACCESS_ROOT_PROJECTION })
            const ids = docs.filter((it) => !marked.has(it._id) && getAccessRoot(it) === undefined).map((it) => it._id)
            if (ids.length === 0) continue
            for (const id of ids) {
              marked.add(id)
              found.push(id)
              this.state.setDocRoot(id, rootId)
            }
            await lowLevel.rawUpdate(domain, { _id: { $in: ids } }, makeAccessRootUpdate(rootId))
          }
        }
      }
      frontier = found
    }
    for (const chunk of chunks(Array.from(marked), BACKFILL_CHUNK * 10)) {
      await lowLevel.rawUpdate(DOMAIN_TX, { objectId: { $in: chunk } }, makeAccessRootUpdate(rootId))
    }
    ctx.info('object access: restricted an existing object', { _id: rootId, documents: marked.size })
  }

  private processRemove (tx: TxCUD<Doc>, batch: Batch): void {
    const isCollaborator = this.context.hierarchy.isDerived(tx.objectClass, core.class.Collaborator)
    batch.effects.push((_ctx, events) => {
      this.state.removeRoot(tx.objectId)
      const removed = isCollaborator ? this.state.removeCollaborator(tx.objectId as Ref<Collaborator>) : undefined
      if (removed !== undefined) this.pushParentEvents(removed.parent, removed.account, events)
      this.state.forgetDoc(tx.objectId)
    })
  }

  private pushParentEvents (parent: Ref<Doc>, account: AccountUuid, events: SecurityEvent[]): void {
    for (const info of this.state.getDependentRoots(parent)) {
      events.push({ space: info.space, accounts: new Set([account]) })
    }
  }

  /**
   * One SecurityChange per space: clients refresh all queries of the space.
   */
  private emitEvents (ctx: MeasureContext<SessionData>, events: SecurityEvent[]): void {
    if (events.length === 0 || ctx.contextData?.broadcast === undefined) return
    const bySpace = new Map<Ref<Space>, AccessReaders>()
    for (const event of events) {
      bySpace.set(event.space, bySpace.has(event.space) ? union(bySpace.get(event.space), event.accounts) : event.accounts)
    }
    for (const [space, accounts] of bySpace.entries()) {
      const tx: TxWorkspaceEvent = {
        _class: core.class.TxWorkspaceEvent,
        _id: generateId(),
        event: WorkspaceEvent.SecurityChange,
        modifiedBy: core.account.System,
        modifiedOn: Date.now(),
        objectSpace: space,
        space: core.space.DerivedTx,
        params: null
      }
      ctx.contextData.broadcast.txes.push(tx)
      if (accounts !== undefined) {
        const target = [...accounts, systemAccountUuid]
        ctx.contextData.broadcast.targets['objectAccess' + tx._id] = async (it) => (it._id === tx._id ? { target } : undefined)
      }
    }
  }
}
