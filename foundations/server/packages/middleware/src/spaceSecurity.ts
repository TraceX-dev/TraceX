//
// Copyright © 2023 Hardcore Engineering Inc.
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
  type Account,
  AccountRole,
  type AccountUuid,
  type AttachedDoc,
  type Class,
  clone,
  type Collaborator,
  type Doc,
  type DocumentQuery,
  type Domain,
  DOMAIN_MODEL,
  type FindResult,
  generateId,
  getClassCollaborators,
  GuestActivityScope,
  type LookupData,
  type MeasureContext,
  type ObjQueryType,
  type Position,
  type PullArray,
  type Ref,
  type SearchOptions,
  type SearchQuery,
  type SearchResultDoc,
  type SearchResult,
  type SessionData,
  shouldShowArchived,
  type Space,
  isRowLevelRestricted,
  systemAccountUuid,
  toFindResult,
  type Tx,
  type TxCreateDoc,
  type TxCUD,
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
  type ServerFindOptions,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import contact, { type Person } from '@hcengineering/contact'
import {
  excludeSpacesFromQuery,
  getDisabledModuleSpaceClasses,
  getGuestVisiblePersonIds,
  hasNarrowIdQuery,
  resolveDisabledModuleSpaceIds,
  resolveGuestExtraPermissions,
  type SpaceWithMembers
} from './guestVisibility'
import { AccountIdentityResolver, RowVisibilityResolver } from './rowVisibility'
import { isOwner, isSystem } from './utils'

/**
 * @public
 */
export class SpaceSecurityMiddleware extends BaseMiddleware implements Middleware {
  private allowedSpaces: Record<AccountUuid, Ref<Space>[]> = {}
  private readonly spacesMap = new Map<Ref<Space>, SpaceWithMembers>()
  private readonly privateSpaces = new Set<Ref<Space>>()
  private readonly _domainSpaces = new Map<string, Set<Ref<Space>> | Promise<Set<Ref<Space>>>>()
  private readonly publicSpaces = new Set<Ref<Space>>()
  private readonly systemSpaces = new Set<Ref<Space>>()
  private readonly rowVisibility = new RowVisibilityResolver(this.next)

  wasInit: Promise<void> | boolean = false

  private readonly mainSpaces = new Set([
    core.space.Configuration,
    core.space.DerivedTx,
    core.space.Model,
    core.space.Space,
    core.space.Workspace,
    core.space.Tx
  ])

  private constructor (
    private readonly skipFindCheck: boolean,
    context: PipelineContext,
    next?: Middleware
  ) {
    super(context, next)
  }

