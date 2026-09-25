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
import { instrumentClient, type ProcessMeasurements } from '../telemetry'

function makeContext (): MeasureContext {
  const ctx = {
    with: jest.fn(
      async (_name: string, _params: object, op: (ctx: MeasureContext) => unknown): Promise<unknown> =>
        await op(ctx as unknown as MeasureContext)
    )
  }
  return ctx as unknown as MeasureContext
}

it('preserves receivers, arguments and results without changing the cached client', async () => {
  const result = { _id: 'result' }
  const target = {
    result,
    findOne: jest.fn(async function (this: { result: object }) {
      return this.result
    }),
    getModel: function () {
      return this.result
    }
  }
  const ctx = makeContext()
  const totals: ProcessMeasurements = { rest_calls: 0, rest_ms: 0, rest_errors: 0 }
  const client = instrumentClient(target as unknown as TxOperations, ctx, totals)
  const args = ['class', { _id: 'doc' }]
  expect(await Reflect.apply(client.findOne.bind(client), client, args)).toBe(result)
  expect(target.findOne).toHaveBeenCalledWith(...args)
  expect(client.getModel()).toBe(result)
  expect(totals.rest_calls).toBe(1)
  expect(totals.rest_ms).toBeGreaterThanOrEqual(0)
  expect(Reflect.get(ctx, 'with')).toHaveBeenCalledWith('process.rest.findOne', {}, expect.any(Function), undefined, {
    span: 'inherit'
  })
  expect(Reflect.get(client, 'findOne')).not.toBe(target.findOne)
})

it('propagates the original failure and counts it once', async () => {
  const error = new Error('request failed')
  const target = { tx: jest.fn().mockRejectedValue(error) } as unknown as TxOperations
  const totals: ProcessMeasurements = { rest_calls: 0, rest_ms: 0, rest_errors: 0 }
  const client = instrumentClient(target, makeContext(), totals)
  await expect(Reflect.apply(client.tx.bind(client), client, [{}])).rejects.toBe(error)
  expect(totals.rest_calls).toBe(1)
  expect(totals.rest_errors).toBe(1)
})

it('keeps measurements separate when events share a cached client', async () => {
  const target = { findAll: jest.fn().mockResolvedValue([]) } as unknown as TxOperations
  const first: ProcessMeasurements = { rest_calls: 0, rest_ms: 0, rest_errors: 0 }
  const second: ProcessMeasurements = { rest_calls: 0, rest_ms: 0, rest_errors: 0 }
  const a = instrumentClient(target, makeContext(), first)
  const b = instrumentClient(target, makeContext(), second)
  await Promise.all([Reflect.apply(a.findAll.bind(a), a, []), Reflect.apply(b.findAll.bind(b), b, [])])
  expect(first.rest_calls).toBe(1)
  expect(second.rest_calls).toBe(1)
})
