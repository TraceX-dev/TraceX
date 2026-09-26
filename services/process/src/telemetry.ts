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

import type { MeasureContext, TxOperations } from '@hcengineering/core'
import { performance } from 'node:perf_hooks'

export interface ProcessMeasurements {
  rest_calls: number
  rest_ms: number
  rest_errors: number
  outcome?: 'handled' | 'ignored' | 'duplicate' | 'error'
}

const REST_METHODS = new Set(['findAll', 'findOne', 'tx', 'domainRequest', 'searchFulltext'])

/** Measure logical REST operations without modifying the shared cached client. */
export function instrumentClient (
  client: TxOperations,
  ctx: MeasureContext,
  measurements: ProcessMeasurements
): TxOperations {
  return new Proxy(client, {
    get (target, property) {
      const value: unknown = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value
      if (typeof property !== 'string' || !REST_METHODS.has(property)) return value.bind(target)
      return async (...args: unknown[]) => {
        const started = performance.now()
        measurements.rest_calls++
        try {
          return await ctx.with(
            `process.rest.${property}`,
            {},
            async () => await Reflect.apply(value, target, args),
            undefined,
            { span: 'inherit' }
          )
        } catch (err) {
          measurements.rest_errors++
          throw err
        } finally {
          measurements.rest_ms += performance.now() - started
        }
      }
    }
  })
}