  static async create (
    skipFindCheck: boolean,
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<SpaceSecurityMiddleware> {
    return new SpaceSecurityMiddleware(skipFindCheck, context, next)
  }

  private resyncDomains (): void {
    this.wasInit = false
  }

  private addMemberSpace (member: AccountUuid, space: Ref<Space>): void {
    const arr = this.allowedSpaces[member] ?? []
    arr.push(space)
    this.allowedSpaces[member] = arr
  }

  private addSpace (space: SpaceWithMembers): void {
    this.spacesMap.set(space._id, space)
    if (space.private) {
      this.privateSpaces.add(space._id)
    } else {
      this.publicSpaces.add(space._id)
    }
    for (const member of space.members) {
      this.addMemberSpace(member, space._id)
    }
  }

  async init (ctx: MeasureContext): Promise<void> {
    if (this.wasInit === true) {
      return
    }
    if (this.wasInit === false) {
      this.wasInit = (async () => {
        await ctx.with('init-space-security', {}, async (ctx) => {
          ctx.contextData = undefined
          const spaces: SpaceWithMembers[] =
            (await this.next?.findAll(
              ctx,
              core.class.Space,
              {},
              {
                projection: {
                  archived: 1,
                  private: 1,
                  _class: 1,
                  _id: 1,
                  members: 1
                }
              }
            )) ?? []
          this.spacesMap.clear()
          this.publicSpaces.clear()
          this.systemSpaces.clear()
          for (const space of spaces) {
            if (space._class === core.class.SystemSpace) {
              this.systemSpaces.add(space._id)
            } else {
              this.addSpace(space)
            }
          }
        })
      })()
    }
    if (this.wasInit instanceof Promise) {
      await this.wasInit
      this.wasInit = true
    }
  }

  private removeMemberSpace (member: AccountUuid, space: Ref<Space>): void {
    const arr = this.allowedSpaces[member]
    if (arr !== undefined) {
      const index = arr.findIndex((p) => p === space)
      if (index !== -1) {
        arr.splice(index, 1)
        this.allowedSpaces[member] = arr
      }
    }
  }

  private removeSpace (_id: Ref<Space>): void {
    const space = this.spacesMap.get(_id)
    if (space !== undefined) {
      for (const member of space.members) {
        this.removeMemberSpace(member, space._id)
      }
    }
    this.spacesMap.delete(_id)
    this.privateSpaces.delete(_id)
    this.publicSpaces.delete(_id)
  }

  private async handeCollaborator (ctx: MeasureContext<SessionData>, tx: TxCUD<Collaborator>): Promise<void> {
    if (!this.context.hierarchy.isDerived(tx.objectClass, core.class.Collaborator)) return
    if (tx._class === core.class.TxCreateDoc) {
      const collab = TxProcessor.createDoc2Doc<Collaborator>(tx as TxCreateDoc<Collaborator>)
      this.handleChangeCollaborator(ctx, collab)
    } else if (tx._class === core.class.TxRemoveDoc) {
      const collab = (await this.next?.findAll(ctx, core.class.Collaborator, {
        _id: tx.objectId
      })) as Collaborator[]
      if (collab.length === 0) return
      this.handleChangeCollaborator(ctx, collab[0])
    }
  }

  private handleChangeCollaborator (ctx: MeasureContext<SessionData>, collab: Collaborator): void {
    const collabSec = this.context.modelDb.findAllSync(core.class.ClassCollaborators, {
      attachedTo: collab.attachedToClass
    })[0]
    if (collabSec?.provideSecurity === true) {
      for (const val of ctx.contextData.socialStringsToUsers.values()) {
        if (
          val.accontUuid === collab.collaborator &&
          [AccountRole.Guest, AccountRole.ReadOnlyGuest].includes(val.role)
        ) {
          this.brodcastEvent(ctx, [val.accontUuid])
        }
      }
    }
  }

  private handleCreate (tx: TxCUD<Space>): void {
    const createTx = tx as TxCreateDoc<Space>
    if (!this.context.hierarchy.isDerived(createTx.objectClass, core.class.Space)) return
    if (createTx.objectClass === core.class.SystemSpace) {
      this.systemSpaces.add(createTx.objectId)
    } else {
      const res = TxProcessor.createDoc2Doc<Space>(createTx)
      this.addSpace(res)
    }
  }

  private pushMembersHandle (
    ctx: MeasureContext,
    addedMembers: AccountUuid | Position<AccountUuid>,
    space: Ref<Space>
  ): void {
    if (typeof addedMembers === 'object') {
      for (const member of addedMembers.$each) {
        this.addMemberSpace(member, space)
      }
      this.brodcastEvent(ctx, addedMembers.$each, space)
    } else {
      this.addMemberSpace(addedMembers, space)
      this.brodcastEvent(ctx, [addedMembers], space)
    }
  }

  private pullMembersHandle (
    ctx: MeasureContext,
    removedMembers: Partial<AccountUuid> | PullArray<AccountUuid>,
    space: Ref<Space>
  ): void {
    if (typeof removedMembers === 'object') {
      const { $in } = removedMembers as PullArray<AccountUuid>
      if ($in !== undefined) {
        for (const member of $in) {
          this.removeMemberSpace(member, space)
        }
        this.brodcastEvent(ctx, $in, space)
      }
    } else {
      this.removeMemberSpace(removedMembers, space)
      this.brodcastEvent(ctx, [removedMembers], space)
    }
  }

  private syncMembers (ctx: MeasureContext, members: AccountUuid[], space: SpaceWithMembers): void {
    const oldMembers = new Set(space.members)
    const newMembers = new Set(members)
    const changed: AccountUuid[] = []
    for (const old of oldMembers) {
      if (!newMembers.has(old)) {
        this.removeMemberSpace(old, space._id)
        changed.push(old)
      }
    }
    for (const newMem of newMembers) {
      if (!oldMembers.has(newMem)) {
        this.addMemberSpace(newMem, space._id)
        changed.push(newMem)
      }
    }
    // TODO: consider checking if updated social strings actually change assigned accounts
    if (changed.length > 0) {
      this.brodcastEvent(ctx, changed, space._id)
    }
  }

  private brodcastEvent (ctx: MeasureContext<SessionData>, users: AccountUuid[], space?: Ref<Space>): void {
    const targets = this.getTargets(users)
    const tx: TxWorkspaceEvent = {
      _class: core.class.TxWorkspaceEvent,
      _id: generateId(),
      event: WorkspaceEvent.SecurityChange,
      modifiedBy: core.account.System,
      modifiedOn: Date.now(),
      objectSpace: space ?? core.space.DerivedTx,
      space: core.space.DerivedTx,
      params: null
    }
    ctx.contextData.broadcast.txes.push(tx)
    ctx.contextData.broadcast.targets['security' + tx._id] = async (it) => {
      // TODO: I'm not sure it is called
      if (it._id === tx._id) {
        return {
          target: targets
        }
      }
    }
  }

  private broadcastNonMembers (ctx: MeasureContext<SessionData>, space: SpaceWithMembers): void {
    const members = space?.members ?? []

    this.brodcastEvent(ctx, members, space._id)
  }

  private broadcastAll (ctx: MeasureContext<SessionData>, space: SpaceWithMembers): void {
    const { socialStringsToUsers } = ctx.contextData
    const accounts = Array.from(new Set(Array.from(socialStringsToUsers.values()).map((v) => v.accontUuid)))

    this.brodcastEvent(ctx, accounts, space._id)
  }

  private async handleUpdate (ctx: MeasureContext, tx: TxCUD<Space>): Promise<void> {
    await this.init(ctx)

    const updateDoc = tx as TxUpdateDoc<Space>
    if (!this.context.hierarchy.isDerived(updateDoc.objectClass, core.class.Space)) return

    const space = this.spacesMap.get(updateDoc.objectId)
    if (space !== undefined) {
      if (updateDoc.operations.private !== undefined) {
        if (updateDoc.operations.private) {
          this.privateSpaces.add(updateDoc.objectId)
          this.publicSpaces.delete(updateDoc.objectId)
          this.broadcastNonMembers(ctx, space)
        } else if (!updateDoc.operations.private) {
          this.privateSpaces.delete(updateDoc.objectId)
          this.publicSpaces.add(updateDoc.objectId)
          this.broadcastNonMembers(ctx, space)
        }
      }

      if (updateDoc.operations.members !== undefined) {
        this.syncMembers(ctx, updateDoc.operations.members, space)
      }
      if (updateDoc.operations.$push?.members !== undefined) {
        this.pushMembersHandle(ctx, updateDoc.operations.$push.members, space._id)
      }

      if (updateDoc.operations.$pull?.members !== undefined) {
        this.pullMembersHandle(ctx, updateDoc.operations.$pull.members, space._id)
      }
      if (updateDoc.operations.archived !== undefined) {
        this.broadcastAll(ctx, space)
      }
      const updatedSpace = TxProcessor.updateDoc2Doc(space as any, updateDoc)
      this.spacesMap.set(updateDoc.objectId, updatedSpace)
    }
  }

  private handleRemove (tx: TxCUD<Space>): void {
    const removeTx = tx as TxRemoveDoc<Space>
    if (!this.context.hierarchy.isDerived(removeTx.objectClass, core.class.Space)) return
    if (removeTx._class !== core.class.TxRemoveDoc) return
    this.removeSpace(tx.objectId)
  }

  private async handleTx (ctx: MeasureContext, tx: TxCUD<Space>): Promise<void> {
    await this.init(ctx)
    if (tx._class === core.class.TxCreateDoc) {
      this.handleCreate(tx)
    } else if (tx._class === core.class.TxUpdateDoc) {
      await this.handleUpdate(ctx, tx)
    } else if (tx._class === core.class.TxRemoveDoc) {
      this.handleRemove(tx)
    }
  }

  getTargets (accounts: AccountUuid[]): AccountUuid[] {
    const res = Array.from(new Set(accounts))
    // We need to add system account for targets for integrations to work properly
    res.push(systemAccountUuid)

    return res
  }

  private async processTxSpaceDomain (sctx: MeasureContext, actualTx: TxCUD<Doc>): Promise<void> {
    if (actualTx._class === core.class.TxCreateDoc) {
      const ctx = actualTx as TxCreateDoc<Doc>
      const doc = TxProcessor.createDoc2Doc(ctx)
      const domain = this.context.hierarchy.getDomain(ctx.objectClass)
      const key = this.getKey(domain)
      const space = (doc as any)[key]
      if (space === undefined) return
      ;(await this.getDomainSpaces(sctx, domain)).add(space)
    } else if (actualTx._class === core.class.TxUpdateDoc) {
      const updTx = actualTx as TxUpdateDoc<Doc>
      const domain = this.context.hierarchy.getDomain(updTx.objectClass)
      const key = this.getKey(domain)
      const space = (updTx.operations as any)[key]
      if (space !== undefined) {
        ;(await this.getDomainSpaces(sctx, domain)).add(space)
      }
    }
  }

  private async processTx (ctx: MeasureContext<SessionData>, tx: Tx): Promise<void> {
    const h = this.context.hierarchy
    if (TxProcessor.isExtendsCUD(tx._class)) {
      const cudTx = tx as TxCUD<Doc>
      const isSpace = h.isDerived(cudTx.objectClass, core.class.Space)
      if (isSpace) {
        await this.handleTx(ctx, cudTx as TxCUD<Space>)
      } else {
        await this.handeCollaborator(ctx, cudTx as TxCUD<Collaborator>)
      }
      await this.processTxSpaceDomain(ctx, tx as TxCUD<Doc>)
    } else if (tx._class === core.class.TxWorkspaceEvent) {
      const event = tx as TxWorkspaceEvent
      if (event.event === WorkspaceEvent.BulkUpdate) {
        this.resyncDomains()
      }
    }
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    await this.init(ctx)
    const processed = new Set<Ref<Tx>>()
    ctx.contextData.contextCache.set('processed', processed)
    for (const tx of txes) {
      processed.add(tx._id)
      await this.processTx(ctx, tx)
    }
    return await this.provideTx(ctx, txes)
  }

  override async handleBroadcast (ctx: MeasureContext<SessionData>): Promise<void> {
    const processed: Set<Ref<Tx>> = ctx.contextData.contextCache.get('processed') ?? new Set<Ref<Tx>>()
    ctx.contextData.contextCache.set('processed', processed)
    for (const txd of ctx.contextData.broadcast.txes) {
      if (!processed.has(txd._id)) {
        await this.processTx(ctx, txd)
      }
    }
    for (const tx of ctx.contextData.broadcast.txes) {
      if (TxProcessor.isExtendsCUD(tx._class)) {
        // TODO: Do we need security check here?
        const cudTx = tx as TxCUD<Doc>
        await this.processTxSpaceDomain(ctx, cudTx)
      } else if (tx._class === core.class.TxWorkspaceEvent) {
        const event = tx as TxWorkspaceEvent
        if (event.event === WorkspaceEvent.BulkUpdate) {
          this.resyncDomains()
        }
      }
    }

    ctx.contextData.broadcast.targets.spaceSec = async (tx) => {
      const cud = tx as TxCUD<Doc>
      if (cud.objectClass === undefined) return undefined

      // For system and main spaces broadcast to all users except guests that are not collaborators for objects with collab security enabled
      if (this.systemSpaces.has(tx.objectSpace) || this.mainSpaces.has(tx.objectSpace)) {
        const collabSec = getClassCollaborators(this.context.modelDb, this.context.hierarchy, cud.objectClass)
        if (collabSec?.provideSecurity === true) {
          const guests = new Set<AccountUuid>()
          for (const val of ctx.contextData.socialStringsToUsers.values()) {
            if ([AccountRole.Guest, AccountRole.ReadOnlyGuest].includes(val.role)) {
              guests.add(val.accontUuid)
            }
          }
          const collabs = (await this.next?.findAll(ctx, core.class.Collaborator, {
            attachedTo: cud.objectId
          })) as Collaborator[]
          for (const collab of collabs) {
            guests.delete(collab.collaborator)
          }
          return { exclude: Array.from(guests) }
        }
        return undefined
      }

      const space = this.spacesMap.get(tx.objectSpace)
      if (space === undefined) return undefined

      const getCollabTargets = async (_id: Ref<Doc>): Promise<AccountUuid[]> => {
        const guests = new Set<AccountUuid>()
        for (const val of ctx.contextData.socialStringsToUsers.values()) {
          if ([AccountRole.Guest, AccountRole.ReadOnlyGuest].includes(val.role)) {
            guests.add(val.accontUuid)
          }
        }
        const collaboratorObjs = (await this.next?.findAll(ctx, core.class.Collaborator, {
          attachedTo: _id
        })) as Collaborator[]

        return collaboratorObjs.map((it) => it.collaborator).filter((it) => guests.has(it))
      }

      // For all other spaces broadcast to space members
      // + guests that are collaborators for objects with collab security enabled
      // + guests that are collaborators for attached objects with collab security enabled
      let collabTargets: AccountUuid[] = []
      const collabSec = getClassCollaborators(this.context.modelDb, this.context.hierarchy, cud.objectClass)
      if (collabSec?.provideSecurity === true) {
        collabTargets = await getCollabTargets(cud.objectId)
      } else if (cud.attachedTo != null && cud.attachedToClass != null) {
        const attachedCollabSec = getClassCollaborators(
          this.context.modelDb,
          this.context.hierarchy,
          cud.attachedToClass
        )
        if (attachedCollabSec?.provideSecurity === true) {
          collabTargets = await getCollabTargets(cud.attachedTo)
        }
      }

      const spaceTargets = space.members.length === 0 ? [] : this.getTargets(space?.members)
      const target = [...collabTargets, ...spaceTargets]

      return target.length === 0 ? undefined : { target }
    }

    await this.next?.handleBroadcast(ctx)
  }

  private getAllAllowedSpaces (
    account: Account,
    isData: boolean,
    showArchived: boolean,
    forSearch: boolean = false
  ): Ref<Space>[] {
    const userSpaces = this.allowedSpaces[account.uuid] ?? []
    let res = [...Array.from(userSpaces), account.uuid as unknown as Ref<Space>, ...this.mainSpaces]
    if (!forSearch || ![AccountRole.Guest, AccountRole.ReadOnlyGuest].includes(account.role)) {
      res = [...res, ...this.systemSpaces]
    }
    const ignorePublicSpaces = isData || account.role === AccountRole.ReadOnlyGuest
    const unfilteredRes = ignorePublicSpaces ? res : [...res, ...this.publicSpaces]
    if (showArchived) {
      return unfilteredRes
    }
    return unfilteredRes.filter((p) => this.spacesMap.get(p)?.archived !== true)
  }

  async getDomainSpaces (ctx: MeasureContext, domain: Domain): Promise<Set<Ref<Space>>> {
    let domainSpaces = this._domainSpaces.get(domain)
    if (domainSpaces === undefined) {
      const p = (
        this.next?.groupBy<Ref<Space>, Doc>(ctx, domain, this.getKey(domain)) ?? Promise.resolve(new Map())
      ).then((r) => new Set<Ref<Space>>(r.keys()))
      this._domainSpaces.set(domain, p)
      domainSpaces = await p
      this._domainSpaces.set(domain, domainSpaces)
    }
    return domainSpaces instanceof Promise ? await domainSpaces : domainSpaces
  }

  private async filterByDomain (
    ctx: MeasureContext,
    domain: Domain,
    spaces: Ref<Space>[]
  ): Promise<{ result: Set<Ref<Space>>, allDomainSpaces: boolean, domainSpaces: Set<Ref<Space>> }> {
    const domainSpaces = await this.getDomainSpaces(ctx, domain)
    const result = new Set(spaces.filter((p) => domainSpaces.has(p)))
    return {
      result,
      allDomainSpaces: result.size === domainSpaces.size,
      domainSpaces
    }
  }

  private async mergeQuery<T extends Doc>(
    ctx: MeasureContext,
    account: Account,
    query: ObjQueryType<T['space']>,
    domain: Domain,
    isSpace: boolean,
    showArchived: boolean
  ): Promise<ObjQueryType<T['space']> | undefined> {
    const spaces = await this.filterByDomain(ctx, domain, this.getAllAllowedSpaces(account, !isSpace, showArchived))
    if (query == null) {
      if (spaces.allDomainSpaces) {
        return undefined
      }
      return { $in: Array.from(spaces.result) }
    }
    if (typeof query === 'string') {
      if (!spaces.result.has(query)) {
        return { $in: [] }
      }
    } else if (query.$in != null) {
      query.$in = query.$in.filter((p) => spaces.result.has(p))
      if (query.$in.length === spaces.domainSpaces.size) {
        // all domain spaces
        delete query.$in
      }
    } else {
      if (spaces.allDomainSpaces) {
        delete query.$in
      } else {
        query.$in = Array.from(spaces.result)
      }
    }
    if (Object.keys(query).length === 0) {
      return undefined
    }
    return query
  }

  private getKey (domain: string): string {
    return domain === 'tx' ? 'objectSpace' : domain === 'space' ? '_id' : 'space'
  }

  override async findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    await this.init(ctx)

    const domain = this.context.hierarchy.getDomain(_class)
    const newQuery = clone(query)
    const account = ctx.contextData.account
    const isRestricted = isRowLevelRestricted(account.role)
    const isSpace = this.context.hierarchy.isDerived(_class, core.class.Space)
    const field = this.getKey(domain)
    const showArchived: boolean = shouldShowArchived(newQuery, options)

    let clientFilterSpaces: Set<Ref<Space>> | undefined

    if (!isSystem(account, ctx) && account.role !== AccountRole.DocGuest && domain !== DOMAIN_MODEL) {
      if (!isOwner(account, ctx) || !isSpace || !showArchived) {
        if (newQuery[field] !== undefined) {
          const res = await this.mergeQuery(ctx, account, newQuery[field], domain, isSpace, showArchived)
          if (res === undefined) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete newQuery[field]
          } else {
            newQuery[field] = res
            if (typeof res === 'object') {
              if (Array.isArray(res.$in) && res.$in.length === 1 && Object.keys(res).length === 1) {
                newQuery[field] = res.$in[0]
              }
            }
          }
        } else {
          const spaces = await this.filterByDomain(
            ctx,
            domain,
            this.getAllAllowedSpaces(account, !isSpace, showArchived)
          )
          if (spaces.allDomainSpaces) {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete newQuery[field]
          } else if (spaces.result.size === 1) {
            newQuery[field] = Array.from(spaces.result)[0]
            if (options !== undefined) {
              options.allowedSpaces = Array.from(spaces.result)
            } else {
              options = { allowedSpaces: Array.from(spaces.result) }
            }
          } else {
            // Check if spaces are greater than 85% of all domain spaces. In this case, return all and filter on the client.
            if (spaces.result.size / spaces.domainSpaces.size > 0.85 && options?.limit === undefined) {
              clientFilterSpaces = spaces.result
              delete newQuery.space
            } else {
              newQuery[field] = { $in: Array.from(spaces.result) }
              if (options !== undefined) {
                options.allowedSpaces = Array.from(spaces.result)
              } else {
                options = { allowedSpaces: Array.from(spaces.result) }
              }
            }
          }
        }
      }
    }

