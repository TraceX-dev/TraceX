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
  getRoleEffectivePermissions,
  type ModulePermissionGroup,
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
  sequenceNamespaces: Set<string>
}

/**
 * Classes a guest may additionally create inside a TxApplyIf, keyed by the space
 * of the permitted target document created in the same apply.
 */
type RelatedCreateScope = Map<Ref<Space>, Set<Ref<Class<Doc>>>>

/** The only increment a guest may apply to a permitted CustomSequence. */
const GUEST_SEQUENCE_STEP = 1

function emptyPermissionsCache (): GuestPermissionsCache {
  return { roleAllowedClasses: new Map(), rolePermissionPolicies: new Map() }
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
    return this.permissionsCache ?? emptyPermissionsCache()
  }

  private async loadPermissionsCache (ctx: MeasureContext): Promise<void> {
    try {
      const groups = (await this.findAll(ctx, core.class.ModulePermissionGroup, {}, {})) as ModulePermissionGroup[]
      if (groups.length === 0) {
        this.permissionsCache = emptyPermissionsCache()
        return
      }
      const rolePermissions = getRoleEffectivePermissions(groups)
      const allPermissionIds = new Set<Ref<Permission>>()
      for (const permissions of rolePermissions.values()) {
        for (const permissionId of permissions) allPermissionIds.add(permissionId)
      }
      const classPermissions =
        allPermissionIds.size > 0
          ? ((await this.findAll(ctx, core.class.ClassPermission, {
              _id: { $in: Array.from(allPermissionIds) as Ref<ClassPermission>[] }
            })) as ClassPermission[])
          : []
      const permissionsById = new Map<Ref<Permission>, ClassPermission>(
        classPermissions
          .filter((permission) => permission.targetClass !== undefined)
          .map((permission) => [permission._id as Ref<Permission>, permission] as const)
      )
      const roleAllowedClasses = new Map<AccountRole, Set<Ref<Class<Doc>>>>()
      const rolePermissionPolicies = new Map<AccountRole, GuestClassPermissionPolicy[]>()
      for (const [role, permissions] of rolePermissions.entries()) {
        const allowedClasses = new Set<Ref<Class<Doc>>>()
        const policies: GuestClassPermissionPolicy[] = []
        for (const permissionId of permissions) {
          const permission = permissionsById.get(permissionId)
          if (permission === undefined) continue
          allowedClasses.add(permission.targetClass)
          policies.push({
            targetClass: permission.targetClass,
            relatedCreateClasses: new Set(permission.relatedCreateClasses ?? []),
            sequenceNamespaces: new Set(permission.sequenceNamespaces ?? [])
          })
        }
        roleAllowedClasses.set(role, allowedClasses)
        rolePermissionPolicies.set(role, policies)
      }
      this.permissionsCache = { roleAllowedClasses, rolePermissionPolicies }
    } catch (err: unknown) {
      ctx.error('Failed to load guest permissions', { err })
      this.permissionsCache = emptyPermissionsCache()
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
    relatedCreates: RelatedCreateScope = new Map()
  ): Promise<void> {
    const h = this.context.hierarchy
    if (tx._class === core.class.TxApplyIf) {
      const applyTx = tx as TxApplyIf
      const applyRelatedCreates = await this.getApplyRelatedCreates(ctx, applyTx, relatedCreates)
      for (const t of applyTx.txes) {
        await this.processTx(ctx, t, applyRelatedCreates)
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
        (await this.isForbiddenTx(ctx, cudTx, account, relatedCreates))
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

  /**
   * Related classes of a policy are unlocked only in the spaces where the same apply
   * creates a document of the policy target class.
   */
  private async getApplyRelatedCreates (
    ctx: MeasureContext<SessionData>,
    applyTx: TxApplyIf,
    inherited: RelatedCreateScope
  ): Promise<RelatedCreateScope> {
    const result: RelatedCreateScope = new Map(
      Array.from(inherited.entries()).map(([space, classes]) => [space, new Set(classes)])
    )
    const cache = await this.getPermissionsCache(ctx)
    const policies = cache.rolePermissionPolicies.get(ctx.contextData.account.role) ?? []
    if (policies.length === 0) return result

    const createTxes = this.getNestedTxes(applyTx).filter(
      (tx): tx is TxCreateDoc<Doc> => tx._class === core.class.TxCreateDoc
    )
    for (const tx of createTxes) {
      for (const policy of policies) {
        if (!this.context.hierarchy.isDerived(tx.objectClass, policy.targetClass)) continue
        const classes = result.get(tx.objectSpace) ?? new Set<Ref<Class<Doc>>>()
        for (const relatedClass of policy.relatedCreateClasses) classes.add(relatedClass)
        result.set(tx.objectSpace, classes)
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

  /**
   * Allows a guest to attach a related class of a policy to a document it created itself,
   * when that parent belongs to the same policy (its target class or one of its related classes)
   * and lives in the same space.
   */
  private async isGuestRelatedCreateOnOwnDoc (
    ctx: MeasureContext,
    tx: TxCreateDoc<Doc>,
    account: Account,
    policies: GuestClassPermissionPolicy[]
  ): Promise<boolean> {
    const matchingPolicies = policies.filter(
      (policy) => this.getCoveredClass(tx.objectClass, policy.relatedCreateClasses) !== undefined
    )
    if (matchingPolicies.length === 0) return false

    const attributes = tx.attributes as { attachedTo?: Ref<Doc>, attachedToClass?: Ref<Class<Doc>> }
    const attachedTo = tx.attachedTo ?? attributes.attachedTo
    const attachedToClass = tx.attachedToClass ?? attributes.attachedToClass
    if (attachedTo === undefined || attachedToClass === undefined) return false

    const parents = await this.findAll(ctx, attachedToClass, { _id: attachedTo }, { limit: 1 })
    const parent = parents[0] as Doc | undefined
    if (parent === undefined || parent.space !== tx.objectSpace || !this.isCreatedByAccount(parent, account)) {
      return false
    }

    const h = this.context.hierarchy
    return matchingPolicies.some(
      (policy) =>
        h.isDerived(parent._class, policy.targetClass) ||
        this.getCoveredClass(parent._class, policy.relatedCreateClasses) !== undefined
    )
  }

  private async isForbiddenTx (
    ctx: MeasureContext,
    tx: TxCUD<Doc>,
    account: Account,
    relatedCreates: RelatedCreateScope
  ): Promise<boolean> {
    if (tx._class === core.class.TxMixin) return false

    const cache = await this.getPermissionsCache(ctx)
    const policies = cache.rolePermissionPolicies.get(account.role) ?? []

    if (tx.objectClass === core.class.CustomSequence) {
      // Sequences are guarded only by the policy: the generic fallbacks below must not apply to them.
      return !(await this.isAllowedSequenceTx(ctx, tx, policies))
    }

    // For TxCreateDoc, check the new permission model first for covered types.
    if (tx._class === core.class.TxCreateDoc) {
      const roleAllowedClasses = cache.roleAllowedClasses.get(account.role) ?? new Set<Ref<Class<Doc>>>()
      if (this.getCoveredClass(tx.objectClass, roleAllowedClasses) !== undefined) return false

      const spaceRelatedClasses = relatedCreates.get(tx.objectSpace)
      if (spaceRelatedClasses !== undefined && this.getCoveredClass(tx.objectClass, spaceRelatedClasses) !== undefined) {
        return false
      }
      if (await this.isGuestRelatedCreateOnOwnDoc(ctx, tx as TxCreateDoc<Doc>, account, policies)) return false
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

  /**
   * A guest may only create a permitted sequence from zero and advance it by one,
   * so it cannot skip or reset document numbers.
   */
  private async isAllowedSequenceTx (
    ctx: MeasureContext,
    tx: TxCUD<Doc>,
    policies: GuestClassPermissionPolicy[]
  ): Promise<boolean> {
    const namespaces = new Set(policies.flatMap((policy) => Array.from(policy.sequenceNamespaces)))
    if (namespaces.size === 0 || tx.objectSpace !== core.space.Workspace) return false

    if (tx._class === core.class.TxCreateDoc) {
      const attributes = (tx as TxCreateDoc<CustomSequence>).attributes
      return (
        attributes.namespace !== undefined &&
        namespaces.has(attributes.namespace) &&
        typeof attributes.prefix === 'string' &&
        (attributes.scope === undefined || typeof attributes.scope === 'string') &&
        attributes.sequence === 0
      )
    }
    if (tx._class !== core.class.TxUpdateDoc) return false

    const operations = (tx as TxUpdateDoc<CustomSequence>).operations as Record<string, unknown>
    if (Object.keys(operations).length !== 1) return false
    const increment = operations.$inc as Record<string, unknown> | undefined
    if (
      increment === undefined ||
      Object.keys(increment).length !== 1 ||
      increment.sequence !== GUEST_SEQUENCE_STEP
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
    return sequence?.namespace !== undefined && namespaces.has(sequence.namespace)
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
