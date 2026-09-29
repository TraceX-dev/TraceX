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

import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import core, {
  type Account,
  AccountRole,
  type AttachedDoc,
  type Class,
  type Collaborator,
  type CustomSequence,
  type Doc,
  getClassCollaborators,
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
import {
  createGuestTxScope,
  emptyGuestPermissionsCache,
  getNestedTxes,
  getUpdatedAttributes,
  type GuestClassPermissionPolicy,
  type GuestPermissionsCache,
  type GuestTxScope,
  loadGuestPermissionsCache,
  sequenceGuardKey
} from './guest-permission-policies'

const MAX_SEQUENCE_INCREMENT = 100_000

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
    return this.permissionsCache ?? emptyGuestPermissionsCache()
  }

  private async getPolicies (ctx: MeasureContext, account: Account): Promise<GuestClassPermissionPolicy[]> {
    return (await this.getPermissionsCache(ctx)).rolePolicies.get(account.role) ?? []
  }

  private async loadPermissionsCache (ctx: MeasureContext): Promise<void> {
    try {
      this.permissionsCache = await loadGuestPermissionsCache(ctx, this)
    } catch (err: unknown) {
      ctx.error('Failed to load guest permissions', { err })
      this.permissionsCache = emptyGuestPermissionsCache()
    }
  }

  private invalidateCacheIfNeeded (txes: Tx[]): void {
    for (const tx of txes.flatMap(getNestedTxes)) {
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

    const scope = createGuestTxScope()
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

    const createTxes = applyTx.txes.filter((tx): tx is TxCreateDoc<Doc> => tx._class === core.class.TxCreateDoc)
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
    const attributes = getUpdatedAttributes(tx.attributes as Record<string, unknown>)
    if (attributes === undefined) return false
    return created.policies.some((policy) => {
      const allowed = policy.guestCreateMixinAttributes.get(tx.mixin)
      return allowed !== undefined && Array.from(attributes).every((attribute) => allowed.has(attribute))
    })
  }

  private isWhitelistedOwnUpdate (
    tx: TxCUD<Doc>,
    doc: Doc,
    account: Account,
    allowed: Array<Set<string> | undefined>
  ): boolean {
    if (doc.space !== tx.objectSpace || !this.isCreatedByAccount(doc, account)) return false
    const updated = getUpdatedAttributes(
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

  /**
   * An update of a document assigned to the guest, e.g. completing its process task. Allowed when a policy
   * of the document class has a `guestAssignee` rule and every condition of the rule holds.
   */
  private async isAssigneeUpdate (
    ctx: MeasureContext,
    tx: TxUpdateDoc<Doc>,
    account: Account,
    policies: GuestClassPermissionPolicy[]
  ): Promise<boolean> {
    const h = this.context.hierarchy
    const candidates = policies.filter(
      (policy) => policy.guestAssignee !== undefined && h.isDerived(tx.objectClass, policy.targetClass)
    )
    if (candidates.length === 0) return false
    const updated = getUpdatedAttributes(tx.operations as Record<string, unknown>)
    if (updated === undefined) return false
    const doc = await this.findDoc(ctx, tx.objectClass, tx.objectId)
    if (doc === undefined || doc.space !== tx.objectSpace) return false

    for (const policy of candidates) {
      const rule = policy.guestAssignee
      if (rule === undefined || !h.isDerived(doc._class, policy.targetClass)) continue
      // Attributes of a derived class are allowed only on documents of that class.
      const allowed = Array.from(updated).every(
        (attribute) => rule.attributes.includes(attribute) && h.findAttribute(doc._class, attribute) !== undefined
      )
      if (!allowed) continue
      if (rule.openField !== undefined && (doc as any)[rule.openField] != null) continue
      if (!(await this.isAssignedTo(ctx, (doc as any)[rule.field], account))) continue
      if (rule.requireAttachedToAccess === true && !(await this.canReadAttachedTo(ctx, doc, account))) continue
      return true
    }
    return false
  }

  private async isAssignedTo (ctx: MeasureContext, assignee: unknown, account: Account): Promise<boolean> {
    if (typeof assignee !== 'string') return false
    const person = (await this.findDoc(ctx, contact.class.Person, assignee as Ref<Doc>)) as Person | undefined
    return person?.personUuid === account.uuid
  }

  private async canReadAttachedTo (ctx: MeasureContext, doc: Doc, account: Account): Promise<boolean> {
    const { attachedTo, attachedToClass } = doc as Partial<AttachedDoc>
    if (attachedTo == null || attachedToClass == null) return false
    const target = await this.findDoc(ctx, attachedToClass, attachedTo)
    return target !== undefined && (await this.canGuestRead(ctx, target, account))
  }

  /**
   * Mirrors the read security the storage applies to guests: a document is readable in the shared and
   * system spaces, in non-archived spaces the guest is a member of, and through collaborator security.
   * This middleware runs below the find security, so its own finds are not filtered.
   */
  private async canGuestRead (ctx: MeasureContext, doc: Doc, account: Account): Promise<boolean> {
    const space = await this.findDoc(ctx, core.class.Space, doc.space)
    if (space !== undefined && !(space as Space).archived) {
      if (
        space._id === core.space.Space ||
        space._class === core.class.SystemSpace ||
        (space as Space).members.includes(account.uuid)
      ) {
        return true
      }
    }
    const collabSec = getClassCollaborators(this.context.modelDb, this.context.hierarchy, doc._class)
    const targets: Array<Ref<Doc>> = []
    if (collabSec?.provideSecurity === true) targets.push(doc._id)
    const attachedTo = (doc as Partial<AttachedDoc>).attachedTo
    if (collabSec?.provideAttachedSecurity === true && attachedTo != null) targets.push(attachedTo)
    if (targets.length === 0) return false
    const collaborators = await this.findAll(
      ctx,
      core.class.Collaborator,
      { attachedTo: { $in: targets }, collaborator: account.uuid },
      { limit: 1 }
    )
    return (collaborators as Collaborator[]).length > 0
  }

  private async isForbiddenTx (
    ctx: MeasureContext,
    tx: TxCUD<Doc>,
    account: Account,
    scope: GuestTxScope
  ): Promise<boolean> {
    const policies = await this.getPolicies(ctx, account)

    if (tx.objectClass === core.class.CustomSequence) {
      // Sequences never use the generic own-document rule.
      return !(await this.isAllowedSequenceTx(ctx, tx, policies, scope))
    }

    if (tx._class === core.class.TxMixin) {
      const mixinTx = tx as TxMixin<Doc, Doc>
      if (this.isCreationMixinAllowed(mixinTx, scope)) return false
      // Creation mixins must be explicitly allowed.
      if (scope.createdTargets.has(tx.objectId)) return true
      const restricting = await this.getRestrictingPolicies(
        ctx,
        tx,
        policies,
        (policy) => policy.guestUpdateMixinAttributes !== undefined
      )
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
      if (
        spaceRelatedClasses !== undefined &&
        this.getCoveredClass(tx.objectClass, spaceRelatedClasses) !== undefined
      ) {
        return false
      }
      if (await this.isGuestRelatedCreateOnOwnDoc(ctx, createTx, account, policies, scope)) return false
    }

    if (
      tx._class === core.class.TxUpdateDoc &&
      (await this.isAssigneeUpdate(ctx, tx as TxUpdateDoc<Doc>, account, policies))
    ) {
      return false
    }

    if (tx._class === core.class.TxUpdateDoc) {
      const restricting = await this.getRestrictingPolicies(
        ctx,
        tx,
        policies,
        (policy) => policy.guestUpdateAttributes !== undefined
      )
      if (restricting.doc !== undefined && restricting.policies.length > 0) {
        if (
          this.isWhitelistedOwnUpdate(
            tx,
            restricting.doc,
            account,
            restricting.policies.map((it) => it.guestUpdateAttributes)
          )
        ) {
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
    // Allocation may catch a lagging sequence up in one increment.
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