    // Person/Employee visibility for Guest / ReadOnlyGuest / DocGuest: restrict open browse/search
    // queries to accounts sharing a real space with the caller. Applied on top of whichever query
    // object the backend actually executes (`skipFindCheck` deployments rely on the DB adapter for
    // space-level security and pass the original `query` through untouched, so the restriction is
    // layered on there too, not only on `newQuery`).
    let baseQuery: DocumentQuery<T> = !this.skipFindCheck ? newQuery : query
    if (
      !isSystem(account, ctx) &&
      isRestricted &&
      this.context.hierarchy.isDerived(_class, contact.class.Person) &&
      !hasNarrowIdQuery(baseQuery)
    ) {
      const allowedPersonIds = await getGuestVisiblePersonIds(
        this.next,
        ctx,
        account,
        this.allowedSpaces,
        this.spacesMap
      )
      if (allowedPersonIds.size === 0) {
        return toFindResult([], 0)
      }
      const restrictedQuery: DocumentQuery<T> = { ...baseQuery, _id: { $in: Array.from(allowedPersonIds) } }
      baseQuery = restrictedQuery
    }

    // A class without an explicit policy is allowed to use ordinary real-space membership only.
    // Shared and system spaces are visible to many accounts by construction, so treating them as
    // ordinary membership would turn a forgotten policy into a data leak. Keep Person on its
    // dedicated visibility path above until its relationship-based policy is modelled explicitly.
    if (
      !isSystem(account, ctx) &&
      isRestricted &&
      domain !== DOMAIN_MODEL &&
      !this.context.hierarchy.isDerived(_class, contact.class.Person) &&
      !this.rowVisibility.hasPolicy(this.context.hierarchy, _class as Ref<Class<Doc>>)
    ) {
      const nonOrdinarySpaces = new Set<Ref<Space>>([...this.mainSpaces, ...this.systemSpaces])
      const excluded = excludeSpacesFromQuery((baseQuery as Record<string, any>)[field], nonOrdinarySpaces)
      if ('deny' in excluded) {
        return toFindResult([], 0)
      }
      baseQuery = { ...baseQuery }
      if (excluded.query === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete (baseQuery as Record<string, any>)[field]
      } else {
        ;(baseQuery as Record<string, any>)[field] = excluded.query
      }
    }

