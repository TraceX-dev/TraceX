//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

/**
 * Layer 1 write-side gate (see `docs/security-model.md`): which classes/tx kinds a role may reach
 * at all. Consolidates the two existing sources - admin-configured
 * `ModulePermissionGroup`/`ClassPermission` docs, and the code-declared per-class minimum role
 * (`core.mixin.TxAccessLevel`) - behind one resolver, used by `GuestPermissionsMiddleware`.
 *
 * Role-parameterized throughout (not hardcoded to `AccountRole.Guest`): restricted roles are
 * checked against the minimum role declared by each class, while `User` and higher roles bypass
 * this gate.
 */
import core, {
  type Account,
  AccountRole,
  type Class,
  type ClassPermission,
  type Doc,
  type Hierarchy,
  hasAccountRole,
  type MeasureContext,
  type Permission,
  type PersonId,
  type Ref,
  type Tx,
  type TxCUD
} from '@hcengineering/core'
import type { Middleware } from '@hcengineering/server-core'
import contact, { type Person } from '@hcengineering/contact'

/**
 * Admin-configured (`ModulePermissionGroup`/`ClassPermission`) per-role allowed-class cache, keyed
 * by the `Tx` kind the permission covers (`ClassPermission.txClass`, defaulting to `TxCreateDoc`
 * for the common "may create this class" case - preserving every existing untyped registration).
 */
export class ClassAccessResolver {
  private cache: Map<AccountRole, Map<Ref<Class<Tx>>, Set<Ref<Class<Doc>>>>> | undefined
  private loading: Promise<void> | undefined

  constructor (private readonly next: Middleware | undefined) {}

  invalidate (): void {
    this.cache = undefined
  }

  async allowedClasses (ctx: MeasureContext, role: AccountRole, txClass: Ref<Class<Tx>>): Promise<Set<Ref<Class<Doc>>>> {
    const cache = await this.ensureLoaded(ctx)
    return cache.get(role)?.get(txClass) ?? new Set()
  }

  async allowedCreateClasses (ctx: MeasureContext, role: AccountRole): Promise<Set<Ref<Class<Doc>>>> {
    return await this.allowedClasses(ctx, role, core.class.TxCreateDoc)
  }

  private async ensureLoaded (
    ctx: MeasureContext
  ): Promise<Map<AccountRole, Map<Ref<Class<Tx>>, Set<Ref<Class<Doc>>>>>> {
    if (this.cache !== undefined) return this.cache
    if (this.loading === undefined) {
      this.loading = this.load(ctx)
    }
    await this.loading
    this.loading = undefined
    return this.cache ?? new Map()
  }

  private async load (ctx: MeasureContext): Promise<void> {
    try {
      const docs = ((await this.next?.findAll(ctx, core.class.ModulePermissionGroup, {}, {})) ?? []) as any[]
      const rolePermissions = new Map<AccountRole, Set<Ref<Permission>>>()
      const allPermissionIds = new Set<Ref<Permission>>()
      for (const group of docs) {
        if (group.enabled === false) continue
        // `roles` (plural) is a legacy shape from before GuestPermissionsSettings had a single `role`.
        const role = ((group.role as AccountRole | undefined) ??
          (Array.isArray(group.roles) && group.roles.length > 0 ? (group.roles[0] as AccountRole) : undefined) ??
          AccountRole.Guest) as AccountRole
        const permissions = (group.permissions ?? []) as Ref<Permission>[]
        const disabled = new Set<Ref<Permission>>((group.disabledPermissions ?? []) as Ref<Permission>[])
        const current = rolePermissions.get(role) ?? new Set<Ref<Permission>>()
        for (const permissionId of permissions) {
          if (disabled.has(permissionId)) continue
          current.add(permissionId)
          allPermissionIds.add(permissionId)
        }
        rolePermissions.set(role, current)
      }
      const classPermissions =
        allPermissionIds.size > 0
          ? await this.next?.findAll(
            ctx,
            core.class.ClassPermission as Ref<Class<Doc>>,
            {
              _id: { $in: Array.from(allPermissionIds) }
            } as any
          )
          : []
      const permissionInfo = new Map<Ref<Permission>, { targetClass: Ref<Class<Doc>>, txClasses: Ref<Class<Tx>>[] }>(
        ((classPermissions ?? []) as ClassPermission[])
          .filter(
            (permission): permission is ClassPermission & { targetClass: Ref<Class<Doc>> } =>
              permission.targetClass !== undefined
          )
          .map((permission) => [
            permission._id,
            {
              targetClass: permission.targetClass,
              txClasses: permission.txClasses ?? [permission.txClass ?? core.class.TxCreateDoc]
            }
          ])
      )
      const roleAllowedClasses = new Map<AccountRole, Map<Ref<Class<Tx>>, Set<Ref<Class<Doc>>>>>()
      for (const [role, permissions] of rolePermissions.entries()) {
        const byTxClass = new Map<Ref<Class<Tx>>, Set<Ref<Class<Doc>>>>()
        for (const permissionId of permissions) {
          const info = permissionInfo.get(permissionId)
          if (info === undefined) continue
          for (const txClass of info.txClasses) {
            const targetClasses = byTxClass.get(txClass) ?? new Set<Ref<Class<Doc>>>()
            targetClasses.add(info.targetClass)
            byTxClass.set(txClass, targetClasses)
          }
        }
        roleAllowedClasses.set(role, byTxClass)
      }
      this.cache = roleAllowedClasses
    } catch {
      this.cache = new Map()
    }
  }
}

