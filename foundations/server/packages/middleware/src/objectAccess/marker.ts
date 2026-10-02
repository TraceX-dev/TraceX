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
  type AccountUuid,
  type Class,
  type Collaborator,
  type Doc,
  type DocumentQuery,
  type DocumentUpdate,
  type Domain,
  DOMAIN_TX,
  generateId,
  getAccessRoot,
  getClassAccessPolicy,
  isAccessAudience,
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
  type TxRemoveDoc,
  type TxUpdateDoc,
  type TxWorkspaceEvent,
  WorkspaceEvent
} from '@hcengineering/core'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import { type AccessRootInfo, getObjectAccessState, ObjectAccessState } from './state'
import { applyArrayUpdate, chunks, symmetricDifference, unionReaders } from './utils'

const BACKFILL_CHUNK = 500
const BACKFILL_TX_CHUNK = 5000
const BACKFILL_MAX_DEPTH = 16

interface SecurityEvent {
  space: Ref<Space>
  // undefined — notify everybody
  accounts: Set<AccountUuid> | undefined
}

/**
 * State changes are applied only after the transactions are stored, so a rejected request
 * never leaves an over-granted state behind.
 */
type Effect = (ctx: MeasureContext, events: SecurityEvent[]) => Promise<void> | void

interface Batch {
  pending: Map<Ref<Doc>, Ref<Doc> | null>
  effects: Effect[]
  events: SecurityEvent[]
}

function readOwners (attributes: Record<string, any>): AccountUuid[] | undefined {
  const owners = attributes.owners
  return Array.isArray(owners) ? owners.filter((it): it is AccountUuid => typeof it === 'string') : undefined
}

/**
 * Marks every document and transaction that belongs to a security root with `accessRoot`
 * and keeps the shared object access state in sync.
 *
 * It is placed after ApplyTxMiddleware, so it sees unpacked user transactions and derived ones
 * produced by triggers, and before TxMiddleware, so the stored transactions carry the mark.
 * @public
 */
