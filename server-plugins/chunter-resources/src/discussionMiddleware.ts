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

import activity from '@hcengineering/activity'
import chunter, { type Discussion } from '@hcengineering/chunter'
import core, {
  AccountRole,
  type AccountUuid,
  type BroadcastResult,
  type Class,
  type Collaborator,
  type Doc,
  type DocumentQuery,
  type Domain,
  DOMAIN_COLLABORATOR,
  DOMAIN_TX,
  type FindResult,
  generateId,
  type LookupData,
  type MeasureContext,
  type Ref,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  type SessionData,
  type Space,
  systemAccountUuid,
  toFindResult,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
  TxProcessor,
  type TxUpdateDoc,
  type TxWorkspaceEvent,
  type WithLookup,
  WorkspaceEvent
} from '@hcengineering/core'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'

import { DISCUSSION_SECURITY_DOMAINS, markWorkspaceWithRestrictedDiscussions } from './discussionSecurity'

const TARGET_KEY = 'discussionSecurity'
const PROCESSED_KEY = 'discussionSecurity.processed'
const MESSAGE_CACHE_LIMIT = 10000

type DiscussionRef = Ref<Discussion>
type MessageLink = Pick<Doc, '_id'> & {
  attachedTo?: Ref<Doc>
  attachedToClass?: Ref<Class<Doc>>
  objectId?: Ref<Doc>
  objectClass?: Ref<Class<Doc>>
  srcDocId?: Ref<Doc>
  srcDocClass?: Ref<Class<Doc>>
}

/**
 * Complements the postgres rule `discussionSecurityRule` where SQL does not reach: 'participants'
 * discussions and their content are broadcast only to the collaborators of the parent object, filtered
 * out of lookups and fulltext results, and clients refresh their queries when access changes.
 * Does nothing until the workspace gets its first restricted discussion.
 * @public
 */
