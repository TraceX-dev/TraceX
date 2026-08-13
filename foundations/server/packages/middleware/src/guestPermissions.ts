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
  hasAccountRole,
  type MeasureContext,
  type SessionData,
  type Space,
  type Tx,
  type TxApplyIf,
  type TxCUD,
  TxProcessor,
  type TxUpdateDoc
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import { ClassAccessResolver, hasClassAccessLevel, isClassAccessAllowed } from './accessGate'

export class GuestPermissionsMiddleware extends BaseMiddleware implements Middleware {
  // `this`, not `this.next`: routes through `this.findAll` so a subclass/test override of it is
  // honored, same as the rest of this middleware's lookups (isGuestMutationOnOwnDoc, etc.)
  private readonly classAccess = new ClassAccessResolver(this)

  static async create (
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<GuestPermissionsMiddleware> {
    return new GuestPermissionsMiddleware(context, next)
  }

  private invalidateCacheIfNeeded (txes: Tx[]): void {
    for (const tx of txes) {
      if (TxProcessor.isExtendsCUD(tx._class)) {
        const cudTx = tx as TxCUD<Doc>
        if (cudTx.objectClass === core.class.ModulePermissionGroup) {
          this.classAccess.invalidate()
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
      throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
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

  private async isForbiddenTx (ctx: MeasureContext, tx: TxCUD<Doc>, account: Account): Promise<boolean> {
    if (tx._class === core.class.TxMixin) return false

    if (await isClassAccessAllowed(this.context.hierarchy, this, this.classAccess, ctx, tx, account)) {
      return false
    }

    if (tx._class === core.class.TxUpdateDoc || tx._class === core.class.TxRemoveDoc) {
      if (await this.isGuestMutationOnOwnDoc(ctx, tx, account)) {
        return false
      }
    }

    return true
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
