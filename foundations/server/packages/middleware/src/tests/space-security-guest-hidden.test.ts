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
  type Account,
  AccountRole,
  type AccountUuid,
  type Class,
  type Doc,
  type Domain,
  DOMAIN_TX,
  DOMAIN_USER_GROUP,
  type MeasureContext,
  MeasureMetricsContext,
  type Ref,
  type SessionData,
  type Space,
  toFindResult,
  TxFactory
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { excludeGuestHiddenSpaces, SpaceSecurityMiddleware } from '../spaceSecurity'

const CHANNEL = 'chunter:class:Channel' as Ref<Class<Space>>
const GUEST = 'acc-guest' as AccountUuid
const RO_GUEST = 'acc-readonly-guest' as AccountUuid
const USER = 'acc-user' as AccountUuid

const group = {
  _id: 'group-1',
  _class: core.class.UserGroup,
  space: core.space.UserGroups,
  name: 'g',
  members: [USER]
} as unknown as Doc

const domains: Record<string, Domain> = {
  [core.class.UserGroup]: DOMAIN_USER_GROUP,
  [core.class.TxCreateDoc]: DOMAIN_TX,
  [CHANNEL]: 'space' as Domain
}

interface Setup {
  middleware: SpaceSecurityMiddleware
  queries: any[]
}

async function setup (adapterSecurity: boolean, found: Doc[] = [], lookupMap?: Record<string, Doc>): Promise<Setup> {
  const queries: any[] = []
  const next = {
    findAll: async (_ctx: MeasureContext, _class: Ref<Class<Doc>>, query: any) => {
      queries.push(query)
      return toFindResult(found, found.length, lookupMap)
    },
    groupBy: async (_ctx: MeasureContext, domain: Domain) =>
      new Map(
        (domain === DOMAIN_USER_GROUP
          ? [core.space.UserGroups]
          : domain === DOMAIN_TX
            ? [core.space.UserGroups, core.space.Workspace]
            : [core.space.Workspace]
        ).map((it) => [it, 1])
      ),
    searchFulltext: async (_ctx: MeasureContext, query: any) => ({ docs: [], query }),
    handleBroadcast: async () => {}
  } as unknown as Middleware
  const context = {
    hierarchy: {
      getDomain: (_class: string) => domains[_class] ?? ('channel' as Domain),
      isDerived: (_class: string, base: string) => _class === base || (base === core.class.Space && _class === CHANNEL),
      getAncestors: (_class: string) => [_class]
    },
    modelDb: { findAllSync: () => [] }
  } as unknown as PipelineContext
  const middleware = await SpaceSecurityMiddleware.create(
    adapterSecurity,
    new MeasureMetricsContext('test', {}),
    context,
    next
  )
  middleware.wasInit = true
  // Both are system spaces; only one is hidden from guests.
  ;(middleware as any).systemSpaces.add(core.space.UserGroups)
  return { middleware, queries }
}

function sessionCtx (role: AccountRole): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as unknown as MeasureContext<SessionData>
  const uuid = role === AccountRole.Guest ? GUEST : role === AccountRole.ReadOnlyGuest ? RO_GUEST : USER
  ;(ctx as any).contextData = {
    account: { uuid, role, primarySocialId: 'social' } as unknown as Account,
    broadcast: { txes: [], targets: {} },
    contextCache: new Map(),
    socialStringsToUsers: new Map([
      ['s-user', { accontUuid: USER, role: AccountRole.User }],
      ['s-guest', { accontUuid: GUEST, role: AccountRole.Guest }],
      ['s-readonly-guest', { accontUuid: RO_GUEST, role: AccountRole.ReadOnlyGuest }]
    ])
  }
  return ctx
}

/** Whether a space query lets documents of `space` through. */
function allows (value: any, space: Ref<Space>): boolean {
  if (value === undefined) return true
  if (typeof value === 'string') return value === space
  if (Array.isArray(value.$in) && !value.$in.includes(space)) return false
  if (Array.isArray(value.$nin) && value.$nin.includes(space)) return false
  return true
}

