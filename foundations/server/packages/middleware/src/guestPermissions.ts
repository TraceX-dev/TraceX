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
  getModulePermissionGroupRole,
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
  type TxMixin,
  TxProcessor,
  type TxUpdateDoc
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import contact, { type Person } from '@hcengineering/contact'

/** Cached guest create policies resolved from module groups and class permissions. */
interface GuestPermissionsCache {
  rolePermissionPolicies: Map<AccountRole, GuestClassPermissionPolicy[]>
}

interface GuestClassPermissionPolicy {
  targetClass: Ref<Class<Doc>>
  spaceClass: Ref<Class<Space>>
  guestUpdateAttributes: Set<string>
  guestUpdateMixinAttributes: Map<string, Set<string>>
  relatedCreateClasses: Set<Ref<Class<Doc>>>
  sequenceNamespaces: Set<string>
}

/**
 * Classes a guest may additionally create inside a TxApplyIf, keyed by the space
 * of the permitted target document created in the same apply.
 */
type RelatedCreateScope = Map<Ref<Space>, Set<Ref<Class<Doc>>>>
type SequenceCreateGuards = Set<string>

const MAX_SEQUENCE_INCREMENT = 100_000

function sequenceGuardKey (namespace: string, scope: string, prefix: string): string {
  return JSON.stringify([namespace, scope, prefix])
}