    // Row-level ownership (Layer 2) for classes living in mainSpaces - see `./rowVisibility`.
    if (!isSystem(account, ctx) && isRestricted) {
      const identity = new AccountIdentityResolver(this.next, ctx, account)
      const decision = await this.rowVisibility.resolve(ctx, this.context.hierarchy, _class, baseQuery, identity)
      if (decision.kind === 'deny') {
        return toFindResult([], 0)
      }
      if (decision.kind === 'narrow') {
        baseQuery = decision.query
      }
    }

    // A whole application/module can be turned off per role in Settings → Guest permissions
    // (`ModulePermissionGroup.enabled`). That used to only hide the sidebar icon, gate writes, and
    // (searchFulltext below) exclude the module from @-mention/search results — plain `findAll`
    // reads (e.g. opening a card by direct navigation) were untouched, so a guest who still
    // happened to be a member of the module's space (e.g. via auto-join) could still read its
    // documents. Excluding the module's spaces from the space field here closes that gap for both
    // `core.class.Space`-derived classes (field `_id`) and ordinary content classes (field
    // `space`/`objectSpace`) — unlike the Person/sensitive-class restrictions above, this is a
    // blanket exclusion with no known-ref bypass: a disabled module means no read access to it.
    if (!isSystem(account, ctx) && isRestricted && domain !== DOMAIN_MODEL) {
      const disabledSpaceClasses = await getDisabledModuleSpaceClasses(this.next, ctx, account)
      const disabledSpaceIds = resolveDisabledModuleSpaceIds(
        this.context.hierarchy,
        disabledSpaceClasses,
        this.spacesMap
      )
      if (disabledSpaceIds.size > 0) {
        const current = (baseQuery as Record<string, any>)[field]
        const excluded = excludeSpacesFromQuery(current, disabledSpaceIds)
        if ('deny' in excluded) {
          return toFindResult([], 0)
        }
        const updatedQuery: DocumentQuery<T> = { ...baseQuery }
        if (excluded.query === undefined) {
          // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
          delete (updatedQuery as Record<string, any>)[field]
        } else {
          ;(updatedQuery as Record<string, any>)[field] = excluded.query
        }
        baseQuery = updatedQuery
      }
    }

