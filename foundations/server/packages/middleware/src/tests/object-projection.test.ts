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

import {
  type Class,
  type Doc,
  Hierarchy,
  type MeasureContext,
  MeasureMetricsContext,
  type Ref,
  type SessionData,
  toFindResult
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import view, { type ObjectPresenter } from '@hcengineering/view'
import { FindSecurityMiddleware } from '../findSecurity'
import { ObjectProjectionMiddleware } from '../object-projection'

const TARGET_CLASS = 'test:class:Target' as Ref<Class<Doc>>

async function setup (requiredFields?: string[]): Promise<{
  middleware: FindSecurityMiddleware
  findAll: jest.Mock
  presenterLookup: jest.SpyInstance
  ctx: MeasureContext<SessionData>
}> {
  const hierarchy = new Hierarchy()
  const presenterLookup = jest
    .spyOn(hierarchy, 'classHierarchyMixin')
    .mockReturnValue(requiredFields === undefined ? undefined : ({ requiredFields } as unknown as ObjectPresenter))
  const context = { hierarchy } as unknown as PipelineContext
  const findAll = jest.fn(async () => toFindResult([], 0))
  const next = { findAll } as unknown as Middleware
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  const projection = await ObjectProjectionMiddleware.create(ctx, context, next)
  const middleware = await FindSecurityMiddleware.create(ctx, context, projection)
  return { middleware, findAll, presenterLookup, ctx }
}

describe('unsecured object projection', () => {
  it('replaces client projection with presenter fields and mandatory identity fields', async () => {
    const { middleware, findAll, presenterLookup, ctx } = await setup(['title', 'version'])
    const options = { unsecured: true, projection: { modifiedBy: 1 as const, space: 0 as const }, limit: 1 }
    const query = { _id: 'target' as Ref<Doc> }

    await middleware.findAll(ctx, TARGET_CLASS, query, options)

    expect(presenterLookup).toHaveBeenCalledWith(TARGET_CLASS, view.mixin.ObjectPresenter)
    expect(findAll).toHaveBeenCalledWith(
      ctx,
      TARGET_CLASS,
      query,
      expect.objectContaining({
        unsecured: true,
        limit: 1,
        projection: { title: 1, version: 1, _id: 1, _class: 1, space: 1 }
      })
    )
    expect(options.projection).toEqual({ modifiedBy: 1, space: 0 })
  })

  it('removes unsecured and preserves client projection without declared presenter fields', async () => {
    const { middleware, findAll, ctx } = await setup()
    const projection = { modifiedBy: 1 as const }
    const options = { unsecured: true, projection, limit: 1 }

    await middleware.findAll(ctx, TARGET_CLASS, {}, options)

    expect(findAll.mock.calls[0][3]).not.toHaveProperty('unsecured')
    expect(findAll.mock.calls[0][3].projection).toBe(projection)
    expect(findAll.mock.calls[0][3].limit).toBe(1)
    expect(options.unsecured).toBe(true)
  })

  it('returns only identity fields for an explicitly empty field list', async () => {
    const { middleware, findAll, ctx } = await setup([])

    await middleware.findAll(ctx, TARGET_CLASS, {}, { unsecured: true })

    expect(findAll.mock.calls[0][3].projection).toEqual({ _id: 1, _class: 1, space: 1 })
  })

  it.each([undefined, false])('preserves normal projection when unsecured is %s', async (unsecured) => {
    const { middleware, findAll, presenterLookup, ctx } = await setup(['title'])
    const projection = { modifiedBy: 1 as const }

    await middleware.findAll(ctx, TARGET_CLASS, {}, { unsecured, projection })

    expect(findAll.mock.calls[0][3].projection).toBe(projection)
    expect(presenterLookup).not.toHaveBeenCalled()
  })
})
