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
  type Account,
  AccountRole,
  type AccountUuid,
  type Class,
  computeSpaceMembers,
  type Doc,
  type DocumentQuery,
  type FindResult,
  hasAccountRole,
  isGuestRole,
  type MeasureContext,
  readOnlyGuestAccountUuid,
  type Ref,
  type SearchOptions,
  type SearchQuery,
  type SearchResult,
  type SessionData,
  type Space,
  supportsUserGroups,
  systemAccountUuid,
  toFindResult,
  touchesAttribute,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
  TxFactory,
  TxProcessor,
  type TxUpdateDoc,
  type UserGroup,
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

type ArrayOp = AccountUuid | { $each: AccountUuid[], $position?: number } | { $in: AccountUuid[] }

function opValues (value: ArrayOp | undefined): AccountUuid[] {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') return [value]
  if ('$each' in value) return value.$each
  if ('$in' in value) return value.$in
  return []
}

/**
 * Space membership with user groups.
 *
 * `Space.members` is a server-computed field: `unique(directMembers ∪ members of groups)`. Clients and services
 * keep writing `members`; this middleware turns those writes into writes of `directMembers`, so a removed direct
 * member keeps access through a group and a group member is not stored as a direct one, and adds the resulting
 * `members` change to the same update. Changes of group members are checked after the write (see
 * `syncGroupSpaces`). The recompute trigger stays for writes that do not pass here (server triggers) and roles.
 *
 * It must stay above SpaceSecurityMiddleware and the permission middlewares: they see the rewritten update with
 * its `members` change, as for a plain change of members.
 *
 * Also guards user groups: only workspace maintainers and owners manage them and bind them to spaces, and guests
 * can neither read them (directly, through lookups or associations) nor receive their transactions.
 */
export class SpaceMembershipMiddleware extends BaseMiddleware implements Middleware {
  private constructor (context: PipelineContext, next?: Middleware) {
    super(context, next)
  }

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<SpaceMembershipMiddleware> {
    return new SpaceMembershipMiddleware(context, next)
  }