export class DiscussionSecurityMiddleware extends BaseMiddleware implements Middleware {
  // Restricted discussion -> its parent object.
  private readonly restricted = new Map<DiscussionRef, Ref<Doc>>()
  // Activity message -> discussion it belongs to (null when none).
  private readonly messageDiscussion = new Map<Ref<Doc>, DiscussionRef | null>()
  private initPromise: Promise<void> | undefined
  // Set once the workspace has a restricted discussion; enables the postgres rule as well.
  private active = false

  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
  }

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<DiscussionSecurityMiddleware> {
    return new DiscussionSecurityMiddleware(context, next)
  }

  private async init (ctx: MeasureContext): Promise<void> {
    if (this.initPromise === undefined) {
      this.initPromise = this.load(ctx).catch((err) => {
        this.initPromise = undefined
        throw err
      })
    }
    await this.initPromise
  }

  private async load (ctx: MeasureContext): Promise<void> {
    const storage = this.context.lowLevelStorage
    if (storage === undefined) return
    const domain = this.context.hierarchy.getDomain(chunter.class.Discussion)
    const docs = await ctx.with('discussion-security-init', {}, () =>
      storage.rawFindAll<Discussion>(domain, { _class: chunter.class.Discussion, visibility: 'participants' })
    )
    for (const doc of docs) {
      this.restricted.set(doc._id, doc.attachedTo)
    }
    if (docs.length > 0) this.activate()
  }

  private activate (): void {
    if (this.active) return
    this.active = true
    markWorkspaceWithRestrictedDiscussions(this.context.workspace.uuid)
  }

  private isBypassed (ctx: MeasureContext<SessionData>): boolean {
    const data = ctx.contextData
    if (data === undefined || data.isTriggerCtx === true) return true
    const account = data.account
    return (
      account === undefined ||
      account.uuid === systemAccountUuid ||
      account.role === AccountRole.Admin ||
      account.role === AccountRole.DocGuest
    )
  }

  private isAffectedDomain (_class: Ref<Class<Doc>>): boolean {
    const hierarchy = this.context.hierarchy
    if (!hierarchy.hasClass(_class)) return false
    const domain = hierarchy.findDomain(_class)
    return domain !== undefined && DISCUSSION_SECURITY_DOMAINS.includes(domain)
  }

  override async findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    if (this.isBypassed(ctx)) return await this.provideFindAll(ctx, _class, query, options)
    await this.init(ctx)
    if (!this.active) return await this.provideFindAll(ctx, _class, query, options)

    // Results of these domains depend on the account, so concurrent queries of different accounts must not be joined.
    const findOptions: ServerFindOptions<T> | undefined = this.isAffectedDomain(_class)
      ? { ...options, securityKey: ctx.contextData.account.uuid }
      : options
    const result = await this.provideFindAll(ctx, _class, query, findOptions)

    if (options?.lookup === undefined || this.restricted.size === 0) return result
    // Documents may be shared with concurrent queries of other accounts, so they are copied, not changed.
    const access = new Map<Ref<Doc>, boolean>()
    const docs: Array<WithLookup<T>> = []
    for (const doc of result) {
      docs.push(await this.filterDocLookup(ctx, doc, access))
    }
    return toFindResult<T>(docs, result.total, result.lookupMap)
  }

  override async searchFulltext (
    ctx: MeasureContext<SessionData>,
    query: SearchQuery,
    options: SearchOptions
  ): Promise<SearchResult> {
    if (this.isBypassed(ctx)) return await this.provideSearchFulltext(ctx, query, options)
    await this.init(ctx)
    const result = await this.provideSearchFulltext(ctx, query, options)
    if (this.restricted.size === 0) return result

    // Search results carry no links, so the documents are loaded to find their discussions.
    const hierarchy = this.context.hierarchy
    const byDomain = new Map<Domain, Ref<Doc>[]>()
    for (const it of result.docs) {
      const _class = searchDocClass(it.doc._class)
      if (_class === undefined || !hierarchy.hasClass(_class)) continue
      const domain = hierarchy.findDomain(_class)
      if (domain === undefined || domain === DOMAIN_TX || !DISCUSSION_SECURITY_DOMAINS.includes(domain)) continue
      byDomain.set(domain, [...(byDomain.get(domain) ?? []), it.doc._id])
    }
    const loaded = new Map<Ref<Doc>, Doc>()
    const storage = this.context.lowLevelStorage
    if (storage !== undefined) {
      for (const [domain, ids] of byDomain) {
        for (const doc of await storage.load(ctx, domain, ids)) {
          loaded.set(doc._id, doc)
        }
      }
    }

    const access = new Map<Ref<Doc>, boolean>()
    const docs: SearchResult['docs'] = []
    for (const it of result.docs) {
      const doc = loaded.get(it.doc._id)
      const discussion = doc !== undefined ? await this.getDocDiscussion(ctx, doc) : undefined
      if (discussion === undefined || (await this.canRead(ctx, discussion, access))) {
        docs.push(it)
      }
    }
    const hidden = result.docs.length - docs.length
    return {
      ...result,
      docs,
      total: result.total !== undefined ? Math.max(0, result.total - hidden) : undefined
    }
  }

  override async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const result = await this.provideTx(ctx, txes)
    // Restrictions are registered right away, so a concurrent broadcast does not send new messages to everyone.
    // Relaxing waits for the broadcast, which carries only applied transactions.
    try {
      await this.init(ctx)
      for (const tx of unwrapApply(txes)) {
        if (TxProcessor.isExtendsCUD(tx._class) && (tx as TxCUD<Doc>).objectClass === chunter.class.Discussion) {
          await this.registerRestriction(tx as TxCUD<Discussion>)
        }
      }
    } catch (err: any) {
      ctx.error('Failed to register discussion restrictions', { err })
    }
    return result
  }

  override async handleBroadcast (ctx: MeasureContext<SessionData>): Promise<void> {
    try {
      await this.init(ctx)
    } catch (err: any) {
      ctx.error('Failed to load restricted discussions', { err })
    }
    const processed: Set<Ref<Tx>> = ctx.contextData.contextCache.get(PROCESSED_KEY) ?? new Set<Ref<Tx>>()
    ctx.contextData.contextCache.set(PROCESSED_KEY, processed)
    for (const tx of [...ctx.contextData.broadcast.txes]) {
      if (processed.has(tx._id)) continue
      processed.add(tx._id)
      if (TxProcessor.isExtendsCUD(tx._class)) {
        await this.processTx(ctx, tx as TxCUD<Doc>)
      }
    }
    if (this.active && ctx.contextData.broadcast.targets[TARGET_KEY] === undefined) {
      this.installTarget(ctx)
    }
    await this.next?.handleBroadcast(ctx)
  }

  private async registerRestriction (tx: TxCUD<Discussion>): Promise<void> {
    let parent: Ref<Doc> | undefined
    if (tx._class === core.class.TxCreateDoc) {
      const doc = TxProcessor.createDoc2Doc(tx as TxCreateDoc<Discussion>)
      if (doc.visibility !== 'participants') return
      parent = doc.attachedTo
    } else if (tx._class === core.class.TxUpdateDoc) {
      if ((tx as TxUpdateDoc<Discussion>).operations.visibility !== 'participants') return
      parent = this.restricted.get(tx.objectId) ?? tx.attachedTo ?? (await this.loadParent(tx.objectId))
    }
    if (parent === undefined) return
    this.restricted.set(tx.objectId, parent)
    this.activate()
  }

  private async processTx (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>): Promise<void> {
    if (tx.objectClass === chunter.class.Discussion) {
      await this.processDiscussionTx(ctx, tx)
      return
    }
    if (tx.objectClass === core.class.Collaborator) {
      this.processCollaboratorTx(ctx, tx as TxCUD<Collaborator>)
      return
    }
    // Remember where new messages belong, to avoid loading them for replies, reactions and attachments.
    if (tx._class === core.class.TxCreateDoc && this.isMessageClass(tx.objectClass)) {
      const created = TxProcessor.createDoc2Doc(tx as TxCreateDoc<Doc>)
      this.cacheMessage(tx.objectId, getOwnDiscussion(created) ?? null)
    }
  }

  private async processDiscussionTx (ctx: MeasureContext<SessionData>, tx: TxCUD<Doc>): Promise<void> {
    const id = tx.objectId as DiscussionRef
    const wasRestricted = this.restricted.has(id)
    let isRestricted = wasRestricted
    let parent = this.restricted.get(id) ?? tx.attachedTo
    if (tx._class === core.class.TxCreateDoc) {
      const doc = TxProcessor.createDoc2Doc(tx as TxCreateDoc<Discussion>)
      isRestricted = doc.visibility === 'participants'
      parent = doc.attachedTo
    } else if (tx._class === core.class.TxUpdateDoc) {
      const operations = (tx as TxUpdateDoc<Discussion>).operations
      if ('visibility' in operations) {
        isRestricted = operations.visibility === 'participants'
      }
    } else if (tx._class === core.class.TxRemoveDoc) {
      isRestricted = false
    }

    if (isRestricted && parent === undefined) {
      parent = await this.loadParent(id)
    }
    if (isRestricted && parent !== undefined) {
      this.restricted.set(id, parent)
      this.activate()
    } else {
      this.restricted.delete(id)
    }
    if (tx._class === core.class.TxUpdateDoc && wasRestricted !== isRestricted) {
      // Everybody in the space may gain or lose access.
      this.broadcastSecurityChange(ctx, undefined, tx.objectSpace)
    }
  }

  private async loadParent (id: DiscussionRef): Promise<Ref<Doc> | undefined> {
    const storage = this.context.lowLevelStorage
    if (storage === undefined) return undefined
    const domain = this.context.hierarchy.getDomain(chunter.class.Discussion)
    const [doc] = await storage.rawFindAll<Discussion>(domain, { _id: id }, { limit: 1 })
    return doc?.attachedTo
  }

  private processCollaboratorTx (ctx: MeasureContext<SessionData>, tx: TxCUD<Collaborator>): void {
    if (tx.attachedTo === undefined || !this.isRestrictedParent(tx.attachedTo)) return
    let account: AccountUuid | undefined
    if (tx._class === core.class.TxCreateDoc) {
      account = (tx as TxCreateDoc<Collaborator>).attributes.collaborator
    } else if (tx._class === core.class.TxRemoveDoc) {
      account = (ctx.contextData.removedMap.get(tx.objectId) as Collaborator | undefined)?.collaborator
    } else {
      return
    }
    this.broadcastSecurityChange(ctx, account !== undefined ? [account] : undefined, tx.objectSpace)
  }

  private isRestrictedParent (parent: Ref<Doc>): boolean {
    for (const it of this.restricted.values()) {
      if (it === parent) return true
    }
    return false
  }

  private broadcastSecurityChange (
    ctx: MeasureContext<SessionData>,
    accounts: AccountUuid[] | undefined,
    space: Ref<Space>
  ): void {
    const event: TxWorkspaceEvent = {
      _class: core.class.TxWorkspaceEvent,
      _id: generateId(),
      event: WorkspaceEvent.SecurityChange,
      modifiedBy: core.account.System,
      modifiedOn: Date.now(),
      objectSpace: space,
      space: core.space.DerivedTx,
      params: null
    }
    ctx.contextData.broadcast.txes.push(event)
    if (accounts !== undefined) {
      ctx.contextData.broadcast.targets[TARGET_KEY + event._id] = async (it) =>
        it._id === event._id ? { target: accounts } : undefined
    }
  }

  // Puts the discussion target first, so it narrows whatever the other targets decide.
  private installTarget (ctx: MeasureContext<SessionData>): void {
    const targets = ctx.contextData.broadcast.targets
    const previous = { ...targets }
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete previous[TARGET_KEY]
    for (const key of Object.keys(targets)) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete targets[key]
    }
    const collaborators = new Map<Ref<Doc>, Promise<AccountUuid[]>>()

    targets[TARGET_KEY] = async (tx) => {
      const discussion = TxProcessor.isExtendsCUD(tx._class)
        ? await this.getTxDiscussion(ctx, tx as TxCUD<Doc>)
        : undefined
      const parent = discussion !== undefined ? this.restricted.get(discussion) : undefined
      // Other targets are read on every call, as lower middlewares may still add theirs.
      const base = await evaluateTargets(tx, targets)
      if (parent === undefined) return base

      let readers = collaborators.get(parent)
      if (readers === undefined) {
        readers = this.getCollaborators(ctx, parent)
        collaborators.set(parent, readers)
      }
      return narrow(base, [...(await readers), systemAccountUuid])
    }
    Object.assign(targets, previous)
  }

  private async getCollaborators (ctx: MeasureContext, parent: Ref<Doc>): Promise<AccountUuid[]> {
    const storage = this.context.lowLevelStorage
    if (storage === undefined) return []
    const docs = await storage.rawFindAll<Collaborator>(DOMAIN_COLLABORATOR, { attachedTo: parent })
    return docs.map((it) => it.collaborator)
  }

  private async canRead (
    ctx: MeasureContext<SessionData>,
    discussion: DiscussionRef,
    access: Map<Ref<Doc>, boolean>
  ): Promise<boolean> {
    const parent = this.restricted.get(discussion)
    if (parent === undefined) return true
    let allowed = access.get(parent)
    if (allowed === undefined) {
      const storage = this.context.lowLevelStorage
      const found =
        storage === undefined
          ? []
          : await storage.rawFindAll<Collaborator>(
            DOMAIN_COLLABORATOR,
            { attachedTo: parent, collaborator: ctx.contextData.account.uuid },
            { limit: 1 }
          )
      allowed = found.length > 0
      access.set(parent, allowed)
    }
    return allowed
  }

  // Returns the document with hidden discussions and their content removed from its lookups, at any depth.
  private async filterDocLookup<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    doc: WithLookup<T>,
    access: Map<Ref<Doc>, boolean>
  ): Promise<WithLookup<T>> {
    if (doc.$lookup === undefined) return doc
    const lookup: Record<string, Doc | Doc[] | undefined> = {}
    for (const [key, value] of Object.entries(doc.$lookup as Record<string, Doc | Doc[] | undefined>)) {
      if (Array.isArray(value)) {
        const visible: Doc[] = []
        for (const it of value) {
          if (await this.isVisible(ctx, it, access)) visible.push(await this.filterDocLookup(ctx, it, access))
        }
        lookup[key] = visible
      } else if (value !== undefined && (await this.isVisible(ctx, value, access))) {
        lookup[key] = await this.filterDocLookup(ctx, value, access)
      } else {
        lookup[key] = undefined
      }
    }
    return { ...doc, $lookup: lookup as LookupData<T> }
  }

  private async isVisible (ctx: MeasureContext<SessionData>, doc: Doc, access: Map<Ref<Doc>, boolean>): Promise<boolean> {
    const discussion = await this.getDocDiscussion(ctx, doc)
    return discussion === undefined || (await this.canRead(ctx, discussion, access))
  }

  private isMessageClass (_class: Ref<Class<Doc>> | undefined): boolean {
    if (_class === undefined) return false
    const hierarchy = this.context.hierarchy
    return hierarchy.hasClass(_class) && hierarchy.isDerived(_class, activity.class.ActivityMessage)
  }

  private async getTxDiscussion (ctx: MeasureContext, tx: TxCUD<Doc>): Promise<DiscussionRef | undefined> {
    if (tx.objectClass === chunter.class.Discussion) return tx.objectId as DiscussionRef
    if (tx.attachedToClass === chunter.class.Discussion) return tx.attachedTo as DiscussionRef
    if (tx._class === core.class.TxCreateDoc) {
      const created = await this.getDocDiscussion(ctx, TxProcessor.createDoc2Doc(tx as TxCreateDoc<Doc>))
      if (created !== undefined) return created
    }
    if (this.isMessageClass(tx.attachedToClass) && tx.attachedTo !== undefined) {
      return await this.getMessageDiscussion(ctx, tx.attachedTo)
    }
    if (this.isMessageClass(tx.objectClass)) {
      return await this.getMessageDiscussion(ctx, tx.objectId)
    }
    return undefined
  }

  private async getDocDiscussion (ctx: MeasureContext, doc: MessageLink & Pick<Doc, '_class'>): Promise<DiscussionRef | undefined> {
    if (doc._class === chunter.class.Discussion) return doc._id as DiscussionRef
    const own = getOwnDiscussion(doc)
    if (own !== undefined) return own
    if (this.isMessageClass(doc.attachedToClass) && doc.attachedTo !== undefined) {
      return await this.getMessageDiscussion(ctx, doc.attachedTo)
    }
    // A mention from a thread reply points to the parent message.
    if (this.isMessageClass(doc.srcDocClass) && doc.srcDocId !== undefined) {
      return await this.getMessageDiscussion(ctx, doc.srcDocId)
    }
    return undefined
  }

  private async getMessageDiscussion (ctx: MeasureContext, message: Ref<Doc>): Promise<DiscussionRef | undefined> {
    const cached = this.messageDiscussion.get(message)
    if (cached !== undefined) return cached ?? undefined
    const storage = this.context.lowLevelStorage
    if (storage === undefined) return undefined
    const domain = this.context.hierarchy.getDomain(activity.class.ActivityMessage)
    const [doc] = await storage.rawFindAll<Doc>(domain, { _id: message }, { limit: 1 })
    const discussion = doc !== undefined ? getOwnDiscussion(doc) : undefined
    this.cacheMessage(message, discussion ?? null)
    return discussion
  }

  private cacheMessage (message: Ref<Doc>, discussion: DiscussionRef | null): void {
    if (this.messageDiscussion.size >= MESSAGE_CACHE_LIMIT) {
      // Drop the oldest entry; Map keeps the insertion order.
      const oldest = this.messageDiscussion.keys().next().value
      if (oldest !== undefined) this.messageDiscussion.delete(oldest)
    }
    this.messageDiscussion.set(message, discussion)
  }
}

