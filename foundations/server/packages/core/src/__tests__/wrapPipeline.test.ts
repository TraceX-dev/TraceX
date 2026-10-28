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
  MeasureMetricsContext,
  toFindResult,
  type CustomSequence,
  type Doc,
  type DocumentQuery,
  type Ref
} from '@hcengineering/core'
import type { Pipeline } from '../types'
import { wrapPipeline } from '../utils'

/**
 * LookupMiddleware removes simple query values from found documents to make the payload compact
 * (remote clients put them back). The in-process client created by wrapPipeline must do the same,
 * otherwise `findOne(_class, { _id })` returns a document without `_id` and any following update
 * is rejected as an invalid tx (this broke workspace initialization with controlled documents).
 */
function createPipeline (stored: Doc[]): Pipeline {
  return {
    context: {
      hierarchy: { updateLookupMixin: (_class: any, doc: any) => doc },
      modelDb: {},
      lowLevelStorage: {}
    },
    findAll: async (_ctx: any, _class: any, query: DocumentQuery<Doc>) => {
      const found = stored.filter((doc) => Object.entries(query).every(([k, v]) => (doc as any)[k] === v))
      return toFindResult(
        found.map((doc) => {
          const copy: any = { ...doc }
          for (const [k, v] of Object.entries(query)) {
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
              // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
              delete copy[k]
            }
          }
          return copy
        })
      )
    }
  } as unknown as Pipeline
}

describe('wrapPipeline', () => {
  const ctx = new MeasureMetricsContext('test', {})
  const id = 'doc1' as Ref<CustomSequence>
  const doc: Doc = {
    _id: id,
    _class: core.class.CustomSequence,
    space: core.space.Workspace,
    modifiedOn: 1,
    modifiedBy: 'u1' as any,
    createdBy: 'u1' as any,
    createdOn: 1
  }

  const client = (): ReturnType<typeof wrapPipeline> => wrapPipeline(ctx, createPipeline([doc]), { uuid: 'ws' } as any)

  it('findOne by _id keeps _id of the found document', async () => {
    const found = await client().findOne(core.class.CustomSequence, { _id: id })
    expect(found?._id).toBe(id)
    expect(found?._class).toBe(core.class.CustomSequence)
  })

  it('findAll restores every simple query value', async () => {
    const found = await client().findAll(core.class.CustomSequence, { _id: id, space: core.space.Workspace })
    expect(found).toHaveLength(1)
    expect(found[0]._id).toBe(id)
    expect(found[0].space).toBe(core.space.Workspace)
  })
})
