import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import core, {
  type Account,
  AccountRole,
  GuestSecurityProfile,
  type Class,
  type Doc,
  type DocumentQuery,
  hasAccountRole,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxApplyIf,
  type TxCUD,
  type TxCreateDoc,
  TxProcessor,
  type TxMixin,
  type TxUpdateDoc
} from '@hcengineering/core'
import contact from '@hcengineering/contact'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { ClassAccessResolver, hasClassAccessLevel, isClassAccessAllowed } from './accessGate'
import { AccountIdentityResolver, RowVisibilityResolver } from './rowVisibility'
import { resolveGuestSecurityProfile } from './guestVisibility'

// Importing `@hcengineering/process` would pull client-only dependencies into this package.
const APPROVE_REQUEST_CLASS = 'process:class:ApproveRequest' as unknown as Ref<Class<Doc>>

export class GuestPermissionsMiddleware extends BaseMiddleware implements Middleware {
  // Use this middleware so overridden `findAll` methods are honored.
  private readonly classAccess = new ClassAccessResolver(this)
  private readonly rowVisibility = new RowVisibilityResolver(this.next)

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<GuestPermissionsMiddleware> {
    return new GuestPermissionsMiddleware(context, next)
  }

  private invalidateCacheIfNeeded (txes: Tx[]): boolean {
    for (const tx of txes) {
      if (tx._class === core.class.TxApplyIf && this.invalidateCacheIfNeeded((tx as TxApplyIf).txes)) {
        return true
      }
      if (TxProcessor.isExtendsCUD(tx._class)) {
        const cudTx = tx as TxCUD<Doc>
        if (
          cudTx.objectClass === core.class.ModulePermissionGroup ||
          cudTx.objectClass === core.class.ClassPermission
        ) {
          this.classAccess.invalidate()
          return true
        }
      }
    }
    return false
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const account = ctx.contextData.account
    if (hasAccountRole(account, AccountRole.User)) {
      this.invalidateCacheIfNeeded(txes)
      return await this.provideTx(ctx, txes)
    }

    if (
      (await resolveGuestSecurityProfile(this.next, ctx, account)) === GuestSecurityProfile.Viewer &&
      !txes.every((tx) => this.isViewerTxAllowed(tx))
    ) {
      throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
    }

    for (const tx of txes) {
      await this.processTx(ctx, tx)
    }

    return await this.provideTx(ctx, txes)
  }

  private isViewerTxAllowed (tx: Tx): boolean {
    if (tx._class === core.class.TxApplyIf) {
      return (tx as TxApplyIf).txes.every((nestedTx) => this.isViewerTxAllowed(nestedTx))
    }
    if (!TxProcessor.isExtendsCUD(tx._class)) return false
    const access = this.context.hierarchy.classHierarchyMixin(
      (tx as TxCUD<Doc>).objectClass,
      core.mixin.TxAccessLevel
    )
    return access?.allowViewerWrite === true
  }

  private async processTx (ctx: MeasureContext<SessionData>, tx: Tx): Promise<void> {
    const h = this.context.hierarchy
    if (tx._class === core.class.TxApplyIf) {
      const applyTx = tx as TxApplyIf
      for (const t of applyTx.txes) {
        await this.processTx(ctx, t)
      }
      return
    }
    if (TxProcessor.isExtendsCUD(tx._class)) {
      const { account } = ctx.contextData
      const cudTx = tx as TxCUD<Doc>
      const isSpace = h.isDerived(cudTx.objectClass, core.class.Space)
      if (isSpace) {
        if (await this.isForbiddenSpaceTx(ctx, cudTx as TxCUD<Space>, account)) {
          throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
        }
      } else if (cudTx.space !== core.space.DerivedTx && (await this.isForbiddenTx(ctx, cudTx, account))) {
        throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      }
    }
  }

