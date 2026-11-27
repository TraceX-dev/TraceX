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
  type MeasureContext,
  readOnlyGuestAccountUuid,
  type Ref,
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
  TxProcessor,
  type TxUpdateDoc,
  type UserGroup
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

function badRequest (): never {
  throw new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, {}))
}

function isStringArray (value: unknown): value is string[] {
  return Array.isArray(value) && value.every((it) => typeof it === 'string')
}

/**
 * Values of a `$push` / `$pull` of a membership array. Only the forms the client and the server write are accepted:
 * a single value, `$push` with `$each` (and `$position`), `$pull` with `$in`. Anything else is rejected instead of
 * being dropped silently.
 */
function opValues (value: ArrayOp | undefined, op: '$push' | '$pull'): AccountUuid[] {
  if (value === undefined) return []
  if (typeof value === 'string') return [value]
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value)
    if (op === '$push' && '$each' in value && isStringArray(value.$each)) {
      if (keys.every((key) => key === '$each' || key === '$position')) return value.$each
    }
    if (op === '$pull' && '$in' in value && isStringArray(value.$in) && keys.length === 1) {
      return value.$in
    }
  }
  badRequest()
}

/** The state of a space within one batch of transactions. */
interface BatchSpace {
  /** The stored space before the batch: what the client saw when it wrote a whole `members` list. */
  stored: Space
  /** Direct members after the updates of the batch processed so far. */
  direct: AccountUuid[]
}

