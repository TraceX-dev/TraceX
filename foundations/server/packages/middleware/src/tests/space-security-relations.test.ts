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
  AccountRole,
  DOMAIN_MODEL,
  Hierarchy,
  MeasureMetricsContext,
  type AccountUuid,
  type Doc,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  systemAccountUuid,
  toFindResult,
  type WithLookup
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { SpaceSecurityMiddleware } from '../spaceSecurity'

const ALLOWED_SPACE = 'test:space:allowed' as Ref<Space>
const PRIVATE_SPACE = 'test:space:private' as Ref<Space>

function makeDoc (id: string, space = ALLOWED_SPACE): WithLookup<Doc> {
  return {
    _id: id as Ref<Doc>,
    _class: core.class.Doc,
    space,
    modifiedBy: 'test:person:author' as PersonId,
    modifiedOn: 0
  }
}

function makeSpace (id: Ref<Space>): WithLookup<Space> {
  return {
    _id: id,
    _class: core.class.Space,
    space: ALLOWED_SPACE,
    modifiedBy: 'test:person:author' as PersonId,
    modifiedOn: 0,
    name: id,
    description: '',
    private: true,
    members: [],
    archived: false
  }
}

async function makeMiddleware (
  doc: WithLookup<Doc>,
  role = AccountRole.User,
  system = false,
  adapterSecurity = false
): Promise<{
  middleware: SpaceSecurityMiddleware
  ctx: MeasureContext<SessionData>
}> {
  const hierarchy = new Hierarchy()
  jest.spyOn(hierarchy, 'getDomain').mockReturnValue(DOMAIN_MODEL)
  jest.spyOn(hierarchy, 'isDerived').mockImplementation((clazz, base) => clazz === base)
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account: { uuid: system ? systemAccountUuid : ('test:account:user' as AccountUuid), role }
  } as unknown as SessionData
  const context = { hierarchy } as unknown as PipelineContext
  const next = { findAll: async () => toFindResult([doc], 1) } as unknown as Middleware
  const middleware = await SpaceSecurityMiddleware.create(adapterSecurity, ctx, context, next)
  middleware.wasInit = true
  jest
    .spyOn(middleware as unknown as { getAllAllowedSpaces: () => Ref<Space>[] }, 'getAllAllowedSpaces')
    .mockReturnValue([ALLOWED_SPACE])
  return { middleware, ctx }
}

describe('space security for relation targets', () => {
  it('hides inaccessible targets and preserves the source and reference attribute', async () => {
    const hidden = makeDoc('hidden', PRIVATE_SPACE)
    const visible = makeDoc('visible')
    const source = { ...makeDoc('source'), reference: hidden._id, $associations: { relation_b: [hidden, visible] } }
    const { middleware, ctx } = await makeMiddleware(source)

    const result = await middleware.findAll(ctx, core.class.Doc, {}, { associations: [] })

    expect(result[0].$associations?.relation_b).toEqual([visible])
    expect(result[0]).toMatchObject({ reference: hidden._id })
    expect(result.total).toBe(1)
    expect(source.$associations.relation_b).toEqual([hidden, visible])
  })

  it('filters nested relations and lookups without changing shared results', async () => {
    const hidden = makeSpace(PRIVATE_SPACE)
    const visible = { ...makeSpace(ALLOWED_SPACE), $associations: { nested_b: [hidden] }, $lookup: { space: hidden } }
    const source = { ...makeDoc('source'), $associations: { relation_b: [visible] }, $lookup: { space: visible } }
    const { middleware, ctx } = await makeMiddleware(source)

    const result = await middleware.findAll(ctx, core.class.Doc, {}, { associations: [] })

    expect(result[0].$associations?.relation_b[0].$associations?.nested_b).toEqual([])
    expect(result[0].$associations?.relation_b[0].$lookup?.space).toBeUndefined()
    expect((result[0].$lookup?.space as WithLookup<Space>).$associations?.nested_b).toEqual([])
    expect(visible.$associations.nested_b).toEqual([hidden])
    expect(visible.$lookup.space).toBe(hidden)
  })

  it('does not grant owners access to documents in private spaces', async () => {
    const hidden = makeDoc('hidden', PRIVATE_SPACE)
    const source = { ...makeDoc('source'), $associations: { relation_b: [hidden] } }
    const { middleware, ctx } = await makeMiddleware(source, AccountRole.Owner)

    const result = await middleware.findAll(ctx, core.class.Doc, {}, { associations: [] })

    expect(result[0].$associations?.relation_b).toEqual([])
  })

  it('preserves unrestricted system queries', async () => {
    const hidden = makeDoc('hidden', PRIVATE_SPACE)
    const source = { ...makeDoc('source'), $associations: { relation_b: [hidden] } }
    const { middleware, ctx } = await makeMiddleware(source, AccountRole.User, true)

    const result = await middleware.findAll(ctx, core.class.Doc, {}, { associations: [] })

    expect(result[0]).toBe(source)
    expect(result[0].$associations?.relation_b).toEqual([hidden])
  })

  it('preserves association targets authorized by an adapter through collaborators', async () => {
    const shared = makeDoc('shared', PRIVATE_SPACE)
    const source = { ...makeDoc('source'), $associations: { relation_b: [shared] } }
    const { middleware, ctx } = await makeMiddleware(source, AccountRole.Guest, false, true)

    const result = await middleware.findAll(ctx, core.class.Doc, {}, { associations: [] })

    expect(result[0].$associations?.relation_b).toEqual([shared])
  })
})