describe('spaces hidden from guests', () => {
  for (const adapterSecurity of [false, true]) {
    describe(adapterSecurity ? 'with adapter security' : 'with middleware security', () => {
      it('guests and read-only guests do not query user groups, other accounts do', async () => {
        const { middleware, queries } = await setup(adapterSecurity)
        await middleware.findAll(sessionCtx(AccountRole.Guest), core.class.UserGroup, {})
        await middleware.findAll(sessionCtx(AccountRole.ReadOnlyGuest), core.class.UserGroup, {})
        await middleware.findAll(sessionCtx(AccountRole.User), core.class.UserGroup, {})
        expect(allows(queries[0].space, core.space.UserGroups)).toBe(false)
        expect(allows(queries[1].space, core.space.UserGroups)).toBe(false)
        expect(allows(queries[2].space, core.space.UserGroups)).toBe(true)
      })

      it('guests do not read the transaction history of user groups', async () => {
        const { middleware, queries } = await setup(adapterSecurity)
        const query = { objectClass: core.class.UserGroup }
        await middleware.findAll(sessionCtx(AccountRole.Guest), core.class.TxCreateDoc, query)
        await middleware.findAll(sessionCtx(AccountRole.User), core.class.TxCreateDoc, query)
        expect(allows(queries[0].objectSpace, core.space.UserGroups)).toBe(false)
        expect(allows(queries[0].objectSpace, core.space.Workspace)).toBe(true)
        expect(allows(queries[1].objectSpace, core.space.UserGroups)).toBe(true)
        expect(query).toEqual({ objectClass: core.class.UserGroup })
      })
    })
  }

  it('a guest asking for the hidden space by name gets nothing', async () => {
    const { middleware, queries } = await setup(true)
    await middleware.findAll(sessionCtx(AccountRole.Guest), core.class.UserGroup, { space: core.space.UserGroups })
    expect(queries[0].space).toEqual({ $in: [] })
  })

  it('guests get lookups and lookup maps without documents of hidden spaces', async () => {
    const person = { _id: 'p-1', _class: 'contact:class:Person', space: core.space.Workspace } as unknown as Doc
    const channel = {
      _id: 'c-1',
      _class: CHANNEL,
      space: core.space.Space,
      $lookup: { groups: [group], createdBy: person },
      $associations: { relation: [group, person] }
    } as unknown as Doc
    const { middleware } = await setup(true, [channel], { [group._id]: group, [person._id]: person })
    const options = { lookup: { groups: core.class.UserGroup } } as any
    for (const role of [AccountRole.Guest, AccountRole.ReadOnlyGuest]) {
      const result = await middleware.findAll(sessionCtx(role), CHANNEL, {}, options)
      expect((result[0] as any).$lookup.groups).toEqual([])
      expect((result[0] as any).$lookup.createdBy).toEqual(person)
      expect((result[0] as any).$associations.relation).toEqual([person])
      expect(Object.keys(result.lookupMap ?? {})).toEqual([person._id])
    }
    const asUser = await middleware.findAll(sessionCtx(AccountRole.User), CHANNEL, {}, options)
    expect((asUser[0] as any).$lookup.groups).toEqual([group])
    expect((channel as any).$lookup.groups).toEqual([group])
  })

  it('guests do not search in hidden spaces', async () => {
    const { middleware } = await setup(true)
    const asGuest = (await middleware.searchFulltext(sessionCtx(AccountRole.ReadOnlyGuest), { query: 'g' }, {})) as any
    const asUser = (await middleware.searchFulltext(sessionCtx(AccountRole.User), { query: 'g' }, {})) as any
    expect(asGuest.query.spaces).not.toContain(core.space.UserGroups)
    expect(asUser.query.spaces).toContain(core.space.UserGroups)
  })

  it('transactions of hidden spaces are not broadcast to guests', async () => {
    const { middleware } = await setup(true)
    const ctx = sessionCtx(AccountRole.Owner)
    await middleware.handleBroadcast(ctx)
    const target = ctx.contextData.broadcast.targets.spaceSec
    const factory = new TxFactory(core.account.System)
    const groupTx = factory.createTxCreateDoc(core.class.UserGroup, core.space.UserGroups, { name: 'g', members: [] })
    const commonTx = factory.createTxCreateDoc(CHANNEL, core.space.Workspace, {} as any)
    expect(await target(groupTx)).toEqual({ exclude: [GUEST, RO_GUEST] })
    expect(await target(commonTx)).toBeUndefined()
  })

  it('excludeGuestHiddenSpaces keeps the rest of a space condition', () => {
    expect(excludeGuestHiddenSpaces({}, 'space')).toEqual({ space: { $nin: [core.space.UserGroups] } })
    expect(excludeGuestHiddenSpaces({ space: core.space.Workspace }, 'space')).toEqual({ space: core.space.Workspace })
    expect(
      excludeGuestHiddenSpaces({ space: { $in: [core.space.UserGroups, core.space.Workspace] } } as any, 'space')
    ).toEqual({ space: { $in: [core.space.Workspace] } })
    expect(excludeGuestHiddenSpaces({ space: { $nin: [core.space.Workspace] } } as any, 'space')).toEqual({
      space: { $nin: [core.space.Workspace, core.space.UserGroups] }
    })
  })

  it('excludeGuestHiddenSpaces does not change a condition shared with the caller', () => {
    const shared = { $in: [core.space.UserGroups, core.space.Workspace] }
    const callerQuery = { space: shared }
    excludeGuestHiddenSpaces({ ...callerQuery } as any, 'space')
    expect(shared.$in).toEqual([core.space.UserGroups, core.space.Workspace])

    const excluded = { $nin: [core.space.Workspace] }
    excludeGuestHiddenSpaces({ space: excluded } as any, 'space')
    expect(excluded.$nin).toEqual([core.space.Workspace])
  })
})