function coveredClass (
  hierarchy: Hierarchy,
  objectClass: Ref<Class<Doc>>,
  allowedClasses: Set<Ref<Class<Doc>>>
): Ref<Class<Doc>> | undefined {
  for (const candidate of allowedClasses) {
    if (hierarchy.isDerived(objectClass, candidate)) return candidate
  }
  return undefined
}

/** Whether `tx`'s class grants `account` at least the role required by `core.mixin.TxAccessLevel`. */
export async function hasClassAccessLevel (
  hierarchy: Hierarchy,
  next: Middleware | undefined,
  ctx: MeasureContext,
  tx: TxCUD<Doc>,
  account: Account
): Promise<boolean> {
  const mixin = hierarchy.classHierarchyMixin(tx.objectClass, core.mixin.TxAccessLevel)
  if (mixin === undefined) return false
  if (tx._class === core.class.TxCreateDoc) {
    return mixin.createAccessLevel !== undefined && hasAccountRole(account, mixin.createAccessLevel)
  }
  if (tx._class === core.class.TxRemoveDoc) {
    return mixin.removeAccessLevel !== undefined && hasAccountRole(account, mixin.removeAccessLevel)
  }
  if (tx._class === core.class.TxUpdateDoc || tx._class === core.class.TxMixin) {
    if (mixin.isIdentity === true && account.socialIds.includes(tx.objectId as unknown as PersonId)) {
      return true
    }
    if (mixin.isIdentity === true && hierarchy.isDerived(tx.objectClass, contact.class.Person)) {
      const person = ((await next?.findAll(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 })) ?? [])[0] as
        | Person
        | undefined
      return person?.personUuid === account.uuid
    }
    return mixin.updateAccessLevel !== undefined && hasAccountRole(account, mixin.updateAccessLevel)
  }
  return false
}

/**
 * Whether `account`'s role may apply `tx` to a non-`Space` class at all (Layer 1), combining the
 * admin-configured allow-list with the code-declared `TxAccessLevel` fallback. Does not consider
 * ownership of the target document - callers layer declared `RowVisibility` policies on top.
 */
export async function isClassAccessAllowed (
  hierarchy: Hierarchy,
  next: Middleware | undefined,
  classAccess: ClassAccessResolver,
  ctx: MeasureContext,
  tx: TxCUD<Doc>,
  account: Account
): Promise<boolean> {
  if (hasAccountRole(account, AccountRole.User)) return true

  const allowed = await classAccess.allowedClasses(ctx, account.role, tx._class)
  if (coveredClass(hierarchy, tx.objectClass, allowed) !== undefined) return true

  return await hasClassAccessLevel(hierarchy, next, ctx, tx, account)
}