function emptyPermissionsCache (): GuestPermissionsCache {
  return { rolePermissionPolicies: new Map() }
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

      const activeGroups = groups
        // Stored legacy groups may lack `enabled`; only an explicit false disables them.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare
        .filter((group) => group.enabled !== false)
        .map((group) => {
          const disabled = new Set(group.disabledPermissions ?? [])
          return {
            application: group.application,
            role: getModulePermissionGroupRole(group),
            spaceClass: group.spaceClass,
            permissions: (group.permissions ?? []).filter((permission) => !disabled.has(permission))
          }
        })
      const allPermissionIds = new Set<Ref<Permission>>()
      for (const group of activeGroups) {
        for (const permissionId of group.permissions) allPermissionIds.add(permissionId)
      }

      const activePermissions =
        allPermissionIds.size > 0
          ? ((await this.findAll(ctx, core.class.Permission, {
              _id: { $in: Array.from(allPermissionIds) }
            })) as Permission[])
          : []
      const guestCreatePermissions = new Set(
        activePermissions.filter((permission) => permission.guestCreate === true).map((permission) => permission._id)
      )

      const createApplications = new Set<Ref<Doc>>()
      for (const group of activeGroups) {
        if (group.permissions.some((permission) => guestCreatePermissions.has(permission))) {
          createApplications.add(group.application)
        }
      }

      const legacyClassPermissions =
        allPermissionIds.size > 0
          ? ((await this.findAll(ctx, core.class.ClassPermission, {
              _id: { $in: Array.from(allPermissionIds) as Ref<ClassPermission>[] }
            })) as ClassPermission[])
          : []
      const applicationClassPermissions =
        createApplications.size > 0
          ? ((await this.findAll(ctx, core.class.ClassPermission, {
              application: { $in: Array.from(createApplications) }
            })) as ClassPermission[])
          : []
      const legacyPermissionsById = new Map<Ref<Permission>, ClassPermission>(
        legacyClassPermissions.map((permission) => [permission._id as Ref<Permission>, permission])
      )

      const rolePermissionPolicies = new Map<AccountRole, GuestClassPermissionPolicy[]>()
      const roles = new Set(activeGroups.map((group) => group.role))
      for (const role of roles) {
        const policies: GuestClassPermissionPolicy[] = []
        for (const group of activeGroups.filter((group) => group.role === role)) {
          if (group.spaceClass === undefined) continue
          const permissions = group.permissions
            .map((permission) => legacyPermissionsById.get(permission))
            .filter((permission): permission is ClassPermission => permission !== undefined)
          if (group.permissions.some((permission) => guestCreatePermissions.has(permission))) {
            permissions.push(
              ...applicationClassPermissions.filter((permission) => permission.application === group.application)
            )
          }
          for (const permission of permissions) {
            if (permission.targetClass === undefined) continue
            policies.push({
              targetClass: permission.targetClass,
              spaceClass: group.spaceClass,
              guestUpdateAttributes: new Set(permission.guestUpdateAttributes ?? []),
              guestUpdateMixinAttributes: new Map(
                Object.entries(permission.guestUpdateMixinAttributes ?? {}).map(([mixin, attributes]) => [
                  mixin,
                  new Set(attributes)
                ])
              ),
              relatedCreateClasses: new Set(permission.relatedCreateClasses ?? []),
              sequenceNamespaces: new Set(permission.sequenceNamespaces ?? [])
            })
          }
        }
        rolePermissionPolicies.set(role, policies)
      }
      this.permissionsCache = { rolePermissionPolicies }
    } catch (err: unknown) {
      ctx.error('Failed to load guest permissions', { err })
      this.permissionsCache = emptyPermissionsCache()
    }
  }

  private invalidateCacheIfNeeded (txes: Tx[]): void {
    for (const tx of txes.flatMap((tx) => this.getNestedTxes(tx))) {
      if (TxProcessor.isExtendsCUD(tx._class)) {
        const cudTx = tx as TxCUD<Doc>
        if (
          cudTx.objectClass === core.class.ModulePermissionGroup ||
          cudTx.objectClass === core.class.ClassPermission ||
          cudTx.objectClass === core.class.Permission
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
    relatedCreates: RelatedCreateScope = new Map(),
    sequenceCreateGuards: SequenceCreateGuards = new Set()
  ): Promise<void> {
    const h = this.context.hierarchy
    if (tx._class === core.class.TxApplyIf) {
      const applyTx = tx as TxApplyIf
      const applyRelatedCreates = await this.getApplyRelatedCreates(ctx, applyTx, relatedCreates)
      const applySequenceCreateGuards = this.getApplySequenceCreateGuards(applyTx, sequenceCreateGuards)
      for (const t of applyTx.txes) {
        await this.processTx(ctx, t, applyRelatedCreates, applySequenceCreateGuards)
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
        (await this.isForbiddenTx(ctx, cudTx, account, relatedCreates, sequenceCreateGuards))
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

  private getApplySequenceCreateGuards (
    applyTx: TxApplyIf,
    inherited: SequenceCreateGuards
  ): SequenceCreateGuards {
    const result = new Set(inherited)
    for (const condition of applyTx.notMatch ?? []) {
      if (condition._class !== core.class.CustomSequence) continue
      const query = condition.query as Record<string, unknown>
      if (
        Object.keys(query).length !== 3 ||
        typeof query.namespace !== 'string' ||
        typeof query.scope !== 'string' ||
        typeof query.prefix !== 'string'
      ) {
        continue
      }
      result.add(sequenceGuardKey(query.namespace, query.scope, query.prefix))
    }
    return result
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
        if (!(await this.isPolicySpace(ctx, tx.objectSpace, policy.spaceClass))) continue
        const classes = result.get(tx.objectSpace) ?? new Set<Ref<Class<Doc>>>()
        for (const relatedClass of policy.relatedCreateClasses) classes.add(relatedClass)
        result.set(tx.objectSpace, classes)
      }
    }
    return result
  }

  private logForbiddenTx (ctx: MeasureContext, account: Account, tx: Tx, reason: string): void {
    const isCud = TxProcessor.isExtendsCUD(tx._class)
    ctx.warn('Guest transaction rejected', {
      reason,
      accountRole: account.role,
      txClass: tx._class,
      objectClass: isCud ? (tx as TxCUD<Doc>).objectClass : tx._class,
      objectSpace: isCud ? (tx as TxCUD<Doc>).objectSpace : undefined,
      // Only operation keys are logged, never values, to keep document content out of the logs.
      operations: tx._class === core.class.TxUpdateDoc ? Object.keys((tx as TxUpdateDoc<Doc>).operations) : undefined
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

  private async isPolicySpace (
    ctx: MeasureContext,
    spaceId: Ref<Space>,
    expectedClass: Ref<Class<Space>>
  ): Promise<boolean> {
    const spaces = await this.findAll(ctx, core.class.Space, { _id: spaceId }, { limit: 1 })
    const space = spaces[0] as Space | undefined
    return (
      space !== undefined &&
      (space._class === expectedClass || this.context.hierarchy.isDerived(space._class, expectedClass))
    )
  }

  private getUpdatedAttributes (operations: Record<string, unknown>): Set<string> | undefined {
    const result = new Set<string>()
    const supportedOperators = new Set(['$push', '$pull', '$inc', '$unset', '$update'])
    for (const [key, value] of Object.entries(operations)) {
      if (!key.startsWith('$')) {
        result.add(key)
        continue
      }
      if (
        !supportedOperators.has(key) ||
        value === null ||
        typeof value !== 'object' ||
        Array.isArray(value)
      ) {
        return undefined
      }
      for (const attribute of Object.keys(value)) result.add(attribute)
    }
    return result.size > 0 ? result : undefined
  }

  private async isGuestUpdateOnOwnDocAllowed (
    ctx: MeasureContext,
    tx: TxUpdateDoc<Doc> | TxMixin<Doc, Doc>,
    account: Account,
    policies: GuestClassPermissionPolicy[]
  ): Promise<boolean> {
    const docs = await this.findAll(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 })
    const doc = docs[0] as Doc | undefined
    if (doc === undefined || doc.space !== tx.objectSpace || !this.isCreatedByAccount(doc, account)) return false

    const updatedAttributes = this.getUpdatedAttributes(
      tx._class === core.class.TxMixin
        ? ((tx as TxMixin<Doc, Doc>).attributes as Record<string, unknown>)
        : ((tx as TxUpdateDoc<Doc>).operations as Record<string, unknown>)
    )
    if (updatedAttributes === undefined) return false

    for (const policy of policies) {
      if (!this.context.hierarchy.isDerived(doc._class, policy.targetClass)) continue
      if (!(await this.isPolicySpace(ctx, doc.space, policy.spaceClass))) continue
      const allowedAttributes =
        tx._class === core.class.TxMixin
          ? policy.guestUpdateMixinAttributes.get((tx as TxMixin<Doc, Doc>).mixin)
          : policy.guestUpdateAttributes
      if (
        allowedAttributes !== undefined &&
        updatedAttributes.size > 0 &&
        Array.from(updatedAttributes).every((attribute) => allowedAttributes.has(attribute))
      ) {
        return true
      }
    }
    return false
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
    for (const policy of matchingPolicies) {
      if (!(await this.isPolicySpace(ctx, parent.space, policy.spaceClass))) continue
      if (
        h.isDerived(parent._class, policy.targetClass) ||
        this.getCoveredClass(parent._class, policy.relatedCreateClasses) !== undefined
      ) {
        return true
      }
    }
    return false
  }

  private async isForbiddenTx (
    ctx: MeasureContext,
    tx: TxCUD<Doc>,
    account: Account,
    relatedCreates: RelatedCreateScope,
    sequenceCreateGuards: SequenceCreateGuards
  ): Promise<boolean> {
    const cache = await this.getPermissionsCache(ctx)
    const policies = cache.rolePermissionPolicies.get(account.role) ?? []

    if (tx.objectClass === core.class.CustomSequence) {
      // Sequences are guarded only by the policy: the generic fallbacks below must not apply to them.
      return !(await this.isAllowedSequenceTx(ctx, tx, policies, sequenceCreateGuards))
    }

    // For TxCreateDoc, check the new permission model first for covered types.
    if (tx._class === core.class.TxCreateDoc) {
      for (const policy of policies) {
        if (
          this.context.hierarchy.isDerived(tx.objectClass, policy.targetClass) &&
          (await this.isPolicySpace(ctx, tx.objectSpace, policy.spaceClass))
        ) {
          return false
        }
      }

      const spaceRelatedClasses = relatedCreates.get(tx.objectSpace)
      if (
        spaceRelatedClasses !== undefined &&
        this.getCoveredClass(tx.objectClass, spaceRelatedClasses) !== undefined
      ) {
        return false
      }
      if (await this.isGuestRelatedCreateOnOwnDoc(ctx, tx as TxCreateDoc<Doc>, account, policies)) return false
      // Uncovered class: fall through to TxAccessLevel check.
    }

    if (
      (tx._class === core.class.TxUpdateDoc || tx._class === core.class.TxMixin) &&
      (await this.isGuestUpdateOnOwnDocAllowed(
        ctx,
        tx as TxUpdateDoc<Doc> | TxMixin<Doc, Doc>,
        account,
        policies
      ))
    ) {
      return false
    }

    // TxAccessLevel remains an explicit legacy policy for classes outside the module contribution model.
    if (await this.hasMixinAccessLevel(ctx, tx, account)) {
      return false
    }

    return true
  }

  /**
   * A guest may only create a permitted sequence from zero and move it forward,
   * so it can never reset or reuse document numbers.
   */
  private async isAllowedSequenceTx (
    ctx: MeasureContext,
    tx: TxCUD<Doc>,
    policies: GuestClassPermissionPolicy[],
    sequenceCreateGuards: SequenceCreateGuards
  ): Promise<boolean> {
    const namespaces = new Set(policies.flatMap((policy) => Array.from(policy.sequenceNamespaces)))
    if (namespaces.size === 0 || tx.objectSpace !== core.space.Workspace) return false

    if (tx._class === core.class.TxCreateDoc) {
      const attributes = (tx as TxCreateDoc<CustomSequence>).attributes
      const attributeKeys = Object.keys(attributes)
      return (
        attributeKeys.length === 5 &&
        attributeKeys.every((key) => ['attachedTo', 'namespace', 'scope', 'prefix', 'sequence'].includes(key)) &&
        attributes.attachedTo === core.class.CustomSequence &&
        attributes.namespace !== undefined &&
        namespaces.has(attributes.namespace) &&
        typeof attributes.prefix === 'string' &&
        typeof attributes.scope === 'string' &&
        attributes.sequence === 0 &&
        sequenceCreateGuards.has(sequenceGuardKey(attributes.namespace, attributes.scope, attributes.prefix))
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

    const sequences = await this.findAll(
      ctx,
      core.class.CustomSequence,
      { _id: tx.objectId as Ref<CustomSequence> },
      { limit: 1 }
    )
    const sequence = sequences[0] as CustomSequence | undefined
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
