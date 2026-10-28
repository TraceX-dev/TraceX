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

import core, {
  type CustomSequence,
  MeasureMetricsContext,
  type PersonId,
  type Ref,
  type Space,
  TxFactory
} from '@hcengineering/core'
import platform from '@hcengineering/platform'
import type { PipelineContext } from '@hcengineering/server-core'
import { describeInvalidTx, NormalizeTxMiddleware } from '../normalizeTx'

describe('NormalizeTxMiddleware', () => {
  const factory = new TxFactory('test:account' as PersonId)

  async function create (): Promise<{ middleware: NormalizeTxMiddleware, error: jest.Mock }> {
    const error = jest.fn()
    const ctx = new MeasureMetricsContext('test', {})
    ;(ctx as any).error = error
    const next = { tx: async () => ({}) }
    const middleware = await NormalizeTxMiddleware.create(ctx, {} as unknown as PipelineContext, next as any)
    return { middleware, error }
  }

  it('describes the rejected tx without leaking values', async () => {
    const { middleware, error } = await create()
    const tx = factory.createTxUpdateDoc(
      core.class.CustomSequence,
      undefined as unknown as Ref<Space>,
      'sequence:id' as Ref<CustomSequence>,
      { $inc: { sequence: 1 } },
      true
    )
    const ctx = new MeasureMetricsContext('test', {})
    ;(ctx as any).error = error

    // tx() throws synchronously, so call it inside an async function to get a rejected promise
    await expect((async () => await middleware.tx(ctx as any, [tx]))()).rejects.toMatchObject({
      status: { code: platform.status.BadRequest }
    })

    expect(error).toHaveBeenCalledWith(
      'Rejected invalid tx',
      expect.objectContaining({
        _class: core.class.TxUpdateDoc,
        objectClass: core.class.CustomSequence,
        fields: expect.objectContaining({ objectSpace: 'undefined', operations: 'object' })
      })
    )
    expect(JSON.stringify(error.mock.calls)).not.toContain('sequence:id')
  })

  it('describes non-object input', () => {
    expect(describeInvalidTx(null)).toEqual({ type: 'null' })
    expect(describeInvalidTx(42)).toEqual({ type: 'number' })
  })
})