export class ObjectAccessMarkerMiddleware extends BaseMiddleware implements Middleware {
  private readonly state: ObjectAccessState

  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
    this.state = getObjectAccessState(context)
    this.state.setFinder(async (ctx, _class, query, options) => {
      return (await this.next?.findAll(ctx, _class, query, options)) ?? []
    })
  }

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<ObjectAccessMarkerMiddleware> {
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
        continue
      }
      await this.processCud(ctx, cud, batch)
    }
    const result = await this.provideTx(ctx, txes)
    for (const effect of batch.effects) {
      await effect(ctx, batch.events)
    }
    this.emitEvents(ctx, batch.events)
    return result
  }

  private async processCud (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>, batch: Batch): Promise<void> {
    switch (tx._class) {
      case core.class.TxCreateDoc:
        await this.processCreate(ctx, tx as TxCreateDoc<Doc>, batch)
        break
      case core.class.TxUpdateDoc:
        await this.processUpdate(ctx, tx as TxUpdateDoc<Doc>, batch)
        break
      case core.class.TxMixin:
        await this.processMixin(ctx, tx as TxMixin<Doc, Doc>, batch)
        break
      case core.class.TxRemoveDoc:
        await this.processRemove(ctx, tx, batch)
        break
    }
  }

  private async processCreate (ctx: MeasureContext<SessionData>, tx: TxCreateDoc<Doc>, batch: Batch): Promise<void> {
    const h = this.context.hierarchy
    if (!h.hasClass(tx.objectClass)) return
    // Never trust a mark coming from a client.
    ObjectAccessState.mark(tx.attributes, undefined)
    const doc = TxProcessor.createDoc2Doc(tx, false)

    const policy = getClassAccessPolicy(h, tx.objectClass)
    const mixin = (tx.attributes as Record<string, any>)[core.mixin.AccessControlled]
    if (policy !== undefined && isAccessAudience(mixin?.read)) {
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

    if (h.isDerived(tx.objectClass, core.class.Collaborator)) {
      const collaborator = doc as Collaborator
      batch.effects.push((_ctx, events) => {
        if (this.state.addCollaborator(collaborator)) {
          this.pushParentEvents(collaborator.attachedTo, new Set([collaborator.collaborator]), events)
        }
      })
    }
  }

  private async processUpdate (ctx: MeasureContext<SessionData>, tx: TxUpdateDoc<Doc>, batch: Batch): Promise<void> {
    const ops = tx.operations as Record<string, any>
    // The mark is maintained by the server only.
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete ops[ACCESS_ROOT_FIELD]
    for (const key of Object.keys(ops)) {
      if (key.startsWith('$') && typeof ops[key] === 'object' && ops[key] !== null) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete ops[key][ACCESS_ROOT_FIELD]
      }
    }

    const root = await this.state.resolveDocRoot(ctx, tx.objectId, tx.objectClass, batch.pending)
    ObjectAccessState.mark(tx, root)

    if (this.state.isRoot(tx.objectId)) {
      batch.effects.push(async (ctx, events) => {
        const info = this.state.getRoot(tx.objectId)
        if (info !== undefined) await this.updateRootFromOps(ctx, info, ops, events)
      })
    }

    if (this.state.isTrackedParent(tx.objectId)) {
      const field = this.state.getParticipantsField(tx.objectId)
      if (field !== undefined && TxProcessor.hasUpdate(tx.operations, field)) {
        batch.effects.push((_ctx, events) => {
          const before = new Set(this.state.getParentParticipants(tx.objectId) ?? [])
          const after = applyArrayUpdate(before, ops, field)
          this.state.setParentParticipants(tx.objectId, after)
          const changed = symmetricDifference(before, after)
          if (changed.size > 0) this.pushParentEvents(tx.objectId, changed, events)
        })
      }
    }
  }

  private async updateRootFromOps (
    ctx: MeasureContext,
    info: AccessRootInfo,
    ops: Record<string, any>,
    events: SecurityEvent[]
  ): Promise<void> {
    const policy = getClassAccessPolicy(this.context.hierarchy, info._class)
    if (policy === undefined) return
    const before = this.state.getReaders(info)
    let next: AccessRootInfo | undefined
    if (TxProcessor.hasUpdate(ops, policy.membersField)) {
      next = { ...(next ?? info), members: new Set(applyArrayUpdate(info.members, ops, policy.membersField)) }
    }
    const parentField = policy.parent?.field ?? 'attachedTo'
    const parentClassField = policy.parent?.classField ?? 'attachedToClass'
    const parentId: unknown = ops[parentField]
    if (typeof parentId === 'string') {
      const parentClassValue: unknown = ops[parentClassField]
      const parentClass =
        typeof parentClassValue === 'string' ? (parentClassValue as Ref<Class<Doc>>) : info.parent?._class
      next = {
        ...(next ?? info),
        parent: parentClass !== undefined ? { _id: parentId as Ref<Doc>, _class: parentClass } : undefined
      }
    }
    const space: unknown = ops.space
    if (typeof space === 'string') {
      next = { ...(next ?? info), space: space as Ref<Space> }
    }
    if (next === undefined) return
    await this.state.setRoot(ctx, next)
    events.push({ space: next.space, accounts: unionReaders(before, this.state.getReaders(next)) })
  }

  private async processMixin (ctx: MeasureContext<SessionData>, tx: TxMixin<Doc, Doc>, batch: Batch): Promise<void> {
    const h = this.context.hierarchy
    const isAccessMixin =
      h.hasClass(tx.mixin) && h.isDerived(tx.mixin, core.mixin.AccessControlled) && h.hasClass(tx.objectClass)
    const attributes = tx.attributes as Record<string, any>
    if (isAccessMixin && getClassAccessPolicy(h, tx.objectClass) !== undefined && isAccessAudience(attributes.read)) {
      await this.changeAudience(ctx, tx, attributes.read, readOwners(attributes), batch)
    }
    const root = await this.state.resolveDocRoot(ctx, tx.objectId, tx.objectClass, batch.pending)
    ObjectAccessState.mark(tx, root)
  }

  private async changeAudience (
    ctx: MeasureContext<SessionData>,
    tx: TxMixin<Doc, Doc>,
    audience: AccessAudience,
    owners: AccountUuid[] | undefined,
    batch: Batch
  ): Promise<void> {
    if (this.state.isRoot(tx.objectId)) {
      batch.effects.push(async (ctx, events) => {
        const info = this.state.getRoot(tx.objectId)
        if (info === undefined) return
        const before = this.state.getReaders(info)
        const next: AccessRootInfo = {
          ...info,
          audience,
          owners: owners !== undefined ? new Set(owners) : info.owners
        }
        await this.state.setRoot(ctx, next)
        events.push({ space: next.space, accounts: unionReaders(before, this.state.getReaders(next)) })
      })
      return
    }

    // An unmarked object is already public.
    if (audience.kind === 'space') return

    // The object was public and unmarked: mark it and everything that belongs to it.
    // A silent skip would store a policy that is not enforced, so every failure is an error.
    const doc = await this.state.loadDoc(ctx, tx.objectClass, tx.objectId)
    if (doc === undefined) throw new Error(`Cannot restrict ${tx.objectId}: the object is not found`)
    const existingRoot = getAccessRoot(doc)
    if (existingRoot !== undefined && existingRoot !== doc._id) {
      throw new Error(`Cannot restrict ${tx.objectId}: it already belongs to a restricted object`)
    }
    const next = this.state.buildRootInfo(doc, audience, owners)
    if (next === undefined) throw new Error(`Cannot restrict ${tx.objectId}: invalid access policy`)

    // Registered before the backfill, so documents created meanwhile are marked as well.
    await this.state.setRoot(ctx, next)
    try {
      await ctx.with('object-access-backfill', { _class: tx.objectClass }, (ctx) => this.backfill(ctx, next))
    } catch (err: any) {
      // Partially marked documents stay hidden (unknown root), the policy is not stored: retry is possible.
      this.state.removeRoot(next._id)
      throw err
    }
    // Everybody could have the content cached while it was public.
    batch.events.push({ space: next.space, accounts: undefined })
  }

  /**
   * Marks an existing object and all of its descendants. Used when a public object becomes restricted.
   */
  private async backfill (ctx: MeasureContext, info: AccessRootInfo): Promise<void> {
    const lowLevel = this.context.lowLevelStorage
    if (lowLevel === undefined) {
      throw new Error('Low level storage is required to restrict an existing object')
    }
    const h = this.context.hierarchy
    const rootId = info._id
    const update = (): DocumentUpdate<Doc> => ({ [ACCESS_ROOT_FIELD]: rootId })
    await lowLevel.rawUpdate(h.getDomain(info._class), { _id: rootId }, update())
    this.state.setDocRoot(rootId, rootId)

    const marked = new Set<Ref<Doc>>([rootId])
    const domains: Domain[] = this.state.getProtectedDomains().filter((it) => it !== DOMAIN_TX)
    let frontier: Ref<Doc>[] = [rootId]
    for (let depth = 0; depth < BACKFILL_MAX_DEPTH && frontier.length > 0; depth++) {
      const found: Ref<Doc>[] = []
      for (const domain of domains) {
        for (const field of this.state.getParentFields(domain)) {
          for (const chunk of chunks(frontier, BACKFILL_CHUNK)) {
            const query = { [field]: { $in: chunk } } as unknown as DocumentQuery<Doc>
            const docs = await lowLevel.rawFindAll(domain, query, {
              projection: { _id: 1, [ACCESS_ROOT_FIELD]: 1 } as any
            })
            const ids = docs.filter((it) => !marked.has(it._id) && getAccessRoot(it) === undefined).map((it) => it._id)
            if (ids.length === 0) continue
            for (const id of ids) {
              marked.add(id)
              found.push(id)
              this.state.setDocRoot(id, rootId)
            }
            await lowLevel.rawUpdate(domain, { _id: { $in: ids } }, update())
          }
        }
      }
      frontier = found
    }
    // Stored transactions of the subtree, so history requests are filtered as well.
    for (const chunk of chunks(Array.from(marked), BACKFILL_TX_CHUNK)) {
      await lowLevel.rawUpdate(DOMAIN_TX, { objectId: { $in: chunk } }, update())
    }
    ctx.info('object access: restricted an existing object', { _id: rootId, documents: marked.size })
  }

  private async processRemove (ctx: MeasureContext<SessionData>, tx: TxRemoveDoc<Doc>, batch: Batch): Promise<void> {
    const root = await this.state.resolveDocRoot(ctx, tx.objectId, tx.objectClass, batch.pending)
    ObjectAccessState.mark(tx, root)
    const h = this.context.hierarchy
    const isCollaborator = h.hasClass(tx.objectClass) && h.isDerived(tx.objectClass, core.class.Collaborator)
    batch.effects.push((_ctx, events) => {
      if (this.state.isRoot(tx.objectId)) {
        this.state.removeRoot(tx.objectId)
      }
      if (isCollaborator) {
        const removed = this.state.removeCollaborator(tx.objectId as Ref<Collaborator>)
        if (removed !== undefined) {
          this.pushParentEvents(removed.parent, new Set([removed.account]), events)
        }
      }
      this.state.forgetDoc(tx.objectId)
    })
    batch.pending.delete(tx.objectId)
  }

  private pushParentEvents (parent: Ref<Doc>, accounts: Set<AccountUuid>, events: SecurityEvent[]): void {
    for (const rootId of this.state.getDependentRoots(parent)) {
      const info = this.state.getRoot(rootId)
      if (info !== undefined) {
        events.push({ space: info.space, accounts })
      }
    }
  }

  private emitEvents (ctx: MeasureContext<SessionData>, events: SecurityEvent[]): void {
    if (events.length === 0 || ctx.contextData?.broadcast === undefined) return
    // One event per space is enough: clients refresh all queries of the space.
    const bySpace = new Map<Ref<Space>, Set<AccountUuid> | undefined>()
    for (const event of events) {
      if (!bySpace.has(event.space)) {
        bySpace.set(event.space, event.accounts === undefined ? undefined : new Set(event.accounts))
        continue
      }
      bySpace.set(event.space, unionReaders(bySpace.get(event.space), event.accounts))
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
        ctx.contextData.broadcast.targets['objectAccess' + tx._id] = async (it) =>
          it._id === tx._id ? { target } : undefined
      }
    }
  }
}