  override async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const changedGroups = new Set<Ref<UserGroup>>()
    for (const tx of txes) {
      await this.processTx(ctx, tx, changedGroups)
    }
    const result = await this.provideTx(ctx, txes)
    if (changedGroups.size > 0) {
      await this.syncGroupSpaces(ctx, changedGroups)
    }
    return result
  }

  private async processTx (ctx: MeasureContext<SessionData>, tx: Tx, changedGroups: Set<Ref<UserGroup>>): Promise<void> {
    if (tx._class === core.class.TxApplyIf) {
      for (const inner of (tx as TxApplyIf).txes) {
        await this.processTx(ctx, inner, changedGroups)
      }
      return
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return
    const cud = tx as TxCUD<Doc>
    const hierarchy = this.context.hierarchy
    if (hierarchy.isDerived(cud.objectClass, core.class.UserGroup)) {
      this.checkUserGroupTx(ctx, cud as TxCUD<UserGroup>)
      const touchesMembers =
        cud._class === core.class.TxRemoveDoc ||
        (cud._class === core.class.TxUpdateDoc &&
          touchesAttribute((cud as TxUpdateDoc<UserGroup>).operations as Record<string, any>, 'members'))
      if (touchesMembers) changedGroups.add(cud.objectId as Ref<UserGroup>)
      return
    }
    if (!hierarchy.isDerived(cud.objectClass, core.class.Space)) return

    if (cud._class === core.class.TxCreateDoc) {
      await this.processSpaceCreate(ctx, cud as TxCreateDoc<Space>)
    } else if (cud._class === core.class.TxUpdateDoc) {
      await this.processSpaceUpdate(ctx, cud as TxUpdateDoc<Space>)
    }
  }

  private async processSpaceCreate (ctx: MeasureContext<SessionData>, tx: TxCreateDoc<Space>): Promise<void> {
    const attributes = tx.attributes as Partial<Space>
    const groups = attributes.groups ?? []
    if (groups.length > 0) {
      this.checkGroupsBinding(ctx, tx.objectClass)
    }
    if (attributes.directMembers === undefined) {
      attributes.directMembers = [...(attributes.members ?? [])]
    }
    if (groups.length > 0) {
      // The space gets the members of its groups in the same write.
      attributes.members = computeSpaceMembers(attributes.directMembers, await this.findGroups(ctx, groups))
    }
  }

  /**
   * Turns writes of `members` into writes of `directMembers` and adds the resulting change of `members` to the same
   * update: access follows a change of direct members or groups in the same operation, and space security sees the
   * `members` change in the original tx. The recompute trigger then finds nothing left to do.
   */
  private async processSpaceUpdate (ctx: MeasureContext<SessionData>, tx: TxUpdateDoc<Space>): Promise<void> {
    const ops = tx.operations as Record<string, any>
    const touchesGroups = touchesAttribute(ops, 'groups')
    if (touchesGroups) {
      this.checkGroupsBinding(ctx, tx.objectClass)
    }
    normalizeMembershipOperations(ops, ['members', 'directMembers', 'groups'])

    // A write of `members` and a direct write of `directMembers` both change the direct members.
    const pushed = [...opValues(ops.$push?.members), ...opValues(ops.$push?.directMembers)]
    const pulled = [...opValues(ops.$pull?.members), ...opValues(ops.$pull?.directMembers)]
    const replaced: AccountUuid[] | undefined = Array.isArray(ops.members) ? ops.members : undefined
    const writtenDirect: AccountUuid[] | undefined = Array.isArray(ops.directMembers) ? ops.directMembers : undefined
    const touchesDirect = touchesAttribute(ops, 'members') || touchesAttribute(ops, 'directMembers')
    if (!touchesDirect && !touchesGroups) return

    removeOp(ops, '$push', 'members')
    removeOp(ops, '$pull', 'members')
    removeOp(ops, '$push', 'directMembers')
    removeOp(ops, '$pull', 'directMembers')
    delete ops.members
    delete ops.directMembers

    const space = (await this.findInternal(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 }))[0]
    if (space === undefined) {
      // Nothing to resolve against: keep the write of direct members, the update itself will fail.
      if (writtenDirect !== undefined) ops.directMembers = writtenDirect
      if (pushed.length > 0) addOp(ops, '$push', 'directMembers', pushed)
      if (pulled.length > 0) addOp(ops, '$pull', 'directMembers', pulled)
      return
    }

    const members = space.members ?? []
    // Not migrated: `members` is still the list of direct members.
    const migrated = space.directMembers !== undefined
    let direct: AccountUuid[] = writtenDirect ?? space.directMembers ?? [...members]
    if (replaced !== undefined) {
      // A full replacement is resolved against the stored space: what the client removed from `members` leaves
      // `directMembers`, what it added becomes direct. A member through a group is not made direct by it.
      const next = new Set(replaced)
      const removed = new Set(members.filter((it) => !next.has(it)))
      const added = replaced.filter((it) => !members.includes(it))
      direct = [...direct.filter((it) => !removed.has(it)), ...added]
    }
    const pulledSet = new Set(pulled)
    direct = Array.from(new Set([...direct.filter((it) => !pulledSet.has(it)), ...pushed]))

    if (writtenDirect === undefined && replaced === undefined && migrated) {
      // Plain $push / $pull: kept as operators, so concurrent joins and leaves do not overwrite each other.
      if (pushed.length > 0) addOp(ops, '$push', 'directMembers', pushed)
      if (pulled.length > 0) addOp(ops, '$pull', 'directMembers', pulled)
    } else if (touchesDirect || !migrated) {
      // The whole list. Also for a space that is not migrated yet: a $push would start `directMembers` from the
      // pushed accounts only.
      ops.directMembers = direct
    }

    const groups = applyArrayOps(space.groups ?? [], ops, 'groups')
    const target = computeSpaceMembers(direct, await this.findGroups(ctx, groups))
    const added = target.filter((it) => !members.includes(it))
    const targetSet = new Set(target)
    const removed = Array.from(new Set(members.filter((it) => !targetSet.has(it))))
    if (added.length > 0) addOp(ops, '$push', 'members', added)
    if (removed.length > 0) addOp(ops, '$pull', 'members', removed)
  }

  /**
   * A change of group members (or a removed group) changes `members` of every bound space. The recompute trigger
   * does it in the same operation; this checks the result and applies what is left, so a failed trigger does not
   * leave access behind silently: a failure here fails the request.
   */
  private async syncGroupSpaces (ctx: MeasureContext<SessionData>, changed: Set<Ref<UserGroup>>): Promise<void> {
    const spaces = new Map<Ref<Space>, Space>()
    for (const group of changed) {
      for (const space of await this.findInternal(ctx, core.class.Space, { groups: group as any })) {
        spaces.set(space._id, space)
      }
    }
    if (spaces.size === 0) return

    const groupIds = new Set<Ref<UserGroup>>()
    for (const space of spaces.values()) {
      for (const group of space.groups ?? []) groupIds.add(group)
    }
    const groups = new Map((await this.findGroups(ctx, Array.from(groupIds))).map((it) => [it._id, it]))

    const factory = new TxFactory(core.account.System, true)
    const result: Tx[] = []
    for (const space of spaces.values()) {
      const members = space.members ?? []
      const direct = space.directMembers ?? members
      const bound = (space.groups ?? []).filter((it) => groups.has(it))
      const target = computeSpaceMembers(
        direct,
        bound.map((it) => groups.get(it) as UserGroup)
      )
      const ops: Record<string, any> = {}
      if (space.directMembers === undefined) ops.directMembers = [...members]
      const added = target.filter((it) => !members.includes(it))
      const targetSet = new Set(target)
      const removed = Array.from(new Set(members.filter((it) => !targetSet.has(it))))
      const missing = (space.groups ?? []).filter((it) => !groups.has(it))
      if (added.length > 0) addOp(ops, '$push', 'members', added)
      if (removed.length > 0) addOp(ops, '$pull', 'members', removed)
      if (missing.length > 0) {
        ops.$pull = { ...(ops.$pull ?? {}), groups: missing.length === 1 ? missing[0] : { $in: missing } }
      }
      if (Object.keys(ops).length === 0) continue
      result.push(factory.createTxUpdateDoc(space._class, space.space, space._id, ops))
    }
    if (result.length === 0) return
    ctx.warn('space-membership: repaired members of spaces bound to changed groups', {
      spaces: result.map((it) => (it as TxUpdateDoc<Space>).objectId)
    })
    await this.applyDerived(ctx, result)
  }

  private async applyDerived (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<void> {
    const derived = this.context.derived
    if (derived === undefined) {
      await this.provideTx(ctx, txes)
      return
    }
    await derived.tx(ctx, txes)
  }

  private async findGroups (ctx: MeasureContext<SessionData>, groups: Array<Ref<UserGroup>>): Promise<UserGroup[]> {
    if (groups.length === 0) return []
    return await this.findInternal(ctx, core.class.UserGroup, { _id: { $in: groups } })
  }

  /**
   * Reads stored documents as the server does: below space security and without the database security of the
   * session, as triggers read. Membership is resolved for every bound space, also ones the user can not see.
   */
  private async findInternal<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    const data = ctx.contextData
    const previous = data?.isTriggerCtx
    if (data !== undefined) data.isTriggerCtx = true
    try {
      const target = this.context.derived ?? this.next
      if (target === undefined) return toFindResult([], 0)
      return await target.findAll(ctx, _class, query, options)
    } finally {
      if (data !== undefined) data.isTriggerCtx = previous
    }
  }

  private checkGroupsBinding (ctx: MeasureContext<SessionData>, _class: Ref<Class<Space>>): void {
    if (!canManageGroups(ctx)) {
      this.forbid(ctx, 'bind-groups-not-allowed', { _class })
    }
    if (!supportsUserGroups(this.context.hierarchy, _class)) {
      this.forbid(ctx, 'groups-not-supported-for-class', { _class })
    }
  }

  private checkUserGroupTx (ctx: MeasureContext<SessionData>, tx: TxCUD<UserGroup>): void {
    if (!canManageGroups(ctx)) {
      this.forbid(ctx, 'manage-groups-not-allowed', { _class: tx.objectClass })
    }
    let members: AccountUuid[] = []
    if (tx._class === core.class.TxCreateDoc) {
      members = (tx as TxCreateDoc<UserGroup>).attributes.members ?? []
    } else if (tx._class === core.class.TxUpdateDoc) {
      const ops = (tx as TxUpdateDoc<UserGroup>).operations as Record<string, any>
      normalizeMembershipOperations(ops, ['members'])
      members = [...(Array.isArray(ops.members) ? ops.members : []), ...opValues(ops.$push?.members)]
    }
    // Anonymous access is granted per space; a group would spread it to every bound space.
    if (members.includes(readOnlyGuestAccountUuid)) {
      throw new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, {}))
    }
  }

  private forbid (ctx: MeasureContext<SessionData>, reason: string, params: Record<string, any>): never {
    ctx.warn('space-membership: forbidden', { reason, account: ctx.contextData?.account?.uuid, ...params })
    throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
  }

  override async findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    // contextData is unset for internal calls.
    const account = ctx.contextData?.account
    if (account === undefined || !isGuestRole(account.role)) {
      return await this.provideFindAll(ctx, _class, query, options)
    }
    if (this.isUserGroup(_class)) {
      return toFindResult([], 0)
    }
    const result = await this.provideFindAll(ctx, _class, query, options)
    if (options?.lookup === undefined && options?.associations === undefined) {
      return result
    }
    const lookupMap =
      result.lookupMap !== undefined
        ? Object.fromEntries(Object.entries(result.lookupMap).filter(([, doc]) => !this.isUserGroup(doc._class)))
        : undefined
    return toFindResult(
      result.map((doc) => this.withoutUserGroups(doc)),
      result.total,
      lookupMap
    )
  }

  override async searchFulltext (
    ctx: MeasureContext<SessionData>,
    query: SearchQuery,
    options: SearchOptions
  ): Promise<SearchResult> {
    const result = await this.provideSearchFulltext(ctx, query, options)
    const account = ctx.contextData?.account
    if (account === undefined || !isGuestRole(account.role)) return result
    // Groups are not full-text indexed; documents indexed before that must not reach guests either.
    const docs = result.docs.filter((it) => !this.isUserGroup(it.doc._class))
    if (docs.length === result.docs.length) return result
    return {
      ...result,
      docs,
      total: result.total !== undefined ? result.total - (result.docs.length - docs.length) : undefined
    }
  }

  /** Copies the document without user groups in its lookups and associations, at any depth. */
  private withoutUserGroups<T extends Doc>(doc: WithLookup<T>): WithLookup<T> {
    if (doc.$lookup === undefined && doc.$associations === undefined) return doc
    const result = { ...doc }
    if (doc.$lookup !== undefined) {
      const lookup: Record<string, any> = {}
      for (const [key, value] of Object.entries(doc.$lookup as Record<string, any>)) {
        if (Array.isArray(value)) {
          lookup[key] = value
            .filter((it) => !this.isLookupUserGroup(it))
            .map((it) => (typeof it === 'object' && it !== null ? this.withoutUserGroups(it) : it))
        } else if (value !== undefined && !this.isLookupUserGroup(value)) {
          lookup[key] = typeof value === 'object' && value !== null ? this.withoutUserGroups(value) : value
        }
      }
      result.$lookup = lookup as any
    }
    if (doc.$associations !== undefined) {
      const associations: Record<string, Doc[]> = {}
      for (const [key, targets] of Object.entries(doc.$associations)) {
        associations[key] = targets.filter((it) => !this.isUserGroup(it._class)).map((it) => this.withoutUserGroups(it))
      }
      result.$associations = associations
    }
    return result
  }

  private isLookupUserGroup (value: unknown): boolean {
    return typeof value === 'object' && value !== null && this.isUserGroup((value as Doc)._class)
  }

  private isUserGroup (_class: Ref<Class<Doc>> | undefined): boolean {
    return _class !== undefined && this.context.hierarchy.isDerived(_class, core.class.UserGroup)
  }

  override async handleBroadcast (ctx: MeasureContext<SessionData>): Promise<void> {
    const broadcast = ctx.contextData?.broadcast
    if (broadcast !== undefined) {
      broadcast.targets.userGroups = async (tx) => {
        if (!TxProcessor.isExtendsCUD(tx._class) || !this.isUserGroup((tx as TxCUD<Doc>).objectClass)) {
          return undefined
        }
        const guests = new Set<AccountUuid>()
        for (const user of ctx.contextData.socialStringsToUsers.values()) {
          if (isGuestRole(user.role)) guests.add(user.accontUuid)
        }
        return guests.size > 0 ? { exclude: Array.from(guests) } : undefined
      }
    }
    await this.next?.handleBroadcast(ctx)
  }
}