    let findResult = await this.provideFindAll(ctx, _class, baseQuery, options)
    if (clientFilterSpaces !== undefined) {
      const cfs = clientFilterSpaces
      findResult = toFindResult(
        findResult.filter((it) => cfs.has((it as any)[field])),
        findResult.total,
        findResult.lookupMap
      )
    }
    if (!isSystem(account, ctx) && isRestricted && this.context.hierarchy.isDerived(_class, core.class.AttachedDoc)) {
      const { activityScope } = await resolveGuestExtraPermissions(this.next, ctx, account)
      if (activityScope !== GuestActivityScope.Any) {
        const filtered = await this.filterActivityByScope(ctx, findResult, account, activityScope)
        findResult = toFindResult(filtered, filtered.length, findResult.lookupMap)
      }
    }
    if (account.role !== AccountRole.DocGuest) {
      if (options?.lookup !== undefined) {
        for (const object of findResult) {
          if (object.$lookup !== undefined) {
            this.filterLookup(ctx, object.$lookup, showArchived)
          }
        }
      }
    }
    return findResult
  }

  override async searchFulltext (
    ctx: MeasureContext<SessionData>,
    query: SearchQuery,
    options: SearchOptions
  ): Promise<SearchResult> {
    await this.init(ctx)
    const newQuery = { ...query }
    const account = ctx.contextData.account
    const personRestricted = isRowLevelRestricted(account.role)
    let personClassesSearched = false
    if (!isSystem(account, ctx)) {
      const allSpaces = this.getAllAllowedSpaces(account, true, false, true)
      if (query.classes !== undefined) {
        const res = new Set<Ref<Space>>()
        const passedDomains = new Set<string>()
        for (const _class of query.classes) {
          const domain = this.context.hierarchy.getDomain(_class)
          const isPersonClass = this.context.hierarchy.isDerived(_class, contact.class.Person)
          if (isPersonClass) {
            personClassesSearched = true
          }
          if (personRestricted && isPersonClass) {
            // contact.space.Contacts is a SystemSpace, normally excluded from `allSpaces` here
            // (see getAllAllowedSpaces's forSearch branch) specifically for these roles — which is
            // what makes the @-mention/People search come back empty for guests today. Let it
            // through for Person/Employee classes only; the actual visibility restriction is
            // enforced below, on the results, via getGuestVisiblePersonIds.
            res.add(contact.space.Contacts)
            continue
          }
          if (passedDomains.has(domain)) {
            continue
          }
          passedDomains.add(domain)
          const spaces = await this.filterByDomain(ctx, domain, allSpaces)
          for (const space of spaces.result) {
            res.add(space)
          }
        }
        newQuery.spaces = [...res]
      } else {
        newQuery.spaces = allSpaces
      }

      // Drop spaces belonging to a module/application the caller's role has disabled in
      // Settings → Guest permissions, so a disabled module's cards stop turning up in
      // search/mention results (previously only the sidebar icon and writes were gated).
      const disabledSpaceClasses = await getDisabledModuleSpaceClasses(this.next, ctx, account)
      const disabledSpaceIds = resolveDisabledModuleSpaceIds(
        this.context.hierarchy,
        disabledSpaceClasses,
        this.spacesMap
      )
      if (disabledSpaceIds.size > 0 && newQuery.spaces !== undefined) {
        newQuery.spaces = newQuery.spaces.filter((s) => !disabledSpaceIds.has(s))
      }
    }
    const result = await this.provideSearchFulltext(ctx, newQuery, options)
    if (personRestricted && personClassesSearched && !isSystem(account, ctx)) {
      const allowedPersonIds = await getGuestVisiblePersonIds(
        this.next,
        ctx,
        account,
        this.allowedSpaces,
        this.spacesMap
      )
      result.docs = result.docs.filter(
        (d) =>
          !this.context.hierarchy.isDerived(d.doc._class, contact.class.Person) ||
          allowedPersonIds.has(d.doc._id as Ref<Person>)
      )
    }
    if (personRestricted && !isSystem(account, ctx)) {
      const identity = new AccountIdentityResolver(this.next, ctx, account)
      result.docs = await this.filterSearchResultsByRowVisibility(ctx, result.docs, identity)
      result.total = result.docs.length
    }
    return result
  }

  /**
   * Full-text results contain only a small document projection, so an owner/link policy cannot
   * be evaluated from the result itself. Re-query each candidate through the resolved policy.
   * Known-id bypasses are intentionally disabled: a search result is not proof that the caller
   * obtained its id from an already-authorized document.
   */
  private async filterSearchResultsByRowVisibility (
    ctx: MeasureContext<SessionData>,
    docs: SearchResultDoc[],
    identity: AccountIdentityResolver
  ): Promise<SearchResultDoc[]> {
    const visible = await Promise.all(
      docs.map(async (result) => {
        const _class = result.doc._class
        if (!this.rowVisibility.hasPolicy(this.context.hierarchy, _class)) {
          const query: DocumentQuery<Doc> = { _id: result.doc._id }
          const matching = await this.findAll(ctx, _class, query, {
            limit: 1
          })
          return matching.length > 0
        }
        const query: DocumentQuery<Doc> = { _id: result.doc._id }
        const decision = await this.rowVisibility.resolve(ctx, this.context.hierarchy, _class, query, identity, false)
        if (decision.kind === 'deny') return false
        if (decision.kind === 'unrestricted') return true
        const matching = await this.provideFindAll(ctx, _class, decision.query, { limit: 1 })
        return matching.length > 0
      })
    )
    return docs.filter((_doc, index) => visible[index])
  }

  /**
   * Narrows a restricted role's view of `AttachedDoc` results (chat/activity messages) per
   * `GuestExtraPermissions.activityScope`, but only for results attached to a class that opted in
   * via `RowVisibility.scopeActivityToOwner` (e.g. card.class.Card) - activity on a shared space
   * like a channel is untouched regardless of this setting.
   */
  private async filterActivityByScope<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    docs: T[],
    account: Account,
    scope: GuestActivityScope
  ): Promise<T[]> {
    if (docs.length === 0) return docs
    const passthrough: T[] = []
    const scoped: T[] = []
    for (const doc of docs) {
      const attachedToClass = (doc as unknown as AttachedDoc).attachedToClass
      const opted =
        attachedToClass !== undefined &&
        this.context.hierarchy.classHierarchyMixin(attachedToClass, core.mixin.RowVisibility)?.scopeActivityToOwner ===
          true
      ;(opted ? scoped : passthrough).push(doc)
    }
    if (scoped.length === 0) return passthrough

    if (scope === GuestActivityScope.Own) {
      const own = scoped.filter((doc) => (doc as unknown as { createdBy?: unknown }).createdBy === account.primarySocialId)
      return [...passthrough, ...own]
    }

    const attachedToIds = Array.from(new Set(scoped.map((doc) => (doc as unknown as AttachedDoc).attachedTo)))
    const collabQuery: DocumentQuery<Collaborator> = {
      attachedTo: { $in: attachedToIds },
      collaborator: account.uuid
    }
    const collaborators = ((await this.next?.findAll(ctx, core.class.Collaborator, collabQuery, {
      projection: { attachedTo: 1 }
    })) ?? []) as Array<Pick<Collaborator, 'attachedTo'>>
    const allowedAttachedTo = new Set(collaborators.map((c) => c.attachedTo))
    const collaboratorDocs = scoped.filter((doc) => allowedAttachedTo.has((doc as unknown as AttachedDoc).attachedTo))
    return [...passthrough, ...collaboratorDocs]
  }

  filterLookup<T extends Doc>(ctx: MeasureContext, lookup: LookupData<T>, showArchived: boolean): void {
    if (Object.keys(lookup).length === 0) return
    const account = ctx.contextData.account
    if (isSystem(account, ctx)) return
    const owner = isOwner(account, ctx)
    const h = this.context.hierarchy
    const allowedSpaces = new Set(this.getAllAllowedSpaces(account, true, showArchived))
    for (const key in lookup) {
      const val = lookup[key]
      if (Array.isArray(val)) {
        const arr: AttachedDoc[] = []
        for (const value of val) {
          const isSpace = '_class' in value && h.isDerived(value._class, core.class.Space)
          const availableForOwner = owner && isSpace
          const availableSpace = isSpace && allowedSpaces.has(value._id)
          const availableDoc = !isSpace && allowedSpaces.has(value.space)
          if (availableForOwner || availableSpace || availableDoc) {
            arr.push(value)
          }
        }
        lookup[key] = arr as any
      } else if (val !== undefined) {
        const isSpace = '_class' in val && h.isDerived(val._class, core.class.Space)
        const availableForOwner = owner && isSpace
        const availableSpace = isSpace && allowedSpaces.has(val._id as Ref<Space>)
        const availableDoc = !isSpace && allowedSpaces.has(val.space)
        if (!availableForOwner && !availableSpace && !availableDoc) {
          // allow attached lookups for guests when collaborator security is enabled
          // do not check if collaborator of the doc because it's being checked on the storage (DB) level
          // as otherwise there will be no doc here at all
          if (key === 'attachedTo' && ctx.contextData.modelDb?.hierarchy != null) {
            const attachedVal = val as AttachedDoc
            if (attachedVal.attachedToClass == null) {
              lookup[key] = undefined
              continue
            }

            const collabSec = getClassCollaborators(
              ctx.contextData.modelDb,
              ctx.contextData.modelDb.hierarchy,
              attachedVal.attachedToClass
            )
            const collabSecEnabled =
              collabSec?.provideSecurity === true &&
              [AccountRole.Guest, AccountRole.ReadOnlyGuest].includes(account.role)
            if (!collabSecEnabled) {
              lookup[key] = undefined
            }
          } else {
            lookup[key] = undefined
          }
        }
      }
    }
  }
}
