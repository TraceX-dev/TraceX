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
  type Collaborator,
  type Doc,
  generateId,
  getClassAccessPolicy,
  isAccessAudience,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Space,
  systemAccountUuid,
  touchesAttribute,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
  type TxMixin,
  TxProcessor,
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
import { getObjectAccessState, ObjectAccessState, type PendingRoots } from './state'

const PENDING_KEY = 'objectAccess.pending'

interface SecurityEvent {
  space: Ref<Space>
  accounts?: AccountUuid[] // undefined: everybody in the space
}

/**
 * Cache changes are applied after the transactions are stored, so a rejected request leaves nothing behind.
 */
type Effect = (events: SecurityEvent[]) => void

interface Batch {
  pending: PendingRoots
  effects: Effect[]
}

function readOwners (attributes: Record<string, any>): AccountUuid[] | undefined {
  return Array.isArray(attributes.owners) ? attributes.owners : undefined
}

/**
 * Marks documents and transactions of protected classes with `accessRoot` and keeps the caches in sync.
 * Every document of a class with a policy is a root from its creation (public ones too), so changing the
 * level never has to re-mark existing content. Transactions of other classes pass untouched; the only
 * exception is collaborators of cached parents (an in-memory check).
 * Placed after ApplyTxMiddleware (sees unpacked user and trigger txes) and before TxMiddleware
 * (stored txes carry the mark).
 * @public
 */
