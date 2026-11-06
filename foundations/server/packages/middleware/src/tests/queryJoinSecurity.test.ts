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
  type Account,
  AccountRole,
  type AccountUuid,
  type Class,
  type Doc,
  type Domain,
  type DocumentQuery,
  Hierarchy,
  type MeasureContext,
  MeasureMetricsContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  toFindResult
} from '@hcengineering/core'
import type { Middleware, PipelineContext, ServerFindOptions } from '@hcengineering/server-core'
import { QueryJoinMiddleware } from '../queryJoin'
import { SpaceSecurityMiddleware } from '../spaceSecurity'

/**
 * Reproduces sharing of a joined query between requests with different access when the security filter is applied
 * by the adapter (Postgres, `adapterSecurity = true`).
 *
 * Pipeline under test (same order as in server-pipeline): SpaceSecurity(adapterSecurity) -> QueryJoin -> adapter.
 * The fake adapter behaves like `PostgresAdapter.addSecurity`: it filters by the account of `ctx.contextData` and
 * ignores `options.allowedSpaces`; a trigger context is not filtered at all.
 */

const DOMAIN_TEST = 'test' as Domain
const TEST_CLASS = 'test:class:Doc' as Ref<Class<Doc>>
const PUBLIC_SPACE = 'test:space:public' as Ref<Space>
const PRIVATE_SPACE = 'test:space:private' as Ref<Space>

const member = { uuid: 'acc-member' as AccountUuid, role: AccountRole.User }
const outsider = { uuid: 'acc-outsider' as AccountUuid, role: AccountRole.User }

/** Spaces each account is a member of. */
const membership = new Map<AccountUuid, Ref<Space>[]>([
  [member.uuid, [PUBLIC_SPACE, PRIVATE_SPACE]],
  [outsider.uuid, [PUBLIC_SPACE]]
])

const docs: Doc[] = [
  { _id: 'doc-public' as Ref<Doc>, _class: TEST_CLASS, space: PUBLIC_SPACE, modifiedBy: '' as PersonId, modifiedOn: 0 },
  {
    _id: 'doc-private' as Ref<Doc>,
    _class: TEST_CLASS,
    space: PRIVATE_SPACE,
    modifiedBy: '' as PersonId,
    modifiedOn: 0
  }
]

function matchSpace (space: Ref<Space>, q: any): boolean {
  if (q === undefined) return true
  if (typeof q === 'string') return q === space
  if (Array.isArray(q.$in)) return q.$in.includes(space)
  return true
}

function sessionCtx (
  account: Pick<Account, 'uuid' | 'role'>,
  extra: Partial<SessionData> = {}
): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as unknown as MeasureContext<SessionData>
  ctx.contextData = { account, ...extra } as unknown as SessionData
  return ctx
}

async function createPipeline (): Promise<{
  top: SpaceSecurityMiddleware
  join: QueryJoinMiddleware
  adapterCalls: () => number
}> {
  let adapterCalls = 0
  const adapter = {
    findAll: async (
      ctx: MeasureContext<SessionData>,
      _class: Ref<Class<Doc>>,
      query: DocumentQuery<Doc>,
      options?: ServerFindOptions<Doc>
    ) => {
      adapterCalls++
      await new Promise((resolve) => setTimeout(resolve, 30))
      const data = ctx.contextData
      const allowed = data.isTriggerCtx === true ? undefined : new Set(membership.get(data.account.uuid) ?? [])
      return toFindResult(
        docs.filter((d) => matchSpace(d.space, (query as any).space) && (allowed === undefined || allowed.has(d.space)))
      )
    }
  } as unknown as Middleware

  const hierarchy = new Hierarchy()
  jest.spyOn(hierarchy, 'getDomain').mockReturnValue(DOMAIN_TEST)
  jest.spyOn(hierarchy, 'isDerived').mockReturnValue(false)
  const context = { hierarchy } as unknown as PipelineContext

  const metrics = new MeasureMetricsContext('test', {})
  const join = await QueryJoinMiddleware.create(metrics, context, adapter)
  const top = await SpaceSecurityMiddleware.create(true, metrics, context, join)
  top.wasInit = true
  jest.spyOn(top as any, 'getDomainSpaces').mockImplementation(async () => new Set([PUBLIC_SPACE, PRIVATE_SPACE]))
  jest.spyOn(top as any, 'getAllAllowedSpaces').mockImplementation((account: any) => membership.get(account.uuid) ?? [])

  return { top, join, adapterCalls: () => adapterCalls }
}

const ids = (res: Doc[]): string[] => res.map((it) => it._id).sort()

describe('QueryJoinMiddleware with adapter security', () => {
  it('fixture: sequential requests are filtered per account', async () => {
    const { top } = await createPipeline()
    expect(ids(await top.findAll(sessionCtx(member), TEST_CLASS, { space: PRIVATE_SPACE }))).toEqual(['doc-private'])
    expect(ids(await top.findAll(sessionCtx(outsider), TEST_CLASS, { space: PRIVATE_SPACE }))).toEqual([])
  })

  it('does not leak a private space to a non-member through a joined query with `space`', async () => {
    const { top } = await createPipeline()
    const [m, o] = await Promise.all([
      top.findAll(sessionCtx(member), TEST_CLASS, { space: PRIVATE_SPACE }),
      top.findAll(sessionCtx(outsider), TEST_CLASS, { space: PRIVATE_SPACE })
    ])
    expect(ids(m)).toEqual(['doc-private'])
    expect(ids(o)).toEqual([]) // fails on develop: outsider gets 'doc-private' of the member
  })

  it('does not hide documents from a member when a non-member started the same query', async () => {
    const { top } = await createPipeline()
    const [o, m] = await Promise.all([
      top.findAll(sessionCtx(outsider), TEST_CLASS, { space: { $in: [PUBLIC_SPACE, PRIVATE_SPACE] } }),
      top.findAll(sessionCtx(member), TEST_CLASS, { space: { $in: [PUBLIC_SPACE, PRIVATE_SPACE] } })
    ])
    expect(ids(o)).toEqual(['doc-public'])
    expect(ids(m)).toEqual(['doc-private', 'doc-public']) // fails on develop: member gets the outsider result
  })

  it('does not share a result between a trigger (no security filter) and a user', async () => {
    const { top, join } = await createPipeline()
    // Triggers are below SpaceSecurity in the pipeline, so their findAll reaches QueryJoin directly.
    const [u, t] = await Promise.all([
      top.findAll(sessionCtx(outsider), TEST_CLASS, { space: PRIVATE_SPACE }),
      join.findAll(sessionCtx(outsider, { isTriggerCtx: true }), TEST_CLASS, { space: PRIVATE_SPACE })
    ])
    // Fails on develop: whoever reaches QueryJoin first wins. The trigger skips SpaceSecurity, so usually it is first
    // and the user gets the unfiltered trigger result; otherwise the trigger silently misses documents.
    expect(ids(u)).toEqual([])
    expect(ids(t)).toEqual(['doc-private'])
  })

  it('still joins the same query of the same account', async () => {
    const { top, adapterCalls } = await createPipeline()
    await Promise.all([
      top.findAll(sessionCtx(member), TEST_CLASS, { space: PRIVATE_SPACE }),
      top.findAll(sessionCtx(member), TEST_CLASS, { space: PRIVATE_SPACE })
    ])
    expect(adapterCalls()).toBe(1)
  })
})