function canManageGroups (ctx: MeasureContext<SessionData>): boolean {
  const data = ctx.contextData
  const account: Account | undefined = data?.account
  if (account === undefined) return true // internal call
  return (
    data.admin === true ||
    account.uuid === systemAccountUuid ||
    account.primarySocialId === core.account.System ||
    hasAccountRole(account, AccountRole.Maintainer)
  )
}

/** Normalize clearing an array; reject operators and dotted writes that bypass membership validation. */
function normalizeMembershipOperations (ops: Record<string, unknown>, fields: string[]): void {
  for (const field of fields) {
    if (!touchesAttribute(ops, field)) continue
    let unset = false
    let writes = 0
    for (const [key, value] of Object.entries(ops)) {
      if (key === field || key.startsWith(`${field}.`)) {
        if (key !== field || !Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
          throw new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, {}))
        }
        writes++
      } else if (key.startsWith('$') && typeof value === 'object' && value !== null) {
        for (const attribute of Object.keys(value)) {
          if (attribute !== field && !attribute.startsWith(`${field}.`)) continue
          if (attribute !== field || !['$push', '$pull', '$unset'].includes(key)) {
            throw new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, {}))
          }
          writes++
          if (key === '$unset') unset = true
        }
      }
    }
    if (unset) {
      if (writes !== 1) {
        throw new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, {}))
      }
      removeOp(ops, '$unset', field)
      ops[field] = []
    }
  }
}

function removeOp (ops: Record<string, any>, op: '$push' | '$pull' | '$unset', field: string): void {
  if (ops[op] === undefined) return
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete ops[op][field]
  if (Object.keys(ops[op]).length === 0) {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete ops[op]
  }
}

function addOp (ops: Record<string, any>, op: '$push' | '$pull', field: string, values: AccountUuid[]): void {
  const existing = opValues(ops[op]?.[field])
  const all = Array.from(new Set([...existing, ...values]))
  // Keep the single-value form of the original write when possible.
  const value = all.length === 1 ? all[0] : op === '$push' ? { $each: all, $position: 0 } : { $in: all }
  ops[op] = { ...(ops[op] ?? {}), [field]: value }
}

/** The array after the operations of an update on it: a full write, `$push` and `$pull`. */
function applyArrayOps<T extends string> (stored: T[], ops: Record<string, any>, field: string): T[] {
  let result: T[] = Array.isArray(ops[field]) ? [...ops[field]] : [...stored]
  const pulled = new Set(opValues(ops.$pull?.[field]) as string[])
  result = result.filter((it) => !pulled.has(it))
  for (const it of opValues(ops.$push?.[field]) as string[]) {
    if (!result.includes(it as T)) result.push(it as T)
  }
  return result
}