function unwrapApply (txes: Tx[]): Tx[] {
  return txes.flatMap((tx) => (tx._class === core.class.TxApplyIf ? (tx as TxApplyIf).txes : [tx]))
}

function searchDocClass (_class: Ref<Class<Doc>> | Ref<Class<Doc>>[] | undefined): Ref<Class<Doc>> | undefined {
  return Array.isArray(_class) ? _class[0] : _class
}

// The discussion a message, reply, activity or mention belongs to, without loading anything.
function getOwnDiscussion (doc: MessageLink): DiscussionRef | undefined {
  if (doc.attachedToClass === chunter.class.Discussion) return doc.attachedTo as DiscussionRef
  if (doc.objectClass === chunter.class.Discussion) return doc.objectId as DiscussionRef
  if (doc.srcDocClass === chunter.class.Discussion) return doc.srcDocId as DiscussionRef
  return undefined
}

async function evaluateTargets (
  tx: Tx,
  targets: Record<string, (tx: Tx) => Promise<BroadcastResult>>
): Promise<BroadcastResult> {
  for (const [key, target] of Object.entries(targets)) {
    if (key === TARGET_KEY) continue
    const result = await target(tx)
    if (result !== undefined) return result
  }
  return undefined
}

function narrow (base: BroadcastResult, readers: AccountUuid[]): BroadcastResult {
  if (base === undefined) return { target: readers }
  if ('exclude' in base) {
    const excluded = new Set(base.exclude)
    return { target: readers.filter((it) => !excluded.has(it)) }
  }
  const allowed = new Set(readers)
  return { target: base.target.filter((it) => allowed.has(it)) }
}