export class ObjectAccessMarkerMiddleware extends BaseMiddleware implements Middleware {
  private readonly state: ObjectAccessState

  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
    this.state = getObjectAccessState(context)
    this.state.setFinder(
      async (ctx, _class, query, options) => (await this.next?.findAll(ctx, _class, query, options)) ?? []
    )
  }

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next?: Middleware
  ): Promise<ObjectAccessMarkerMiddleware> {
    return new ObjectAccessMarkerMiddleware(context, next)
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    // Shared with derived transactions of the same request (triggers), so they resolve new documents
    // without a lookup. It lives only as long as the request, which fails as a whole on a storage error.
    const cache = ctx.contextData?.contextCache
    let pending: PendingRoots | undefined = cache?.get(PENDING_KEY)
    if (pending === undefined) {
      pending = new Map()
      cache?.set(PENDING_KEY, pending)
    }
    const batch: Batch = { pending, effects: [] }
    const cuds: Array<TxCUD<Doc>> = []
    let modelChanged = false
    for (const tx of txes) {
      if (!TxProcessor.isExtendsCUD(tx._class)) continue
      const cud = tx as TxCUD<Doc>
      // The domain decides, not the claimed space: storage writes by the class domain.
      if (cud.objectSpace === core.space.Model) modelChanged = true
      if (this.state.isProtectedDomainClass(cud.objectClass)) cuds.push(cud)
      if (cud.objectClass === core.class.Collaborator) this.processCollaborator(ctx, cud as TxCUD<Collaborator>, batch)
    }
    if (modelChanged) this.state.onModelChanged()
    if (cuds.length > 0) {
      await this.state.prefetch(
        cuds
          .filter((it) => it._class !== core.class.TxCreateDoc)
          .map((it) => ({ _id: it.objectId, _class: it.objectClass }))
      )
      for (const cud of cuds) {
        await this.process(cud, batch)
      }
    }
    const result = await this.provideTx(ctx, txes)
    // The hierarchy is updated by now.
    if (modelChanged) this.state.onModelChanged()
    if (batch.effects.length > 0) {
      const events: SecurityEvent[] = []
      for (const effect of batch.effects) effect(events)
      this.emitEvents(ctx, events)
    }
    return result
  }

  // A transaction of a protected domain. Its class is not trusted: existing documents are resolved by id.
  private async process (tx: TxCUD<Doc>, batch: Batch): Promise<void> {
    if (tx._class === core.class.TxCreateDoc) {
      const create = tx as TxCreateDoc<Doc>
      ObjectAccessState.mark(create.attributes, undefined) // never trust a client mark
      if (!this.state.isProtectedClass(tx.objectClass)) return
      const root = this.state.isRootClass(tx.objectClass)
        ? this.createRoot(create, batch)
        : await this.state.resolveNewDocRoot(TxProcessor.createDoc2Doc(create, false), batch.pending)
      ObjectAccessState.mark(create.attributes, root)
      ObjectAccessState.mark(tx, root)
      const key = this.state.keyOf(tx.objectClass, tx.objectId)
      if (key !== undefined) batch.pending.set(key, root ?? null)
      batch.effects.push(() => {
        this.state.noteDoc(tx.objectClass, tx.objectId, root)
      })
      return
    }
    if (tx._class === core.class.TxUpdateDoc) {
      stripMark((tx as TxUpdateDoc<Doc>).operations as Record<string, any>)
    }
    const root = await this.state.resolveDocRoot(tx.objectId, tx.objectClass, batch.pending)
    ObjectAccessState.mark(tx, root)
    if (root !== undefined && root === tx.objectId) {
      this.processRootChange(tx, batch)
    } else if (tx._class === core.class.TxRemoveDoc) {
      batch.effects.push(() => {
        this.state.forgetDoc(tx.objectClass, tx.objectId)
      })
    }
  }

  /**
   * Every document of a class with a policy is a root, public ones too (the mixin is added when missing).
   * The cache learns about it after it is stored; documents of the same request resolve to it via pending.
   */
  private createRoot (tx: TxCreateDoc<Doc>, batch: Batch): Ref<Doc> {
    const attributes = tx.attributes as Record<string, any>
    const mixin = attributes[core.mixin.AccessControlled]
    if (!isAccessAudience(mixin?.read)) {
      attributes[core.mixin.AccessControlled] = { ...(mixin ?? {}), read: { kind: 'space' } }
    }
    const policy = attributes[core.mixin.AccessControlled]
    const audience: AccessAudience = policy.read
    const info = this.state.buildRootInfo(TxProcessor.createDoc2Doc(tx, false), audience, readOwners(policy) ?? [])
    if (info !== undefined) {
      batch.effects.push(() => {
        this.state.setRoot(info)
      })
    }
    return tx.objectId
  }

  // The level, members or parent of a root may change: its info is dropped now (requests running meanwhile
  // reload it) and after the change is stored.
  private processRootChange (tx: TxCUD<Doc>, batch: Batch): void {
    let changesAccess = tx._class === core.class.TxRemoveDoc
    if (tx._class === core.class.TxMixin) {
      changesAccess = (tx as TxMixin<Doc, Doc>).mixin === core.mixin.AccessControlled
    } else if (tx._class === core.class.TxUpdateDoc) {
      const ops = (tx as TxUpdateDoc<Doc>).operations as Record<string, any>
      const policy = getClassAccessPolicy(this.context.hierarchy, tx.objectClass)
      changesAccess =
        policy === undefined ||
        touchesAttribute(ops, policy.membersField) ||
        touchesAttribute(ops, policy.parent?.field ?? 'attachedTo') ||
        touchesAttribute(ops, 'space')
    }
    if (!changesAccess) return
    this.state.forgetRoot(tx.objectId)
    batch.effects.push((events) => {
      this.state.forgetRoot(tx.objectId)
      if (tx._class !== core.class.TxRemoveDoc) events.push({ space: tx.objectSpace })
    })
  }

  // Participants of cached parents follow their collaborators.
  private processCollaborator (ctx: MeasureContext<SessionData>, tx: TxCUD<Collaborator>, batch: Batch): void {
    // A participants load running meanwhile must not cache a stale list.
    this.state.onCollaboratorChange()
    batch.effects.push(() => {
      this.state.onCollaboratorChange()
    })
    if (tx._class === core.class.TxCreateDoc) {
      const collaborator = TxProcessor.createDoc2Doc(tx as TxCreateDoc<Collaborator>, false)
      batch.effects.push((events) => {
        if (this.state.forgetParticipants(collaborator.attachedTo)) {
          events.push({ space: tx.objectSpace, accounts: [collaborator.collaborator] })
        }
      })
    } else if (tx._class === core.class.TxRemoveDoc) {
      // Access is lost at once, not after the removal is stored.
      const known = this.state.onCollaboratorRemoved(tx.objectId)
      batch.effects.push((events) => {
        const removed = ctx.contextData?.removedMap?.get(tx.objectId) as Collaborator | undefined
        const parent = removed?.attachedTo ?? known
        if (parent === undefined) return
        if (this.state.forgetParticipants(parent) || known !== undefined) {
          events.push({ space: tx.objectSpace, accounts: removed !== undefined ? [removed.collaborator] : undefined })
        }
      })
    } else if (tx._class === core.class.TxUpdateDoc) {
      const ops = (tx as TxUpdateDoc<Collaborator>).operations as Record<string, any>
      if (!touchesAttribute(ops, 'attachedTo') && !touchesAttribute(ops, 'collaborator')) return
      const known = this.state.onCollaboratorRemoved(tx.objectId)
      batch.effects.push((events) => {
        const target = typeof ops.attachedTo === 'string' ? (ops.attachedTo as Ref<Doc>) : undefined
        const changed = [known, target].filter((it): it is Ref<Doc> => it !== undefined)
        if (changed.some((it) => this.state.forgetParticipants(it)) || known !== undefined) {
          events.push({ space: tx.objectSpace })
        }
      })
    }
  }

  /**
   * One SecurityChange per space: clients refresh their queries of the space.
   */
  private emitEvents (ctx: MeasureContext<SessionData>, events: SecurityEvent[]): void {
    if (events.length === 0 || ctx.contextData?.broadcast === undefined) return
    const bySpace = new Map<Ref<Space>, Set<AccountUuid> | undefined>()
    for (const event of events) {
      const known = bySpace.has(event.space) ? bySpace.get(event.space) : new Set<AccountUuid>()
      bySpace.set(
        event.space,
        known === undefined || event.accounts === undefined ? undefined : new Set([...known, ...event.accounts])
      )
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

// The mark is server-managed.
function stripMark (ops: Record<string, any>): void {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete ops[ACCESS_ROOT_FIELD]
  for (const key of Object.keys(ops)) {
    if (key.startsWith('$') && typeof ops[key] === 'object') delete ops[key]?.[ACCESS_ROOT_FIELD]
  }
}
