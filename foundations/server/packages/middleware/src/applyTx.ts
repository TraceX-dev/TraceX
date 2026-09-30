//
// Copyright © 2024 Hardcore Engineering Inc.
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
  type MeasureContext,
  type Tx,
  type TxApplyIf,
  type TxApplyResult,
  type TxResult
} from '@hcengineering/core'
import type { Middleware, PipelineContext, TxMiddlewareResult } from '@hcengineering/server-core'
import { BaseMiddleware } from '@hcengineering/server-core'

/**
 * Will support apply tx
 * @public
 */
export class ApplyTxMiddleware extends BaseMiddleware implements Middleware {
  scopes = new Map<string, Promise<any>>()

  static async create (ctx: MeasureContext, context: PipelineContext, next?: Middleware): Promise<Middleware> {
    return new ApplyTxMiddleware(context, next)
  }

  async tx (ctx: MeasureContext, txes: Tx[]): Promise<TxMiddlewareResult> {
    const result: TxResult[] = []

    let part: Tx[] = []
    for (const tx of txes) {
      if (this.context.hierarchy.isDerived(tx._class, core.class.TxApplyIf)) {
        if (part.length > 0) {
          // Plain txes that precede an apply must be passed on, not dropped.
          const plain = part
          part = []
          result.push(await this.provideTx(ctx, plain))
        }
        const applyIf = tx as TxApplyIf
        // Wait for scope promise if found
        const passed =
          applyIf.scope != null ? await this.verifyApplyIf(ctx, applyIf) : { passed: true, onEnd: () => {} }
        try {
          if (passed.passed) {
            const applyResult: TxApplyResult = {
              success: true,
              serverTime: 0
            }
            result.push(applyResult)

            const st = Date.now()
            const r = await this.provideTx(ctx, applyIf.txes)
            if (Object.keys(r).length > 0) {
              result.push(r)
            }
            applyResult.serverTime = Date.now() - st
          } else {
            ctx.warn('TxApplyIf failed', {
              scope: applyIf.scope,
              reason: passed.reason,
              measureName: applyIf.measureName,
              matchCount: applyIf.match?.length ?? 0,
              notMatchCount: applyIf.notMatch?.length ?? 0,
              txCount: applyIf.txes.length
            })
            result.push({
              success: false
            })
          }
        } finally {
          passed.onEnd()
        }
      } else {
        part.push(tx)
      }
    }
    if (part.length > 0) {
      result.push(await this.provideTx(ctx, part))
    }
    if (Array.isArray(result) && result.length === 1) {
      return result[0]
    }
    return result
  }

  /**
   * Verify if apply if is possible to apply.
   */
  async verifyApplyIf (
    ctx: MeasureContext,
    applyIf: TxApplyIf
  ): Promise<{
    onEnd: () => void
    passed: boolean
    reason?: string
  }> {
    if (applyIf.scope == null) {
      return { passed: true, onEnd: () => {} }
    }
    const scope = applyIf.scope
    // Wait until no other apply holds the scope: several waiters may wake up on the same promise,
    // so the scope is checked again after every wait.
    let scopePromise = this.scopes.get(scope)
    while (scopePromise != null) {
      await scopePromise
      scopePromise = this.scopes.get(scope)
    }

    let release: () => void = () => {}
    const lock = new Promise<null>((resolve) => {
      release = () => {
        resolve(null)
      }
    })
    this.scopes.set(scope, lock)
    const onEnd = (): void => {
      if (this.scopes.get(scope) === lock) this.scopes.delete(scope)
      release()
    }

    let passed = true
    let reason: string | undefined
    try {
      if (applyIf.match != null) {
        for (const { _class, query } of applyIf.match) {
          const res = await this.provideFindAll(ctx, _class, query, { limit: 1 })
          if (res.length === 0) {
            passed = false
            reason = `match query failed: class=${_class}, query=${JSON.stringify(query)}`
            break
          }
        }
      }
      if (passed && applyIf.notMatch != null) {
        for (const { _class, query } of applyIf.notMatch) {
          const res = await this.provideFindAll(ctx, _class, query, { limit: 1 })
          if (res.length > 0) {
            passed = false
            reason = `notMatch query failed: class=${_class}, query=${JSON.stringify(query)} (found ${res.length} matching document(s))`
            break
          }
        }
      }
    } catch (err: unknown) {
      // A failed check must release the scope, otherwise every later apply in the scope hangs.
      onEnd()
      throw err
    }
    return { passed, onEnd, reason }
  }
}
