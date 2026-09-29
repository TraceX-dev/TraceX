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
  type ClassPermission,
  type CustomSequence,
  type Doc,
  getGroupEffectivePermissions,
  getModulePermissionGroupRole,
  hasAccountRole,
  type MeasureContext,
  type ModulePermissionGroup,
  type Permission,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
  type TxMixin,
  TxProcessor,
  type TxUpdateDoc
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import contact, { type Person } from '@hcengineering/contact'

/** Guest policies resolved from module permission groups and class permissions. */
interface GuestPermissionsCache {
  rolePolicies: Map<AccountRole, GuestClassPermissionPolicy[]>
}

interface GuestClassPermissionPolicy {
  targetClass: Ref<Class<Doc>>
  /** Space class the policy is limited to; undefined for group class permissions, which apply in any space. */
  spaceClass: Ref<Class<Space>> | undefined
  /** Undefined when the policy does not restrict updates: the generic own-document rule applies. */
  guestUpdateAttributes: Set<string> | undefined
  /** Undefined when the policy does not restrict mixins: any mixin is allowed as before. */
  guestUpdateMixinAttributes: Map<string, Set<string>> | undefined
  guestCreateMixinAttributes: Map<string, Set<string>>
  relatedCreateClasses: Set<Ref<Class<Doc>>>
  sequenceNamespaces: Set<string>
}

/** State of one guest `tx` call, shared by the nested transactions of its applies. */
interface GuestTxScope {
  /** Classes unlocked by a target created in the same apply, per space. */
  relatedCreates: Map<Ref<Space>, Set<Ref<Class<Doc>>>>
  /** Target documents created in the same apply, with the policies that permitted them. */
  createdTargets: Map<Ref<Doc>, { space: Ref<Space>, policies: GuestClassPermissionPolicy[] }>
  /** CustomSequence keys guarded by a notMatch of the enclosing apply. */
  sequenceGuards: Set<string>
  /** Space classes loaded while checking this call. */
  spaceClasses: Map<Ref<Space>, Ref<Class<Space>> | undefined>
}

const MAX_SEQUENCE_INCREMENT = 100_000

function sequenceGuardKey (namespace: string, scope: string, prefix: string): string {
  return JSON.stringify([namespace, scope, prefix])
}

function toAttributeMap (value: Record<string, string[]> | undefined): Map<string, Set<string>> {
  return new Map(Object.entries(value ?? {}).map(([mixin, attributes]) => [mixin, new Set(attributes)]))
}

function toPolicy (
  permission: ClassPermission,
  spaceClass: Ref<Class<Space>> | undefined
): GuestClassPermissionPolicy {
  return {
    targetClass: permission.targetClass,
    spaceClass,
    guestUpdateAttributes:
      permission.guestUpdateAttributes !== undefined ? new Set(permission.guestUpdateAttributes) : undefined,
    guestUpdateMixinAttributes:
      permission.guestUpdateMixinAttributes !== undefined || permission.guestCreateMixinAttributes !== undefined
        ? toAttributeMap(permission.guestUpdateMixinAttributes)
        : undefined,
    guestCreateMixinAttributes: toAttributeMap(permission.guestCreateMixinAttributes),
    relatedCreateClasses: new Set(permission.relatedCreateClasses ?? []),
    sequenceNamespaces: new Set(permission.sequenceNamespaces ?? [])
  }
}

function emptyPermissionsCache (): GuestPermissionsCache {
  return { rolePolicies: new Map() }
}

