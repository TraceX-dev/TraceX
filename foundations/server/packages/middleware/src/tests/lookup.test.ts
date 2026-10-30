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

import core, { type CustomSequence, type Doc, MeasureMetricsContext, type Ref, toFindResult } from '@hcengineering/core'
import type { PipelineContext } from '@hcengineering/server-core'
import { LookupMiddleware } from '../lookup'

describe('LookupMiddleware', () => {
  const id = 'seq1' as Ref<CustomSequence>
  const stored: Doc = {
    _id: id,
    _class: core.class.CustomSequence,
    space: core.space.Workspace,
    modifiedOn: 1,
    modifiedBy: 'u1' as any,
    createdBy: 'u1' as any,
    createdOn: 1
  }

  async function find (inProcess?: boolean): Promise<Doc[]> {
    const next = { findAll: async () => toFindResult([{ ...stored }]) }
    const middleware = await LookupMiddleware.create(
      new MeasureMetricsContext('test', {}),
      {} as unknown as PipelineContext,
      next as any
    )
    const ctx = new MeasureMetricsContext('test', {})
    ;(ctx as any).contextData = { inProcess }
    return await middleware.findAll(ctx as any, core.class.CustomSequence, { _id: id })
  }

  it('strips simple query values for remote clients', async () => {
    const [doc] = await find()
    expect(doc._id).toBeUndefined()
  })

  it('returns documents as is for in-process callers', async () => {
    const [doc] = await find(true)
    expect(doc._id).toBe(id)
  })
})
