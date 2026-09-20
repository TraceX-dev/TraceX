import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import core, {
  type Account,
  AccountRole,
  type Class,
  type CustomSequence,
  type Doc,
  type ClassPermission,
  type Permission,
  hasAccountRole,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
  TxProcessor,
  type TxUpdateDoc
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import contact, { type Person } from '@hcengineering/contact'

/** Cached state loaded from GuestPermissionsSettings configuration document. */
interface GuestPermissionsCache {
  roleAllowedClasses: Map<AccountRole, Set<Ref<Class<Doc>>>>
  rolePermissionPolicies: Map<AccountRole, GuestClassPermissionPolicy[]>
}

interface GuestClassPermissionPolicy {
  targetClass: Ref<Class<Doc>>
  relatedCreateClasses: Set<Ref<Class<Doc>>>
  followUpCreateClasses: Set<Ref<Class<Doc>>>
  sequenceNamespaces: Set<string>
}

export class GuestPermissionsMiddleware extends BaseMiddleware implements Middleware {
  private permissionsCache: GuestPermissionsCache | undefined = undefined
  private initPromise: Promise<void> | undefined = undefined

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<GuestPermissionsMiddleware> {
    return new GuestPermissionsMiddleware(context, next)
  }

  private async getPermissionsCache (ctx: MeasureContext): Promise<GuestPermissionsCache> {
    if (this.permissionsCache !== undefined) return this.permissionsCache
    if (this.initPromise === undefined) {
      this.initPromise = this.loadPermissionsCache(ctx)
    }
    await this.initPromise
    this.initPromise = undefined
    return this.permissionsCache ?? { roleAllowedClasses: new Map(), rolePermissionPolicies: new Map() }
  }

  private async loadPermissionsCache (ctx: MeasureContext): Promise<void> {
    try {
      const docs = await this.findAll(ctx, core.class.ModulePermissionGroup, {}, {})
      if (docs.length > 0) {
        const rolePermissions = new Map<AccountRole, Set<Ref<Permission>>>()
        const allPermissionIds = new Set<Ref<Permission>>()
        for (const group of docs as any[]) {
          if (group.enabled === false) continue
          const role =
            (group.role as AccountRole | undefined) ??
            (Array.isArray(group.roles) && group.roles.length > 0 ? (group.roles[0] as AccountRole) : undefined) ??
            AccountRole.Guest
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
            ? await this.findAll(ctx, core.class.ClassPermission, {
                _id: { $in: Array.from(allPermissionIds) as Ref<ClassPermission>[] }
              })
            : []
        const permissionToClass = new Map<Ref<Permission>, Ref<Class<Doc>>>(
          classPermissions
            .map(
              (permission) => [permission._id as Ref<Permission>, (permission as ClassPermission).targetClass] as const
            )
            .filter((entry): entry is readonly [Ref<Permission>, Ref<Class<Doc>>] => entry[1] !== undefined)
        )
        const roleAllowedClasses = new Map<AccountRole, Set<Ref<Class<Doc>>>>()
        const rolePermissionPolicies = new Map<AccountRole, GuestClassPermissionPolicy[]>()
        for (const [role, permissions] of rolePermissions.entries()) {
          const allowedClasses = new Set<Ref<Class<Doc>>>()
          const policies: GuestClassPermissionPolicy[] = []
          for (const permissionId of permissions) {
            const targetClass = permissionToClass.get(permissionId)
            if (targetClass === undefined) continue
            allowedClasses.add(targetClass)
            const permission = classPermissions.find((item) => item._id === permissionId)
            policies.push({
              targetClass,
              relatedCreateClasses: new Set(permission?.relatedCreateClasses ?? []),
              followUpCreateClasses: new Set(permission?.followUpCreateClasses ?? []),
              sequenceNamespaces: new Set(permission?.sequenceNamespaces ?? [])
            })
          }
          roleAllowedClasses.set(role, allowedClasses)
          rolePermissionPolicies.set(role, policies)
        }
        this.permissionsCache = { roleAllowedClasses, rolePermissionPolicies }
      } else {
        this.permissionsCache = { roleAllowedClasses: new Map(), rolePermissionPolicies: new Map() }
      }
    } catch {
      this.permissionsCache = { roleAllowedClasses: new Map(), rolePermissionPolicies: new Map() }
    }
  }

  private invalidateCacheIfNeeded (txes: Tx[]): void {
    for (const tx of txes) {
      if (TxProcessor.isExtendsCUD(tx._class)) {
        const cudTx = tx as TxCUD<Doc>
        if (
          cudTx.objectClass === core.class.ModulePermissionGroup ||
          cudTx.objectClass === core.class.ClassPermission
        ) {
          this.permissionsCache = undefined
          return
        }
      }
    }
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const account = ctx.contextData.account
    if (hasAccountRole(account, AccountRole.User)) {
      this.invalidateCacheIfNeeded(txes)
      return await this.provideTx(ctx, txes)
    }

    if (account.role === AccountRole.DocGuest || account.role === AccountRole.ReadOnlyGuest) {
      for (const tx of txes) {
        this.logForbiddenTx(ctx, account, tx, 'role-forbids-transactions')
      }
      throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
    }

    for (const tx of txes) {
      await this.processTx(ctx, tx)
    }

    return await this.provideTx(ctx, txes)
  }

  private async processTx (
    ctx: MeasureContext<SessionData>,
    tx: Tx,
    relatedCreateClasses = new Set<Ref<Class<Doc>>>()
  ): Promise<void> {
    const h = this.context.hierarchy
    if (tx._class === core.class.TxApplyIf) {
      const applyTx = tx as TxApplyIf
      const applyRelatedCreateClasses = new Set(relatedCreateClasses)
      for (const relatedClass of await this.getApplyRelatedCreateClasses(ctx, applyTx)) {
        applyRelatedCreateClasses.add(relatedClass)
      }
      for (const t of applyTx.txes) {
        await this.processTx(ctx, t, applyRelatedCreateClasses)
      }
      return
    }
    if (TxProcessor.isExtendsCUD(tx._class)) {
      const { account } = ctx.contextData
      const cudTx = tx as TxCUD<Doc>
      const isSpace = h.isDerived(cudTx.objectClass, core.class.Space)
      if (isSpace) {
        if (await this.isForbiddenSpaceTx(ctx, cudTx as TxCUD<Space>, account)) {
          this.logForbiddenTx(ctx, account, tx, 'space-access-not-granted')
          throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
        }
      } else if (
        cudTx.space !== core.space.DerivedTx &&
        (await this.isForbiddenTx(ctx, cudTx, account, relatedCreateClasses))
      ) {
        this.logForbiddenTx(ctx, account, tx, 'document-access-not-granted')
        throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      }
    }
  }

  private getNestedTxes (tx: Tx): Tx[] {
    if (tx._class !== core.class.TxApplyIf) return [tx]
    return (tx as TxApplyIf).txes.flatMap((nested) => this.getNestedTxes(nested))
  }

  private async getApplyRelatedCreateClasses (
    ctx: MeasureContext<SessionData>,
    applyTx: TxApplyIf
  ): Promise<Set<Ref<Class<Doc>>>> {
    const cache = await this.getPermissionsCache(ctx)
    const policies = cache.rolePermissionPolicies.get(ctx.contextData.account.role) ?? []
    const createTxes = this.getNestedTxes(applyTx).filter(
      (tx): tx is TxCreateDoc<Doc> => tx._class === core.class.TxCreateDoc
    )
    const result = new Set<Ref<Class<Doc>>>()
    for (const policy of policies) {
      if (createTxes.some((tx) => this.context.hierarchy.isDerived(tx.objectClass, policy.targetClass))) {
        for (const relatedClass of policy.relatedCreateClasses) result.add(relatedClass)
      }
    }
    return result
  }

  private logForbiddenTx (ctx: MeasureContext, account: Account, tx: Tx, reason: string): void {
    ctx.warn('Guest transaction rejected', {
      reason,
      accountRole: account.role,
      objectClass: TxProcessor.isExtendsCUD(tx._class) ? (tx as TxCUD<Doc>).objectClass : tx._class
    })
  }

  /**
   * Returns the covered-class ancestor of the objectClass if one exists in the new permissions model,
   * or undefined if the class is not covered.
   */
  private getCoveredClass (
    objectClass: Ref<Class<Doc>>,
    allowedClasses: Set<Ref<Class<Doc>>>
  ): Ref<Class<Doc>> | undefined {
    if (allowedClasses.size === 0) return undefined
    const h = this.context.hierarchy
    for (const coveredClass of allowedClasses) {
      if (h.isDerived(objectClass, coveredClass)) {
        return coveredClass
      }
    }
    return undefined
  }

  private isCreatedByAccount (doc: Doc, account: Account): boolean {
    const creator = doc.createdBy
    if (creator === undefined) return false
    if (creator === account.primarySocialId) return true
    return account.socialIds.includes(creator)
  }

  private async isGuestMutationOnOwnDoc (ctx: MeasureContext, tx: TxCUD<Doc>, account: Account): Promise<boolean> {
    if (tx._class !== core.class.TxUpdateDoc && tx._class !== core.class.TxRemoveDoc) return false
    const docs = await this.findAll(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 })
    const doc = docs[0] as Doc | undefined
    if (doc === undefined) return false
    return this.isCreatedByAccount(doc, account)
  }

  private async isGuestCreateOnOwnDoc (ctx: MeasureContext, tx: TxCreateDoc<Doc>, account: Account): Promise<boolean> {
    const attributes = tx.attributes as { attachedTo?: Ref<Doc>, attachedToClass?: Ref<Class<Doc>> }
    const attachedTo = tx.attachedTo ?? attributes.attachedTo
    const attachedToClass = tx.attachedToClass ?? attributes.attachedToClass
    if (attachedTo === undefined || attachedToClass === undefined) return false

    const parents = await this.findAll(ctx, attachedToClass, { _id: attachedTo }, { limit: 1 })
    const parent = parents[0] as Doc | undefined
    return parent !== undefined && this.isCreatedByAccount(parent, account)
  }

  private async isForbiddenTx (
    ctx: MeasureContext,
    tx: TxCUD<Doc>,
    account: Account,
    relatedCreateClasses: Set<Ref<Class<Doc>>>
  ): Promise<boolean> {
    if (tx._class === core.class.TxMixin) return false

    const cache = await this.getPermissionsCache(ctx)
    const policies = cache.rolePermissionPolicies.get(account.role) ?? []

    if (await this.isAllowedSequenceTx(ctx, tx, policies)) return false

    // For TxCreateDoc, check the new permission model first for covered types.
    if (tx._class === core.class.TxCreateDoc) {
      const roleAllowedClasses = cache.roleAllowedClasses.get(account.role) ?? new Set<Ref<Class<Doc>>>()
      const coveredClass = this.getCoveredClass(tx.objectClass, roleAllowedClasses)
      const isRelatedCreate = this.getCoveredClass(tx.objectClass, relatedCreateClasses) !== undefined
      const isFollowUpCreate = policies.some(
        (policy) => this.getCoveredClass(tx.objectClass, policy.followUpCreateClasses) !== undefined
      )
      if (coveredClass !== undefined || isRelatedCreate || isFollowUpCreate) {
        return false
      }
      if (await this.isGuestCreateOnOwnDoc(ctx, tx as TxCreateDoc<Doc>, account)) return false
      // Uncovered class: fall through to TxAccessLevel check.
    }

    if (await this.hasMixinAccessLevel(ctx, tx, account)) {
      return false
    }

    if (tx._class === core.class.TxUpdateDoc || tx._class === core.class.TxRemoveDoc) {
      if (await this.isGuestMutationOnOwnDoc(ctx, tx, account)) {
        return false
      }
    }

    return true
  }

  private async isAllowedSequenceTx (
    ctx: MeasureContext,
    tx: TxCUD<Doc>,
    policies: GuestClassPermissionPolicy[]
  ): Promise<boolean> {
    if (tx.objectClass !== core.class.CustomSequence) return false
    const namespaces = new Set(policies.flatMap((policy) => Array.from(policy.sequenceNamespaces)))
    if (namespaces.size === 0) return false

    if (tx._class === core.class.TxCreateDoc) {
      const namespace = (tx as TxCreateDoc<CustomSequence>).attributes.namespace
      return namespace !== undefined && namespaces.has(namespace)
    }
    if (tx._class !== core.class.TxUpdateDoc) return false

    const operations = (tx as TxUpdateDoc<CustomSequence>).operations as Record<string, unknown>
    if (Object.keys(operations).length !== 1) return false
    const increment = operations.$inc as Record<string, unknown> | undefined
    if (
      increment === undefined ||
      Object.keys(increment).length !== 1 ||
      typeof increment.sequence !== 'number' ||
      !Number.isSafeInteger(increment.sequence) ||
      increment.sequence <= 0
    ) {
      return false
    }

    const sequences = await this.findAll(
      ctx,
      core.class.CustomSequence,
      { _id: tx.objectId as Ref<CustomSequence> },
      { limit: 1 }
    )
    const sequence = sequences[0] as CustomSequence | undefined
    return sequence !== undefined && namespaces.has(sequence.namespace ?? '')
  }

  private async isForbiddenSpaceTx (ctx: MeasureContext, tx: TxCUD<Space>, account: Account): Promise<boolean> {
    if (tx._class === core.class.TxRemoveDoc) return true
    if (tx._class === core.class.TxCreateDoc) {
      return !(await this.hasMixinAccessLevel(ctx, tx, account))
    }
    if (tx._class === core.class.TxUpdateDoc) {
      const updateTx = tx as TxUpdateDoc<Space>
      const ops = updateTx.operations
      const keys = ['members', 'private', 'archived', 'owners', 'autoJoin']
      if (keys.some((key) => (ops as any)[key] !== undefined)) {
        return true
      }
      if (ops.$push !== undefined || ops.$pull !== undefined) {
        return true
      }
    }
    return false
  }

  private async hasMixinAccessLevel (ctx: MeasureContext, tx: TxCUD<Doc>, account: Account): Promise<boolean> {
    const h = this.context.hierarchy
    const accessLevelMixin = h.classHierarchyMixin(tx.objectClass, core.mixin.TxAccessLevel)
    if (accessLevelMixin === undefined) return false
    if (tx._class === core.class.TxCreateDoc) {
      return (
        accessLevelMixin.createAccessLevel !== undefined && hasAccountRole(account, accessLevelMixin.createAccessLevel)
      )
    }
    if (tx._class === core.class.TxRemoveDoc) {
      return (
        accessLevelMixin.removeAccessLevel !== undefined && hasAccountRole(account, accessLevelMixin.removeAccessLevel)
      )
    }
    if (tx._class === core.class.TxUpdateDoc) {
      if (accessLevelMixin.isIdentity === true && account.socialIds.includes(tx.objectId as unknown as PersonId)) {
        return true
      }
      if (accessLevelMixin.isIdentity === true && h.isDerived(tx.objectClass, contact.class.Person)) {
        const person = (await this.findAll(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 }))[0] as
          Person | undefined
        return person?.personUuid === account.uuid
      }
      return (
        accessLevelMixin.updateAccessLevel !== undefined && hasAccountRole(account, accessLevelMixin.updateAccessLevel)
      )
    }
    return false
  }
}