function newTxScope (): GuestTxScope {
  return { relatedCreates: new Map(), createdTargets: new Map(), sequenceGuards: new Set(), spaceClasses: new Map() }
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

  private async getPolicies (ctx: MeasureContext, account: Account): Promise<GuestClassPermissionPolicy[]> {
    return (await this.getPermissionsCache(ctx)).rolePolicies.get(account.role) ?? []
  }

  /**
   * Two kinds of policies are loaded:
   * - class permissions listed in a group directly: they cover their class in any space, as before;
   * - class permissions of a module (`application`) whose group grants a `guestCreate` permission:
   *   they apply only in spaces of the group's `spaceClass`.
   */
  private async loadPermissionsCache (ctx: MeasureContext): Promise<void> {
    try {
      const groups = (await this.findAll(ctx, core.class.ModulePermissionGroup, {}, {})) as ModulePermissionGroup[]
      const activeGroups = groups.map((group) => ({
        group,
        role: getModulePermissionGroupRole(group),
        permissions: getGroupEffectivePermissions(group)
      }))
      const allPermissionIds = new Set<Ref<Permission>>(activeGroups.flatMap((it) => it.permissions))
      if (allPermissionIds.size === 0) {
        this.permissionsCache = emptyPermissionsCache()
        return
      }

      const permissions = (await this.findAll(ctx, core.class.Permission, {
        _id: { $in: Array.from(allPermissionIds) }
      })) as Permission[]
      const guestCreatePermissions = new Set(
        permissions.filter((permission) => permission.guestCreate === true).map((permission) => permission._id)
      )
      const classPermissions = (await this.findAll(ctx, core.class.ClassPermission, {
        _id: { $in: Array.from(allPermissionIds) as Array<Ref<ClassPermission>> }
      })) as ClassPermission[]
      const classPermissionsById = new Map<Ref<Permission>, ClassPermission>(
        classPermissions.map((permission) => [permission._id as Ref<Permission>, permission])
      )

      const createApplications = new Set<Ref<Doc>>()
      for (const { group, permissions } of activeGroups) {
        if (group.spaceClass !== undefined && permissions.some((it) => guestCreatePermissions.has(it))) {
          createApplications.add(group.application)
        }
      }
      const applicationPermissions =
        createApplications.size > 0
          ? ((await this.findAll(ctx, core.class.ClassPermission, {
              application: { $in: Array.from(createApplications) }
            })) as ClassPermission[])
          : []

      const rolePolicies = new Map<AccountRole, GuestClassPermissionPolicy[]>()
      for (const { group, role, permissions } of activeGroups) {
        const policies = rolePolicies.get(role) ?? []
        for (const permissionId of permissions) {
          const permission = classPermissionsById.get(permissionId)
          if (permission?.targetClass !== undefined) policies.push(toPolicy(permission, undefined))
        }
        if (group.spaceClass !== undefined && createApplications.has(group.application)) {
          if (permissions.some((it) => guestCreatePermissions.has(it))) {
            for (const permission of applicationPermissions) {
              if (permission.application !== group.application || permission.targetClass === undefined) continue
              policies.push(toPolicy(permission, group.spaceClass))
            }
          }
        }
        rolePolicies.set(role, policies)
      }
      this.permissionsCache = { rolePolicies }
    } catch (err: unknown) {
      ctx.error('Failed to load guest permissions', { err })
      this.permissionsCache = emptyPermissionsCache()
    }
  }

  private invalidateCacheIfNeeded (txes: Tx[]): void {
    for (const tx of txes.flatMap((it) => this.getNestedTxes(it))) {
      if (TxProcessor.isExtendsCUD(tx._class)) {
        const cudTx = tx as TxCUD<Doc>
        if (
          cudTx.objectClass === core.class.ModulePermissionGroup ||
          this.context.hierarchy.isDerived(cudTx.objectClass, core.class.Permission)
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

    const scope = newTxScope()
    for (const tx of txes) {
      await this.processTx(ctx, tx, scope)
    }

    return await this.provideTx(ctx, txes)
  }

  private async processTx (ctx: MeasureContext<SessionData>, tx: Tx, scope: GuestTxScope): Promise<void> {
    const h = this.context.hierarchy
    if (tx._class === core.class.TxApplyIf) {
      const applyTx = tx as TxApplyIf
      const applyScope = await this.getApplyScope(ctx, applyTx, scope)
      for (const t of applyTx.txes) {
        await this.processTx(ctx, t, applyScope)
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
      } else if (cudTx.space !== core.space.DerivedTx && (await this.isForbiddenTx(ctx, cudTx, account, scope))) {
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
   * Builds the scope of an apply: related classes and creation mixins are unlocked only for the space
   * and the documents of a policy target created in the same apply.
   */
  private async getApplyScope (
    ctx: MeasureContext<SessionData>,
    applyTx: TxApplyIf,
    parent: GuestTxScope
  ): Promise<GuestTxScope> {
    const scope: GuestTxScope = {
      relatedCreates: new Map(
        Array.from(parent.relatedCreates.entries()).map(([space, classes]) => [space, new Set(classes)])
      ),
      createdTargets: new Map(parent.createdTargets),
      sequenceGuards: new Set(parent.sequenceGuards),
      spaceClasses: parent.spaceClasses
    }

    for (const condition of applyTx.notMatch ?? []) {
      if (condition._class !== core.class.CustomSequence) continue
      const query = condition.query as Record<string, unknown>
      if (
        Object.keys(query).length === 3 &&
        typeof query.namespace === 'string' &&
        typeof query.scope === 'string' &&
        typeof query.prefix === 'string'
      ) {
        scope.sequenceGuards.add(sequenceGuardKey(query.namespace, query.scope, query.prefix))
      }
    }

    const policies = await this.getPolicies(ctx, ctx.contextData.account)
    if (policies.length === 0) return scope

    const createTxes = this.getNestedTxes(applyTx).filter(
      (tx): tx is TxCreateDoc<Doc> => tx._class === core.class.TxCreateDoc
    )
    for (const tx of createTxes) {
      const permitted = await this.getCreatePolicies(ctx, tx, policies, scope)
      if (permitted.length === 0) continue
      scope.createdTargets.set(tx.objectId, { space: tx.objectSpace, policies: permitted })
      const classes = scope.relatedCreates.get(tx.objectSpace) ?? new Set<Ref<Class<Doc>>>()
      for (const policy of permitted) {
        for (const relatedClass of policy.relatedCreateClasses) classes.add(relatedClass)
      }
      scope.relatedCreates.set(tx.objectSpace, classes)
    }
    return scope
  }

  private logForbiddenTx (ctx: MeasureContext, account: Account, tx: Tx, reason: string): void {
    const isCud = TxProcessor.isExtendsCUD(tx._class)
    ctx.warn('Guest transaction rejected', {
      reason,
      accountRole: account.role,
      txClass: tx._class,
      objectClass: isCud ? (tx as TxCUD<Doc>).objectClass : tx._class,
      objectSpace: isCud ? (tx as TxCUD<Doc>).objectSpace : undefined
    })
  }

  /**
   * Returns the covered-class ancestor of the objectClass, or undefined if the class is not covered.
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

  private async findDoc (ctx: MeasureContext, _class: Ref<Class<Doc>>, _id: Ref<Doc>): Promise<Doc | undefined> {
    return (await this.findAll(ctx, _class, { _id }, { limit: 1 }))[0]
  }

  private async isPolicySpace (
    ctx: MeasureContext,
    policy: GuestClassPermissionPolicy,
    spaceId: Ref<Space>,
    scope: GuestTxScope
  ): Promise<boolean> {
    if (policy.spaceClass === undefined) return true
    let spaceClass = scope.spaceClasses.get(spaceId)
    if (!scope.spaceClasses.has(spaceId)) {
      spaceClass = (await this.findDoc(ctx, core.class.Space, spaceId))?._class
      scope.spaceClasses.set(spaceId, spaceClass)
    }
    return spaceClass !== undefined && this.context.hierarchy.isDerived(spaceClass, policy.spaceClass)
  }

  /** Policies that permit creating the document of this tx in its space. */
  private async getCreatePolicies (
    ctx: MeasureContext,
    tx: TxCreateDoc<Doc>,
    policies: GuestClassPermissionPolicy[],
    scope: GuestTxScope
  ): Promise<GuestClassPermissionPolicy[]> {
    const result: GuestClassPermissionPolicy[] = []
    for (const policy of policies) {
      if (!this.context.hierarchy.isDerived(tx.objectClass, policy.targetClass)) continue
      if (await this.isPolicySpace(ctx, policy, tx.objectSpace, scope)) result.push(policy)
    }
    return result
  }

  private getUpdatedAttributes (operations: Record<string, unknown>): Set<string> | undefined {
    const result = new Set<string>()
    const supportedOperators = new Set(['$push', '$pull', '$inc', '$unset', '$update'])
    for (const [key, value] of Object.entries(operations)) {
      if (!key.startsWith('$')) {
        result.add(key)
        continue
      }
      if (!supportedOperators.has(key) || value === null || typeof value !== 'object' || Array.isArray(value)) {
        return undefined
      }
      for (const attribute of Object.keys(value)) result.add(attribute)
    }
    return result.size > 0 ? result : undefined
  }

  /**
   * Policies that restrict updates (or mixins) of the document the tx changes, together with the document.
   * A tx may name an ancestor class (e.g. a mixin applied through the base class), so the document is
   * loaded whenever a restricting policy could cover it.
   */
  private async getRestrictingPolicies (
    ctx: MeasureContext,
    tx: TxCUD<Doc>,
    policies: GuestClassPermissionPolicy[],
    isRestricting: (policy: GuestClassPermissionPolicy) => boolean
  ): Promise<{ doc: Doc | undefined, policies: GuestClassPermissionPolicy[] }> {
    const h = this.context.hierarchy
    const candidates = policies.filter(
      (policy) =>
        isRestricting(policy) &&
        (h.isDerived(tx.objectClass, policy.targetClass) || h.isDerived(policy.targetClass, tx.objectClass))
    )
    if (candidates.length === 0) return { doc: undefined, policies: [] }
    const doc = await this.findDoc(ctx, tx.objectClass, tx.objectId)
    if (doc === undefined) return { doc, policies: [] }
    return { doc, policies: candidates.filter((policy) => h.isDerived(doc._class, policy.targetClass)) }
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
    policies: GuestClassPermissionPolicy[],
    scope: GuestTxScope
  ): Promise<boolean> {
    const matchingPolicies = policies.filter(
      (policy) => this.getCoveredClass(tx.objectClass, policy.relatedCreateClasses) !== undefined
    )
    if (matchingPolicies.length === 0) return false

    const attributes = tx.attributes as { attachedTo?: Ref<Doc>, attachedToClass?: Ref<Class<Doc>> }
    const attachedTo = tx.attachedTo ?? attributes.attachedTo
    const attachedToClass = tx.attachedToClass ?? attributes.attachedToClass
    if (attachedTo === undefined || attachedToClass === undefined) return false

    const parent = await this.findDoc(ctx, attachedToClass, attachedTo)
    if (parent === undefined || parent.space !== tx.objectSpace || !this.isCreatedByAccount(parent, account)) {
      return false
    }

    const h = this.context.hierarchy
    for (const policy of matchingPolicies) {
      if (!(await this.isPolicySpace(ctx, policy, parent.space, scope))) continue
      if (
        h.isDerived(parent._class, policy.targetClass) ||
        this.getCoveredClass(parent._class, policy.relatedCreateClasses) !== undefined
      ) {
        return true
      }
    }
    return false
  }

  private isCreationMixinAllowed (tx: TxMixin<Doc, Doc>, scope: GuestTxScope): boolean {
    const created = scope.createdTargets.get(tx.objectId)
    if (created === undefined || created.space !== tx.objectSpace) return false
    const attributes = this.getUpdatedAttributes(tx.attributes as Record<string, unknown>)
    if (attributes === undefined) return false
    return created.policies.some((policy) => {
      const allowed = policy.guestCreateMixinAttributes.get(tx.mixin)
      return allowed !== undefined && Array.from(attributes).every((attribute) => allowed.has(attribute))
    })
  }

  /**
   * Checks an update or a mixin of a document covered by policies that restrict it:
   * only the guest's own documents, and only whitelisted attributes.
   */
  private isWhitelistedOwnUpdate (
    tx: TxCUD<Doc>,
    doc: Doc,
    account: Account,
    allowed: Array<Set<string> | undefined>
  ): boolean {
    if (doc.space !== tx.objectSpace || !this.isCreatedByAccount(doc, account)) return false
    const updated = this.getUpdatedAttributes(
      tx._class === core.class.TxMixin
        ? ((tx as TxMixin<Doc, Doc>).attributes as Record<string, unknown>)
        : ((tx as TxUpdateDoc<Doc>).operations as Record<string, unknown>)
    )
    if (updated === undefined) return false
    return allowed.some(
      (attributes) => attributes !== undefined && Array.from(updated).every((attribute) => attributes.has(attribute))
    )
  }

  private async isGuestMutationOnOwnDoc (ctx: MeasureContext, tx: TxCUD<Doc>, account: Account): Promise<boolean> {
    if (tx._class !== core.class.TxUpdateDoc && tx._class !== core.class.TxRemoveDoc) return false
    const doc = await this.findDoc(ctx, tx.objectClass, tx.objectId)
    if (doc === undefined) return false
    return this.isCreatedByAccount(doc, account)
  }

  private async isForbiddenTx (
    ctx: MeasureContext,
    tx: TxCUD<Doc>,
    account: Account,
    scope: GuestTxScope
  ): Promise<boolean> {
    const policies = await this.getPolicies(ctx, account)

    if (tx.objectClass === core.class.CustomSequence) {
      // Guests only touch sequences through a policy: the generic own-document rule must not apply to them.
      return !(await this.isAllowedSequenceTx(ctx, tx, policies, scope))
    }

    if (tx._class === core.class.TxMixin) {
      const mixinTx = tx as TxMixin<Doc, Doc>
      if (this.isCreationMixinAllowed(mixinTx, scope)) return false
      // A mixin on a target created in this apply is part of its creation and must be whitelisted for it.
      if (scope.createdTargets.has(tx.objectId)) return true
      const restricting = await this.getRestrictingPolicies(
        ctx,
        tx,
        policies,
        (policy) => policy.guestUpdateMixinAttributes !== undefined
      )
      // Mixins stay unrestricted for guests unless a policy restricts them for the document class.
      if (restricting.doc === undefined || restricting.policies.length === 0) return false
      return !this.isWhitelistedOwnUpdate(
        tx,
        restricting.doc,
        account,
        restricting.policies.map((policy) => policy.guestUpdateMixinAttributes?.get(mixinTx.mixin))
      )
    }

    if (tx._class === core.class.TxCreateDoc) {
      const createTx = tx as TxCreateDoc<Doc>
      if ((await this.getCreatePolicies(ctx, createTx, policies, scope)).length > 0) return false
      const spaceRelatedClasses = scope.relatedCreates.get(tx.objectSpace)
      if (spaceRelatedClasses !== undefined && this.getCoveredClass(tx.objectClass, spaceRelatedClasses) !== undefined) {
        return false
      }
      if (await this.isGuestRelatedCreateOnOwnDoc(ctx, createTx, account, policies, scope)) return false
      // Uncovered class: fall through to TxAccessLevel check.
    }

    if (tx._class === core.class.TxUpdateDoc) {
      const restricting = await this.getRestrictingPolicies(
        ctx,
        tx,
        policies,
        (policy) => policy.guestUpdateAttributes !== undefined
      )
      if (restricting.doc !== undefined && restricting.policies.length > 0) {
        if (this.isWhitelistedOwnUpdate(tx, restricting.doc, account, restricting.policies.map((it) => it.guestUpdateAttributes))) {
          return false
        }
        return !(await this.hasMixinAccessLevel(ctx, tx, account))
      }
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
   * A guest may only create a permitted sequence from zero inside an apply guarded against a concurrent
   * creation, and move it forward, so it can never reset or reuse numbers.
   */
  private async isAllowedSequenceTx (
    ctx: MeasureContext,
    tx: TxCUD<Doc>,
    policies: GuestClassPermissionPolicy[],
    scope: GuestTxScope
  ): Promise<boolean> {
    const namespaces = new Set(policies.flatMap((policy) => Array.from(policy.sequenceNamespaces)))
    if (namespaces.size === 0 || tx.objectSpace !== core.space.Workspace) return false

    if (tx._class === core.class.TxCreateDoc) {
      const attributes = (tx as TxCreateDoc<CustomSequence>).attributes
      const keys = Object.keys(attributes)
      return (
        keys.length === 5 &&
        keys.every((key) => ['attachedTo', 'namespace', 'scope', 'prefix', 'sequence'].includes(key)) &&
        attributes.attachedTo === core.class.CustomSequence &&
        attributes.namespace !== undefined &&
        namespaces.has(attributes.namespace) &&
        typeof attributes.prefix === 'string' &&
        typeof attributes.scope === 'string' &&
        attributes.sequence === 0 &&
        scope.sequenceGuards.has(sequenceGuardKey(attributes.namespace, attributes.scope, attributes.prefix))
      )
    }
    if (tx._class !== core.class.TxUpdateDoc) return false

    const operations = (tx as TxUpdateDoc<CustomSequence>).operations as Record<string, unknown>
    if (Object.keys(operations).length !== 1) return false
    const increment = operations.$inc as Record<string, unknown> | undefined
    const step = increment?.sequence
    // A step above one is legitimate: allocation catches a lagging sequence up to the minimum in one increment.
    if (
      increment === undefined ||
      Object.keys(increment).length !== 1 ||
      typeof step !== 'number' ||
      !Number.isSafeInteger(step) ||
      step <= 0 ||
      step > MAX_SEQUENCE_INCREMENT
    ) {
      return false
    }

    const sequence = (await this.findDoc(ctx, core.class.CustomSequence, tx.objectId)) as CustomSequence | undefined
    return (
      sequence?.namespace !== undefined &&
      namespaces.has(sequence.namespace) &&
      Number.isSafeInteger(sequence.sequence) &&
      Number.isSafeInteger(sequence.sequence + step)
    )
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
