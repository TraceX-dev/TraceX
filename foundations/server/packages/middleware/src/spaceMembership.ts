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
  isGuestRole,
  type MeasureContext,
  readOnlyGuestAccountUuid,
  type Ref,
  type SessionData,
  type Space,
  systemAccountUuid,
  toFindResult,
  touchesAttribute,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
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

// Spelled out: the core middleware does not depend on the chunter plugin.
const CHANNEL = 'chunter:class:Channel' as Ref<Class<Space>>

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
 * `Space.members` becomes a server-computed field: `unique(directMembers ∪ members of groups)`, recomputed by a
 * trigger. Clients and services keep writing `members`; this middleware turns those writes into writes of
 * `directMembers`, so a removed direct member keeps access through a group and a group member is not stored as
 * a direct one.
 *
 * It must stay above SpaceSecurityMiddleware and the permission middlewares: they then see `directMembers` writes
 * only, and learn the new `members` from the derived tx of the recompute, as for any other derived change.
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

  private processSpaceCreate (ctx: MeasureContext<SessionData>, tx: TxCreateDoc<Space>): void {
    const attributes = tx.attributes as Partial<Space>
    if ((attributes.groups ?? []).length > 0) {
      this.checkGroupsBinding(ctx, tx.objectClass)
    }
    if (attributes.directMembers === undefined) {
      attributes.directMembers = [...(attributes.members ?? [])]
    }
  }

  private async processSpaceUpdate (ctx: MeasureContext<SessionData>, tx: TxUpdateDoc<Space>): Promise<void> {
    const ops = tx.operations as Record<string, any>
    if (touchesAttribute(ops, 'groups')) {
      this.checkGroupsBinding(ctx, tx.objectClass)
    }
    normalizeMembershipOperations(ops, ['members', 'directMembers', 'groups'])

    // A write of `members` and a direct write of `directMembers` both change the direct members.
    const pushed = [...opValues(ops.$push?.members), ...opValues(ops.$push?.directMembers)]
    const pulled = [...opValues(ops.$pull?.members), ...opValues(ops.$pull?.directMembers)]
    const replaced: AccountUuid[] | undefined = Array.isArray(ops.members) ? ops.members : undefined
    const touchesDirect =
      ops.$push?.directMembers !== undefined || ops.$pull?.directMembers !== undefined || ops.directMembers !== undefined
    if (ops.$push?.members === undefined && ops.$pull?.members === undefined && replaced === undefined && !touchesDirect) {
      return
    }

    removeOp(ops, '$push', 'members')
    removeOp(ops, '$pull', 'members')
    removeOp(ops, '$push', 'directMembers')
    removeOp(ops, '$pull', 'directMembers')
    delete ops.members

    const space = (await this.provideFindAll(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 }))[0]
    // A space without `directMembers` (not migrated, or created around the middleware) can not take a $push or
    // $pull of it: the field would start from the pushed accounts only and the recompute would drop all other
    // members. It gets the whole list, computed from `members`, as a full replacement does.
    const migrated = space === undefined || space.directMembers !== undefined
    if (replaced === undefined && ops.directMembers === undefined && migrated) {
      if (pushed.length > 0) addOp(ops, '$push', 'directMembers', pushed)
      if (pulled.length > 0) addOp(ops, '$pull', 'directMembers', pulled)
      return
    }

    // A full replacement (or a mix with a direct `directMembers` write) is resolved against the stored space:
    // what the client removed from `members` leaves `directMembers`, what it added becomes direct.
    const members = space?.members ?? []
    let direct: AccountUuid[] = Array.isArray(ops.directMembers)
      ? ops.directMembers
      : (space?.directMembers ?? [...members])
    if (replaced !== undefined) {
      const next = new Set(replaced)
      const removed = new Set(members.filter((it) => !next.has(it)))
      const added = replaced.filter((it) => !members.includes(it))
      direct = [...direct.filter((it) => !removed.has(it)), ...added]
    }
    const pulledSet = new Set(pulled)
    direct = [...direct.filter((it) => !pulledSet.has(it)), ...pushed]
    ops.directMembers = Array.from(new Set(direct))
  }

  private checkGroupsBinding (ctx: MeasureContext<SessionData>, _class: Ref<Class<Space>>): void {
    if (!canManageGroups(ctx)) {
      this.forbid(ctx, 'bind-groups-not-allowed', { _class })
    }
    const hierarchy = this.context.hierarchy
    if (!hierarchy.isDerived(_class, core.class.TypedSpace) && !hierarchy.isDerived(_class, CHANNEL)) {
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
