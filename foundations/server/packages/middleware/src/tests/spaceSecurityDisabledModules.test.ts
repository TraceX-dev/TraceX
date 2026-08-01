//
// Copyright © 2026 Hardcore Engineering Inc.
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

/**
 * Tests for excluding a role-disabled module's spaces from `searchFulltext` (@-mention/search
 * picker). Settings → Guest permissions lets an admin flip `ModulePermissionGroup.enabled` off
 * for a role; previously this only hid the sidebar app icon and gated writes, while the module's
 * objects still turned up in search/mention results for that role. `spaceSecurity.ts` now also
 * drops any space whose class matches a disabled group's `spaceClass` from the search-space set.
 */

import contact from '@hcengineering/contact'
import core, {
  AccountRole,
  generateId,
  MeasureMetricsContext,
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SearchQuery,
  type SessionData,
  type Space
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { SpaceSecurityMiddleware } from '../spaceSecurity'

const PRODUCTS_SPACE_CLASS = 'test:class:ProductsSpace' as Ref<Class<Doc>>
const OTHER_SPACE_CLASS = 'test:class:OtherSpace' as Ref<Class<Doc>>

function makeAccount (role: AccountRole, uuid: AccountUuid): Account {
  return {
    uuid,
    role,
    primarySocialId: 'test' as PersonId,
    socialIds: ['test' as PersonId],
    fullSocialIds: []
  }
}

function makeCtx (account: Account): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account,
    broadcast: { txes: [], queue: [], sessions: {} }
  } as any
  return ctx
}

function matchesQuery (doc: Record<string, any>, query: Record<string, any> | undefined): boolean {
  for (const key of Object.keys(query ?? {})) {
    const cond = query?.[key]
    const val = doc[key]
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && cond.$in !== undefined) {
      const included: boolean = cond.$in.includes(val)
      if (!included) return false
    } else if (val !== cond) {
      return false
    }
  }
  return true
}

async function setup (
  moduleGroups: Array<{ role: AccountRole, enabled: boolean, spaceClass: Ref<Class<Doc>> }>
): Promise<{
    mw: SpaceSecurityMiddleware
    ALICE: AccountUuid
    productsSpaceId: Ref<Space>
    otherSpaceId: Ref<Space>
    capturedQuery: () => SearchQuery | undefined
  }> {
  const ALICE = generateId() as unknown as AccountUuid

  const productsSpaceId: Ref<Space> = generateId()
  const otherSpaceId: Ref<Space> = generateId()

  const spaces = [
    { _id: productsSpaceId, members: [ALICE], private: false, _class: PRODUCTS_SPACE_CLASS, archived: false },
    { _id: otherSpaceId, members: [ALICE], private: false, _class: OTHER_SPACE_CLASS, archived: false }
  ]

  let capturedQuery: SearchQuery | undefined

  const next: Middleware = {
    findAll: (async (_ctx: any, _class: any, query: any) => {
      if (_class === core.class.Space) return spaces as any
      if (_class === core.class.ModulePermissionGroup) {
        return moduleGroups.filter((g) => matchesQuery(g, query)) as any
      }
      if (_class === contact.class.Person) return []
      return []
    }) as any,
    groupBy: (async () => new Map()) as any,
    searchFulltext: (async (_ctx: any, query: any) => {
      capturedQuery = query
      return { docs: [], total: 0 }
    }) as any,
    tx: (async () => ({})) as any,
    handleBroadcast: (async () => {}) as any,
    loadModel: (async () => []) as any,
    domainRequest: (async () => ({ domain: 'test', value: null })) as any,
    closeSession: (async () => {}) as any
  } as any

  const hierarchy: any = {
    isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) => {
      if (b === core.class.Space) return a === core.class.Space
      return a === b
    },
    getDomain: (_class: Ref<Class<Doc>>) => (_class === core.class.Space ? 'space' : 'tx')
  }

  const context: PipelineContext = {
    workspace: { uuid: 'test-workspace' as any, url: 'test', dataId: 'test' as any },
    hierarchy,
    modelDb: { findAllSync: () => [] } as any,
    branding: null as any,
    adapterManager: {} as any,
    storageAdapter: {} as any,
    contextVars: {},
    lastTx: '',
    lastHash: '',
    broadcastEvent: async () => {}
  } as any

  const mw = new (SpaceSecurityMiddleware as any)(false, context, next) as SpaceSecurityMiddleware

  return { mw, ALICE, productsSpaceId, otherSpaceId, capturedQuery: () => capturedQuery }
}

describe('SpaceSecurityMiddleware – disabled-module exclusion from search', () => {
  it('drops the disabled module space from the search-space set for the matching role', async () => {
    const s = await setup([{ role: AccountRole.Guest, enabled: false, spaceClass: PRODUCTS_SPACE_CLASS }])
    const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
    await s.mw.searchFulltext(ctx, { query: 'product' }, { limit: 5 })
    const spaces = s.capturedQuery()?.spaces ?? []
    expect(spaces).not.toContain(s.productsSpaceId)
    expect(spaces).toContain(s.otherSpaceId)
  })

  it('does not affect a role the disabled group does not target', async () => {
    const s = await setup([{ role: AccountRole.Guest, enabled: false, spaceClass: PRODUCTS_SPACE_CLASS }])
    const ctx = makeCtx(makeAccount(AccountRole.User, s.ALICE))
    await s.mw.searchFulltext(ctx, { query: 'product' }, { limit: 5 })
    const spaces = s.capturedQuery()?.spaces ?? []
    expect(spaces).toContain(s.productsSpaceId)
  })

  it('an enabled module is not excluded', async () => {
    const s = await setup([{ role: AccountRole.Guest, enabled: true, spaceClass: PRODUCTS_SPACE_CLASS }])
    const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
    await s.mw.searchFulltext(ctx, { query: 'product' }, { limit: 5 })
    const spaces = s.capturedQuery()?.spaces ?? []
    expect(spaces).toContain(s.productsSpaceId)
  })

  it('no ModulePermissionGroup docs at all is a no-op', async () => {
    const s = await setup([])
    const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
    await s.mw.searchFulltext(ctx, { query: 'product' }, { limit: 5 })
    const spaces = s.capturedQuery()?.spaces ?? []
    expect(spaces).toContain(s.productsSpaceId)
    expect(spaces).toContain(s.otherSpaceId)
  })
})
