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

import core, { MeasureMetricsContext, toFindResult, type MeasureContext, type SessionData } from '@hcengineering/core'
import type { Pipeline } from '../types'
import { wrapPipeline } from '../utils'

/**
 * The in-process client must mark its context, so middlewares (e.g. LookupMiddleware) do not apply
 * the compaction meant for remote clients: otherwise `findOne(_class, { _id })` returns a document
 * without `_id` and a following update is rejected as an invalid tx
 * (this broke workspace initialization with controlled documents).
 */
describe('wrapPipeline', () => {
  it('marks the pipeline context as in-process', async () => {
    const seen: Array<boolean | undefined> = []
    const pipeline = {
      context: {
        hierarchy: { updateLookupMixin: (_class: any, doc: any) => doc },
        modelDb: {},
        lowLevelStorage: {}
      },
      findAll: async (ctx: MeasureContext<SessionData>) => {
        seen.push(ctx.contextData.inProcess)
        return toFindResult([])
      }
    } as unknown as Pipeline

    const client = wrapPipeline(new MeasureMetricsContext('test', {}), pipeline, { uuid: 'ws' } as any)
    await client.findAll(core.class.CustomSequence, {})
    await client.findOne(core.class.CustomSequence, {})

    expect(seen).toEqual([true, true])
  })
})
