//
// Copyright © 2025 Hardcore Engineering Inc.
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
  type Class,
  clone,
  type Doc,
  type DocumentQuery,
  type FindResult,
  type MeasureContext,
  type Ref,
  type SessionData,
  SortingOrder,
  type Tx,
  type TxApplyIf,
  type TxCreateDoc,
  type TxCUD,
  TxFactory,
  TxProcessor,
  type TxUpdateDoc,
  type VersionableDoc
} from '@hcengineering/core'
import {
  BaseMiddleware,
  type ServerFindOptions,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'

/**
 * @public
 */
export class VersioningMiddleware extends BaseMiddleware implements Middleware {
  private constructor(context: PipelineContext, next?: Middleware) {
    super(context, next)
  }

  static async create(
    ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<VersioningMiddleware> {
    return new VersioningMiddleware(context, next)
  }

  override async findAll<T extends Doc>(
    ctx: MeasureContext<SessionData>,
    _class: Ref<Class<T>>,
    query: DocumentQuery<T>,
    options?: ServerFindOptions<T>
  ): Promise<FindResult<T>> {
    if (
      this.isVerionableClass(_class) &&
      query.isLatest === undefined &&
      query._id === undefined &&
      query.baseId === undefined
    ) {
      const newQuery = clone(query)
      newQuery.isLatest = true

      const findResult = await this.provideFindAll(ctx, _class, newQuery, options)

      return findResult
    } else {
      return await this.provideFindAll(ctx, _class, query, options)
    }
  }

  async tx(ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const nestedTxes: Tx[] = []
    const effectiveTxes: Array<TxCUD<Doc>> = []
    const effectiveVersions = new Map<Ref<Doc>, Ref<Doc>>()
    const versionCreationDisabledUpdates = this.getVersionCreationDisabledUpdates(txes)
    for (const tx of [...txes]) {
      if (tx._class === core.class.TxCreateDoc) {
        const childTxes = await this.setVersionData(
          ctx,
          tx as TxCreateDoc<VersionableDoc>,
          versionCreationDisabledUpdates
        )
        nestedTxes.push(...childTxes)
      } else if (tx._class === core.class.TxUpdateDoc) {
        const childTxes = await this.setEffectiveVersion(ctx, tx as TxUpdateDoc<VersionableDoc>, effectiveVersions)
        effectiveTxes.push(...childTxes)
      }
      if (tx._class === core.class.TxApplyIf) {
        const applyIf = tx as TxApplyIf
        const applyTxes: Array<TxCUD<Doc>> = []
        for (const _tx of [...applyIf.txes]) {
          if (_tx._class === core.class.TxCreateDoc) {
            const childTxes = await this.setVersionData(
              ctx,
              _tx as TxCreateDoc<VersionableDoc>,
              versionCreationDisabledUpdates
            )
            applyTxes.push(...childTxes)
          } else if (_tx._class === core.class.TxUpdateDoc) {
            const childTxes = await this.setEffectiveVersion(ctx, _tx as TxUpdateDoc<VersionableDoc>, effectiveVersions)
            applyTxes.push(...childTxes)
          }
        }
        applyIf.txes.push(...applyTxes)
      }
    }
    txes.push(...effectiveTxes)
    const res = await this.provideTx(ctx, txes)
    if (nestedTxes.length > 0) {
      await this.provideTx(ctx, nestedTxes)
    }
    return res
  }

  private async setVersionData(
    ctx: MeasureContext<SessionData>,
    tx: TxCreateDoc<VersionableDoc>,
    versionCreationDisabledUpdates: Map<Ref<Doc>, boolean>
  ): Promise<Array<TxCUD<Doc>>> {
    const isVersionedClass = this.isVerionableClass(tx.objectClass)
    if (!isVersionedClass) return []
    const versioningEnabled = this.isVersioningEnabled(tx.objectClass)
    const doc = TxProcessor.createDoc2Doc(tx)
    const isNew = doc.baseId === doc._id || doc.baseId === undefined
    tx.attributes.isLatest = true
    if (isNew) {
      tx.attributes.version = 1
      tx.attributes.baseId = tx.objectId
      if (versioningEnabled) {
        tx.attributes.isEffective = true
      } else {
        delete tx.attributes.isEffective
        delete tx.attributes.versionCreationDisabled
      }
      tx.attributes.docCreatedBy = tx.createdBy ?? tx.modifiedBy
    } else {
      if (versioningEnabled) {
        tx.attributes.isEffective = false
      } else {
        delete tx.attributes.isEffective
        delete tx.attributes.versionCreationDisabled
      }
      const base = await this.provideFindAll(
        ctx,
        tx.objectClass,
        { baseId: doc.baseId },
        { sort: { version: SortingOrder.Descending } }
      )
      const latest = base.find((p) => p.isLatest === true) ?? base[0]
      if (latest === undefined) throw new Error('No base object found for the new version')
      const versionCreationDisabled = versionCreationDisabledUpdates.get(latest._id)
      if (latest.versionCreationDisabled === true && versionCreationDisabled !== false) {
        throw new Error('New version creation is currently disabled')
      }
      tx.attributes.versionCreationDisabled = versionCreationDisabled ?? tx.attributes.versionCreationDisabled === true
      tx.attributes.version = (latest.version ?? 1) + 1
      tx.attributes.docCreatedBy = latest.docCreatedBy
      const txes: Array<TxCUD<Doc>> = []
      const factory = new TxFactory(core.account.System, true)
      for (const prev of base) {
        if (prev.isLatest === true) {
          txes.push(
            factory.createTxUpdateDoc(prev._class, prev.space, prev._id, {
              isLatest: false,
              readonly: true
            })
          )
        }
      }
      return txes
    }
    return []
  }

  private getVersionCreationDisabledUpdates(txes: Tx[]): Map<Ref<Doc>, boolean> {
    const result = new Map<Ref<Doc>, boolean>()
    const collect = (tx: Tx): void => {
      if (tx._class === core.class.TxUpdateDoc) {
        const update = tx as TxUpdateDoc<VersionableDoc>
        if (typeof update.operations.versionCreationDisabled === 'boolean') {
          result.set(update.objectId, update.operations.versionCreationDisabled)
        } else if (update.operations.$unset?.versionCreationDisabled !== undefined) {
          result.set(update.objectId, false)
        }
      } else if (tx._class === core.class.TxApplyIf) {
        for (const nested of (tx as TxApplyIf).txes) collect(nested)
      }
    }
    for (const tx of txes) collect(tx)
    return result
  }

  private async setEffectiveVersion(
    ctx: MeasureContext<SessionData>,
    tx: TxUpdateDoc<VersionableDoc>,
    effectiveVersions: Map<Ref<Doc>, Ref<Doc>>
  ): Promise<Array<TxCUD<Doc>>> {
    const hasEffectiveUpdate =
      Object.prototype.hasOwnProperty.call(tx.operations, 'isEffective') ||
      TxProcessor.hasUpdate(tx.operations, 'isEffective')
    if (!hasEffectiveUpdate) return []
    if (!this.isVersioningEnabled(tx.objectClass)) {
      throw new Error('Versioning is not enabled for this class')
    }
    if (tx.operations.isEffective !== true) {
      throw new Error('An effective version can only be changed by making a newer version effective')
    }

    const target = (await this.provideFindAll(ctx, tx.objectClass, { _id: tx.objectId }, { limit: 1 }))[0] as
      | VersionableDoc
      | undefined
    if (target === undefined) throw new Error('Version not found')

    const baseId = target.baseId ?? target._id
    const requestedVersion = effectiveVersions.get(baseId)
    if (requestedVersion !== undefined && requestedVersion !== target._id) {
      throw new Error('Only one version can be made effective in a transaction')
    }
    effectiveVersions.set(baseId, target._id)

    const versions = await this.provideFindAll(ctx, tx.objectClass, { baseId })
    const currentEffective = versions.filter((version) => version.isEffective === true)
    const latestEffectiveVersion = currentEffective.reduce((latest, version) => {
      return Math.max(latest, version.version ?? 1)
    }, 0)
    if ((target.version ?? 1) <= latestEffectiveVersion) {
      throw new Error('A version can only become effective if it is newer than the current effective version')
    }

    const factory = new TxFactory(core.account.System, true)
    return currentEffective.map((version) =>
      factory.createTxUpdateDoc(version._class, version.space, version._id, { isEffective: false })
    )
  }

  private isVerionableClass(_class: Ref<Class<Doc>>): boolean {
    try {
      return this.context.hierarchy.classHierarchyMixin(_class, core.mixin.VersionableClass) !== undefined
    } catch {
      return false
    }
  }

  private isVersioningEnabled(_class: Ref<Class<Doc>>): boolean {
    try {
      return this.context.hierarchy.classHierarchyMixin(_class, core.mixin.VersionableClass)?.enabled === true
    } catch {
      return false
    }
  }
}
