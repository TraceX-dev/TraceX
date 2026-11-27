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
 * `Space.members` is computed by the server: `unique(directMembers ∪ members of groups)`. Clients write
 * `directMembers` and `groups`; the `OnSpaceMembershipChange` trigger recomputes `members` (and the roles of the
 * space) in the same operation.
 *
 * Clients and services that still write `members` keep working: this middleware turns those writes into writes of
 * `directMembers`, so a removed direct member keeps access through a group and a group member is not stored as a
 * direct one. Every such write is logged, to find the writers that are left before direct writes of `members` are
 * rejected.
 *
 * It must stay above SpaceSecurityMiddleware and the permission middlewares, so they see the rewritten update.
 *
 * Also guards user groups: only workspace maintainers and owners manage them and bind them to spaces. Groups live
 * in `core.space.UserGroups`, which space security hides from guests.
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
    for (const tx of txes) {
      await this.processTx(ctx, tx)
    }
    return await this.provideTx(ctx, txes)
  }

  private async processTx (ctx: MeasureContext<SessionData>, tx: Tx): Promise<void> {
    if (tx._class === core.class.TxApplyIf) {
      for (const inner of (tx as TxApplyIf).txes) {
        await this.processTx(ctx, inner)
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
      this.processSpaceCreate(ctx, cud as TxCreateDoc<Space>)
    } else if (cud._class === core.class.TxUpdateDoc) {
      await this.processSpaceUpdate(ctx, cud as TxUpdateDoc<Space>)
    }
  }

  /** The members given on creation are the direct members; the trigger adds the members of the groups. */
  private processSpaceCreate (ctx: MeasureContext<SessionData>, tx: TxCreateDoc<Space>): void {
    const attributes = tx.attributes as Partial<Space>
    if ((attributes.groups ?? []).length > 0) {
      this.checkGroupsBinding(ctx, tx.objectClass)
    }
    if (attributes.directMembers === undefined) {
      attributes.directMembers = [...(attributes.members ?? [])]
    }
  }

  /** Turns writes of `members` into writes of `directMembers`; the trigger recomputes `members`. */
  private async processSpaceUpdate (ctx: MeasureContext<SessionData>, tx: TxUpdateDoc<Space>): Promise<void> {
    const ops = tx.operations as Record<string, any>
    if (touchesAttribute(ops, 'groups')) {
      this.checkGroupsBinding(ctx, tx.objectClass)
    }
    normalizeMembershipOperations(ops, ['members', 'directMembers', 'groups'])
    if (!touchesAttribute(ops, 'members') && !touchesAttribute(ops, 'directMembers')) return

    if (touchesAttribute(ops, 'members')) {
      ctx.warn('space-membership: direct write of members', {
        account: ctx.contextData?.account?.uuid,
        _class: tx.objectClass,
        space: tx.objectId
      })
    }
    // `$push` / `$pull` of members are the same changes of the direct members.
    const pushed = opValues(ops.$push?.members)
    const pulled = opValues(ops.$pull?.members)
    const replaced: AccountUuid[] | undefined = Array.isArray(ops.members) ? ops.members : undefined
    removeOp(ops, '$push', 'members')
    removeOp(ops, '$pull', 'members')
    delete ops.members
    if (pushed.length > 0) addOp(ops, '$push', 'directMembers', pushed)
    if (pulled.length > 0) addOp(ops, '$pull', 'directMembers', pulled)
    if (Array.isArray(ops.directMembers)) ops.directMembers = Array.from(new Set(ops.directMembers))

    const directOperators = ops.$push?.directMembers !== undefined || ops.$pull?.directMembers !== undefined
    const mixed = Object.keys(ops).some(isOperatorKey) && Object.keys(ops).some((key) => !isOperatorKey(key))
    if (replaced === undefined && !directOperators && !mixed) return

    const space = (await this.findInternal(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 }))[0]
    if (space === undefined) return // Nothing to resolve against: the update itself fails.
    const members = space.members ?? []

    if (replaced !== undefined) {
      // A full replacement is resolved against the stored space: what the client removed from `members` leaves
      // `directMembers`, what it added becomes direct. A member through a group is not made direct by it.
      const next = new Set(replaced)
      const removed = new Set(members.filter((it) => !next.has(it)))
      const added = replaced.filter((it) => !members.includes(it))
      const base: AccountUuid[] = ops.directMembers ?? space.directMembers ?? [...members]
      const direct = applyArrayOps([...base.filter((it) => !removed.has(it)), ...added], ops, 'directMembers')
      removeOp(ops, '$push', 'directMembers')
      removeOp(ops, '$pull', 'directMembers')
      ops.directMembers = direct
    } else if (space.directMembers === undefined && directOperators) {
      // Not migrated yet: a $push would start `directMembers` from the pushed accounts only, and the recompute
      // would drop all other members. Write the whole list, computed from `members`.
      const direct = applyArrayOps(ops.directMembers ?? [...members], ops, 'directMembers')
      removeOp(ops, '$push', 'directMembers')
      removeOp(ops, '$pull', 'directMembers')
      ops.directMembers = direct
    }
    // The storage applies an update either as operators or as plain writes, never both (`isOperator`).
    moveOperatorsToPlain(ops, space)
  }

  /**
   * Reads the stored space as the server does: below space security and without the database security of the
   * session, as triggers read.
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
      throw new PlatformError(new Status(Severity.ERROR, platform.status.BadRequest, {}))
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
      const current: string[] = Array.isArray(ops[field])
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
