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

/**
 * Investigating a reported bug: a Guest-role account sharing a real chunter.class.Channel with
 * another account gets a completely empty @-mention popup (client calls `searchFor('mention', ...)`
 * -> `client.searchFulltext({ classes: [contact.mixin.Employee] })`, which routes through
 * `SpaceSecurityMiddleware.searchFulltext`).
 *
 * Runs the real `SpaceSecurityMiddleware.searchFulltext` against a mocked `next` that behaves like
 * a real fulltext adapter (honors `query.spaces`, and resolves a Mixin ref like `contact.mixin.
 * Employee` back to its underlying `Person` doc - as a real backend would), to see the actual
 * output rather than reasoning about the source by inspection.
 *
 * This baseline scenario (default settings, no disabled Guest-permission modules) passes: the
 * chain getGuestVisibleAccounts -> getGuestVisiblePersonIds -> filterSearchResultsByRowVisibility
 * correctly surfaces a shared-channel member. So this specific mechanism is not, by itself, the
 * cause of the reported empty popup - the remaining suspects are workspace-specific configuration
 * (e.g. a Settings -> Guest permissions module disabled for Guest that happens to cover
 * contact.space.Contacts) or something below the `next` boundary (the real fulltext engine/index,
 * or client-side rendering) that this mock cannot exercise. Kept as a regression test for the
 * mechanism this file does cover.
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
  type SearchOptions,
  type SessionData,
  type Space
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { SpaceSecurityMiddleware } from '../spaceSecurity'

const CHANNEL_CLASS = 'chunter:class:Channel' as Ref<Class<Doc>>

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

describe('SpaceSecurityMiddleware.searchFulltext - guest @-mention reproduction', () => {
  it('a Guest sharing a real channel with another account finds that account in an Employee mention search', async () => {
    const GUEST = generateId() as unknown as AccountUuid
    const ALICE = generateId() as unknown as AccountUuid
    const CHANNEL = generateId() as unknown as Ref<Space>

    const personGuest = {
      _id: generateId(),
      _class: contact.mixin.Employee,
      personUuid: GUEST,
      space: contact.space.Contacts
    }
    const personAlice = {
      _id: generateId(),
      _class: contact.mixin.Employee,
      personUuid: ALICE,
      space: contact.space.Contacts
    }

    const channel = {
      _id: CHANNEL,
      _class: CHANNEL_CLASS,
      space: core.space.Space,
      private: false,
      archived: false,
      members: [GUEST, ALICE]
    }

    const next: Middleware = {
      findAll: (async (_ctx: any, _class: any, query: any) => {
        if (_class === core.class.Space) return [channel] as any
        if (_class === contact.class.Person || _class === contact.mixin.Employee) {
          const all = [personGuest, personAlice]
          if (query?._id !== undefined) {
            return all.filter((p) => p._id === query._id) as any
          }
          const uuids: AccountUuid[] | undefined = query?.personUuid?.$in
          return uuids === undefined ? all : (all.filter((p) => uuids.includes(p.personUuid)) as any)
        }
        return []
      }) as any,
      groupBy: (async () => new Map()) as any,
      // Behaves like a real fulltext adapter: only returns docs whose `space` is in `query.spaces`.
      searchFulltext: (async (_ctx: any, query: SearchQuery, _options: SearchOptions) => {
        const candidates = [personGuest, personAlice]
        const docs = candidates
          .filter((p) => query.spaces === undefined || query.spaces.includes(p.space as Ref<Space>))
          .map((p) => ({ id: p._id, title: p.personUuid, doc: { _id: p._id, _class: p._class, createdOn: 0 } }))
        return { docs, total: docs.length }
      }) as any,
      tx: (async () => ({})) as any,
      handleBroadcast: (async () => {}) as any,
      loadModel: (async () => []) as any,
      domainRequest: (async () => ({ domain: 'test', value: null })) as any,
      closeSession: (async () => {}) as any
    } as any

    const context: PipelineContext = {
      workspace: { uuid: 'test-workspace' as any, url: 'test', dataId: 'test' as any },
      hierarchy: {
        isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) => {
          if (b === contact.class.Person) return a === contact.class.Person || a === contact.mixin.Employee
          if (b === core.class.Space) return a === core.class.Space || a === CHANNEL_CLASS
          return a === b
        },
        getDomain: () => 'contact',
        classHierarchyMixin: () => undefined
      } as any,
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
    const ctx = makeCtx(makeAccount(AccountRole.Guest, GUEST))

    const result = await mw.searchFulltext(ctx, { query: '*', classes: [contact.mixin.Employee] }, {})

    expect(result.docs.map((d) => d.title)).toEqual(expect.arrayContaining([GUEST, ALICE]))
  })
})
