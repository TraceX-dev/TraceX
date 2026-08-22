import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'
import core, {
  type Account,
  AccountRole,
  type Doc,
  type DocumentQuery,
  hasAccountRole,
  type MeasureContext,
  type PersonId,
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

export class GuestPermissionsMiddleware extends BaseMiddleware implements Middleware {
  // `this`, not `this.next`: routes through `this.findAll` so a subclass/test override of it is
  // honored, the same as the row-policy ownership checks below.
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

    for (const tx of txes) {
      await this.processTx(ctx, tx)
    }

    return await this.provideTx(ctx, txes)
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

  /** Enforce a declared row policy for mutations without treating a caller-supplied id as trusted. */
  private async canMutateVisibleRow (
    ctx: MeasureContext<SessionData>,
    tx: TxCUD<Doc>,
    account: Account
  ): Promise<boolean> {
    const identity = new AccountIdentityResolver(this.next, ctx, account)
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