  /**
   * Bypasses `core.class.Collaborator`'s own ownerField policy (which would require the named
   * collaborator to be the caller) - gated on `card.ids.GuestCollaboratorClassPermission` plus the
   * caller having created the document the collaborator record attaches to.
   */
  private async canEditDocCollaborator (
    ctx: MeasureContext<SessionData>,
    tx: TxCUD<Doc>,
    account: Account
  ): Promise<boolean> {
    const allowed = await this.classAccess.allowedClasses(ctx, account.role, core.class.TxCreateDoc)
    if (!allowed.has(core.class.Collaborator)) return false
    if (tx.attachedTo === undefined || tx.attachedToClass === undefined) return false
    const parents = await this.findAll(ctx, tx.attachedToClass, { _id: tx.attachedTo }, { limit: 1 })
    const parent = parents[0] as (Doc & { createdBy?: PersonId }) | undefined
    return parent?.createdBy !== undefined && account.socialIds.includes(parent.createdBy)
  }

  /** Checks whether a mutation targets a row visible to the caller. */
  private async canMutateVisibleRow (
    ctx: MeasureContext<SessionData>,
    tx: TxCUD<Doc>,
    account: Account
  ): Promise<boolean> {
    const identity = new AccountIdentityResolver(this.next, ctx, account)
    if (
      this.context.hierarchy.isDerived(tx.objectClass, core.class.Collaborator) &&
      (tx._class === core.class.TxCreateDoc || tx._class === core.class.TxRemoveDoc)
    ) {
      return await this.canEditDocCollaborator(ctx, tx, account)
    }
    if (tx._class === core.class.TxCreateDoc) {
      if (
        this.context.hierarchy.isDerived(tx.objectClass, contact.class.SocialIdentity) &&
        !account.socialIds.includes(tx.objectId as unknown as PersonId)
      ) {
        return false
      }
      const doc = TxProcessor.createDoc2Doc(tx as TxCreateDoc<Doc>)
      return await this.rowVisibility.canCreate(ctx, this.context.hierarchy, tx.objectClass, doc, identity)
    }
    if (
      (tx._class === core.class.TxUpdateDoc || tx._class === core.class.TxMixin) &&
      this.context.hierarchy.isDerived(tx.objectClass, APPROVE_REQUEST_CLASS)
    ) {
      const allowed = await this.classAccess.allowedClasses(ctx, account.role, core.class.TxCreateDoc)
      if (!allowed.has(APPROVE_REQUEST_CLASS)) return false
    }
    const query: DocumentQuery<Doc> = { _id: tx.objectId }
    const decision = await this.rowVisibility.resolveMutation(
      ctx,
      this.context.hierarchy,
      tx.objectClass,
      query,
      identity
    )
    if (decision.kind === 'deny') return false
    if (decision.kind === 'unrestricted') return true
    const docs = await this.findAll(ctx, tx.objectClass, decision.query, { limit: 1 })
    const doc = docs[0]
    if (doc === undefined) return false
    if (tx._class === core.class.TxUpdateDoc || tx._class === core.class.TxMixin) {
      return await this.rowVisibility.canUpdate(
        ctx,
        this.context.hierarchy,
        tx.objectClass,
        doc,
        tx as TxUpdateDoc<Doc> | TxMixin<Doc, Doc>,
        identity
      )
    }
    return true
  }

  private async isForbiddenTx (ctx: MeasureContext, tx: TxCUD<Doc>, account: Account): Promise<boolean> {
    if (!(await isClassAccessAllowed(this.context.hierarchy, this, this.classAccess, ctx, tx, account))) return true
    return !(await this.canMutateVisibleRow(ctx, tx, account))
  }

  private async isForbiddenSpaceTx (ctx: MeasureContext, tx: TxCUD<Space>, account: Account): Promise<boolean> {
    if (tx._class === core.class.TxRemoveDoc) return true
    if (tx._class === core.class.TxCreateDoc) {
      return !(await hasClassAccessLevel(this.context.hierarchy, this, ctx, tx, account))
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
}