/**
 * Space membership with user groups.
 *
 * `Space.members` is a server-computed field: `unique(directMembers ∪ members of groups)`. The recompute trigger
 * (`OnSpaceMembershipChange`) is the single place that writes it after a change of direct members, of bound groups or
 * of group members: it reads the stored documents after the whole batch is applied, and its derived `$push` / `$pull`
 * of `members` reach space security, caches and notifications as any change of members.
 *
 * This middleware only:
 * - turns writes of `members` by clients and services into writes of `directMembers`. Membership rules:
 *   - `$push` / `$pull` of `members` become `$push` / `$pull` of `directMembers`: an account added explicitly is a
 *     direct member, also when a group already gives it access, so it keeps access when the group is unbound;
 *   - a whole `members` list is resolved against the stored `members`: accounts removed from it leave
 *     `directMembers`, accounts added to it become direct. Accounts given by groups are not made direct by it,
 *     a whole list can not tell them apart from the ones the client added;
 *   - a write of `directMembers` sets the direct members as written;
 * - computes `members` of a created space, so the creator has access in the same operation;
 * - logs every direct write of `members`, to find the writers that are left before such writes are rejected;
 * - lets only workspace maintainers and owners manage user groups and bind them to spaces. Groups live in
 *   `core.space.UserGroups`, which space security hides from guests, so a group can be neither created elsewhere
 *   nor moved out of it.
 *
 * It must stay above SpaceSecurityMiddleware and the permission middlewares: they see the rewritten transactions.
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
    // Several updates of one space in a batch are resolved one after another, not each against the stored space.
    const batch = new Map<Ref<Space>, BatchSpace>()
    for (const tx of txes) {
      await this.processTx(ctx, tx, batch)
    }
    return await this.provideTx(ctx, txes)
  }

  private async processTx (ctx: MeasureContext<SessionData>, tx: Tx, batch: Map<Ref<Space>, BatchSpace>): Promise<void> {
    if (tx._class === core.class.TxApplyIf) {
      for (const inner of (tx as TxApplyIf).txes) {
        await this.processTx(ctx, inner, batch)
      }
      return
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return
    const cud = tx as TxCUD<Doc>
    const hierarchy = this.context.hierarchy
    if (hierarchy.isDerived(cud.objectClass, core.class.UserGroup)) {
      this.checkUserGroupTx(ctx, cud as TxCUD<UserGroup>)
      return
    }
    if (!hierarchy.isDerived(cud.objectClass, core.class.Space)) return

    if (cud._class === core.class.TxCreateDoc) {
      await this.processSpaceCreate(ctx, cud as TxCreateDoc<Space>, batch)
    } else if (cud._class === core.class.TxUpdateDoc) {
      await this.processSpaceUpdate(ctx, cud as TxUpdateDoc<Space>, batch)
    }
  }

  private async processSpaceCreate (
    ctx: MeasureContext<SessionData>,
    tx: TxCreateDoc<Space>,
    batch: Map<Ref<Space>, BatchSpace>
  ): Promise<void> {
    const attributes = tx.attributes as Partial<Space>
    const requested = attributes.groups ?? []
    if (!isStringArray(requested)) badRequest()
    if (requested.length > 0) {
      this.checkGroupsBinding(ctx, tx.objectClass)
    }
    const members = attributes.members ?? []
    const direct = attributes.directMembers ?? members
    if (!isStringArray(members) || !isStringArray(direct)) badRequest()

    const groups = await this.findGroups(ctx, Array.from(new Set(requested)))
    const found = new Set(groups.map((it) => it._id))
    const unknown = requested.filter((it) => !found.has(it))
    if (unknown.length > 0) {
      ctx.warn('space-membership: unknown groups dropped from a created space', { _class: tx.objectClass, unknown })
    }
    attributes.directMembers = Array.from(new Set(direct))
    // `members` is always derived from the sources: a client can not create a space with members it does not list.
    attributes.members = computeSpaceMembers(attributes.directMembers, groups)
    if (attributes.groups !== undefined) {
      attributes.groups = Array.from(new Set(requested.filter((it) => found.has(it))))
    }

    const stored: Partial<Space> = {
      ...attributes,
      _id: tx.objectId,
      _class: tx.objectClass,
      space: tx.objectSpace
    }
    batch.set(tx.objectId, { stored: stored as Space, direct: attributes.directMembers })
  }

  /**
   * Turns writes of `members` into writes of `directMembers`; the recompute trigger brings `members` to the result.
   */
  private async processSpaceUpdate (
    ctx: MeasureContext<SessionData>,
    tx: TxUpdateDoc<Space>,
    batch: Map<Ref<Space>, BatchSpace>
  ): Promise<void> {
    const ops = tx.operations as Record<string, any>
    const touchesGroups = touchesAttribute(ops, 'groups')
    if (touchesGroups) {
      this.checkGroupsBinding(ctx, tx.objectClass)
    }
    normalizeMembershipOperations(ops, ['members', 'directMembers', 'groups'])
    if (touchesGroups) {
      // Validated here, applied by the storage; the trigger resolves the groups.
      opValues(ops.$push?.groups as ArrayOp | undefined, '$push')
      opValues(ops.$pull?.groups as ArrayOp | undefined, '$pull')
    }
    if (!touchesAttribute(ops, 'members') && !touchesAttribute(ops, 'directMembers')) return
    if (touchesAttribute(ops, 'members')) {
      ctx.warn('space-membership: direct write of members', {
        account: ctx.contextData?.account?.uuid,
        _class: tx.objectClass,
        space: tx.objectId
      })
    }

    // A write of `members` and a direct write of `directMembers` both change the direct members.
    const pushed = [...opValues(ops.$push?.members, '$push'), ...opValues(ops.$push?.directMembers, '$push')]
    const pulled = [...opValues(ops.$pull?.members, '$pull'), ...opValues(ops.$pull?.directMembers, '$pull')]
    const replaced: AccountUuid[] | undefined = Array.isArray(ops.members) ? ops.members : undefined
    const writtenDirect: AccountUuid[] | undefined = Array.isArray(ops.directMembers) ? ops.directMembers : undefined

    removeOp(ops, '$push', 'members')
    removeOp(ops, '$pull', 'members')
    removeOp(ops, '$push', 'directMembers')
    removeOp(ops, '$pull', 'directMembers')
    delete ops.members
    delete ops.directMembers

    const state = await this.getBatchSpace(ctx, tx, batch)
    if (state === undefined) {
      // Nothing to resolve against: keep the write of direct members, the update itself will fail.
      if (writtenDirect !== undefined) ops.directMembers = Array.from(new Set(writtenDirect))
      if (pushed.length > 0) addOp(ops, '$push', 'directMembers', pushed)
      if (pulled.length > 0) addOp(ops, '$pull', 'directMembers', pulled)
      return
    }

    const storedMembers = state.stored.members ?? []
    const current: AccountUuid[] = state.direct
    let direct: AccountUuid[] = writtenDirect ?? current
    if (replaced !== undefined) {
      const next = new Set(replaced)
      const removed = new Set(storedMembers.filter((it) => !next.has(it)))
      const added = replaced.filter((it) => !storedMembers.includes(it))
      direct = [...direct.filter((it) => !removed.has(it)), ...added]
    }
    const pulledSet = new Set(pulled)
    direct = Array.from(new Set([...direct.filter((it) => !pulledSet.has(it)), ...pushed]))
    state.direct = direct

    // An update is applied either as operators or as plain field writes, never both (`isOperator`): the storage
    // takes an update with a plain field as plain writes and drops its `$push` / `$pull`. So the change keeps the
    // form of the update.
    const asOperators = writtenDirect === undefined && replaced === undefined && Object.keys(ops).every(isOperatorKey)
    if (asOperators) {
      // $push / $pull: concurrent joins and leaves do not overwrite each other. Accounts that are already direct
      // are not pushed again.
      const toPush = Array.from(new Set(pushed)).filter((it) => !current.includes(it))
      const toPull = Array.from(new Set(pulled)).filter((it) => !direct.includes(it))
      if (toPush.length > 0) addOp(ops, '$push', 'directMembers', toPush)
      if (toPull.length > 0) addOp(ops, '$pull', 'directMembers', toPull)
      return
    }
    // Whole list: a full write, or an update with other plain fields.
    ops.directMembers = direct
    moveOperatorsToPlain(ops, state.stored)
  }

  private async getBatchSpace (
    ctx: MeasureContext<SessionData>,
    tx: TxUpdateDoc<Space>,
    batch: Map<Ref<Space>, BatchSpace>
  ): Promise<BatchSpace | undefined> {
    const known = batch.get(tx.objectId)
    if (known !== undefined) return known
    const stored = (await this.findInternal(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 }))[0]
    if (stored === undefined) return undefined
    // Every space has directMembers: existing ones from the migration, created ones from this middleware or, for
    // spaces created by server code, from OnSpaceMembershipChange.
    const state: BatchSpace = { stored, direct: [...(stored.directMembers ?? [])] }
    batch.set(tx.objectId, state)
    return state
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
    // Only the space hidden from guests keeps groups from them: a group can be neither put elsewhere nor moved.
    if (
      tx.objectSpace !== core.space.UserGroups ||
      (tx._class === core.class.TxUpdateDoc && touchesAttribute((tx as TxUpdateDoc<UserGroup>).operations, 'space'))
    ) {
      badRequest()
    }
    let members: AccountUuid[] = []
    if (tx._class === core.class.TxCreateDoc) {
      const created = (tx as TxCreateDoc<UserGroup>).attributes.members ?? []
      if (!isStringArray(created)) badRequest()
      members = created
    } else if (tx._class === core.class.TxUpdateDoc) {
      const ops = (tx as TxUpdateDoc<UserGroup>).operations as Record<string, any>
      normalizeMembershipOperations(ops, ['members'])
      opValues(ops.$pull?.members, '$pull')
      members = [...(Array.isArray(ops.members) ? ops.members : []), ...opValues(ops.$push?.members, '$push')]
    }
    // Anonymous access is granted per space; a group would spread it to every bound space.
    if (members.includes(readOnlyGuestAccountUuid)) badRequest()
  }

  private forbid (ctx: MeasureContext<SessionData>, reason: string, params: Record<string, any>): never {
    ctx.warn('space-membership: forbidden', { reason, account: ctx.contextData?.account?.uuid, ...params })
    throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
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

/** Values of a `$push` / `$pull` as written, any element type: for fields this middleware does not validate. */
function rawOpValues (value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  if (typeof value !== 'object') return [value]
  if (Array.isArray((value as { $each?: unknown[] }).$each)) return (value as { $each: unknown[] }).$each
  if (Array.isArray((value as { $in?: unknown[] }).$in)) return (value as { $in: unknown[] }).$in
  return [value]
}

function addOp (ops: Record<string, any>, op: '$push' | '$pull', field: string, values: AccountUuid[]): void {
  const existing = rawOpValues(ops[op]?.[field]) as AccountUuid[]
  const all = Array.from(new Set([...existing, ...values]))
  // Keep the single-value form of the original write when possible.
  const value = all.length === 1 ? all[0] : op === '$push' ? { $each: all, $position: 0 } : { $in: all }
  ops[op] = { ...(ops[op] ?? {}), [field]: value }
}

/** The array after the operations of an update on it: a full write, `$push` and `$pull`. */
function applyArrayOps (stored: unknown[], ops: Record<string, any>, field: string): unknown[] {
  let result: unknown[] = Array.isArray(ops[field]) ? [...ops[field]] : [...stored]
  const pulled = new Set(rawOpValues(ops.$pull?.[field]))
  result = result.filter((it) => !pulled.has(it))
  for (const it of rawOpValues(ops.$push?.[field])) {
    if (!result.includes(it)) result.push(it)
  }
  return result
}

function isOperatorKey (key: string): boolean {
  return key.startsWith('$')
}

/**
 * An update that writes plain fields can not carry operators (see `isOperator`): `$push` / `$pull` of the update
 * are applied to the stored value and written as the whole array.
 */
function moveOperatorsToPlain (ops: Record<string, any>, stored: Record<string, any>): void {
  if (!Object.keys(ops).some((key) => !isOperatorKey(key))) return
  for (const op of ['$push', '$pull'] as const) {
    const fields = ops[op]
    if (fields === undefined || typeof fields !== 'object') continue
    for (const field of Object.keys(fields)) {
      const value = fields[field]
      const simple =
        typeof value === 'string' ||
        (typeof value === 'object' && value !== null && (Array.isArray(value.$each) || Array.isArray(value.$in)))
      if (!simple) continue
      const current: unknown[] = Array.isArray(ops[field])
        ? [...ops[field]]
        : Array.isArray(stored[field])
          ? [...stored[field]]
          : []
      ops[field] = applyArrayOps(current, { [op]: { [field]: value } }, field)
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete fields[field]
    }
    if (Object.keys(fields).length === 0) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete ops[op]
    }
  }
}
