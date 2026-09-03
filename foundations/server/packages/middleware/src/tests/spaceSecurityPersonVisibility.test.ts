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
  type SearchResult,
  type SessionData,
  type Space,
  relatedVia
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { SpaceSecurityMiddleware } from '../spaceSecurity'

const PERSON_CLASS = contact.class.Person

function makeAccount (role: AccountRole, uuid?: AccountUuid): Account {
  return {
    uuid: (uuid ?? generateId()) as AccountUuid,
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
    // Array-valued fields (Space.members) match by containment, as the storage layer does.
    const contains = (v: any): boolean => (Array.isArray(val) ? val.includes(v) : val === v)
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && cond.$in !== undefined) {
      if (!(cond.$in as any[]).some((v) => contains(v))) return false
    } else if (!contains(cond)) {
      return false
    }
  }
  return true
}

function byId (a: string, b: string): number {
  return a.localeCompare(b)
}

interface TestSetup {
  mw: SpaceSecurityMiddleware
  ALICE: AccountUuid
  BOB: AccountUuid
  CAROL: AccountUuid
  DAVE: AccountUuid
  personAlice: Ref<Doc>
  personBob: Ref<Doc>
  personCarol: Ref<Doc>
  searchDocs: SearchResult
  capturedSearchQuery: { spaces?: Ref<Space>[] } | undefined
}

async function setup (): Promise<TestSetup> {
  const ALICE = generateId() as unknown as AccountUuid
  const BOB = generateId() as unknown as AccountUuid
  const CAROL = generateId() as unknown as AccountUuid
  // DAVE belongs to both P1 and P2 - used to verify multi-space guests see the union of members.
  const DAVE = generateId() as unknown as AccountUuid

  const P1: Ref<Space> = generateId()
  const P2: Ref<Space> = generateId()

  const spaces = [
    {
      _id: P1,
      members: [ALICE, BOB, DAVE],
      private: false,
      _class: 'test:class:Project' as Ref<Class<Doc>>,
      archived: false
    },
    {
      _id: P2,
      members: [CAROL, DAVE],
      private: false,
      _class: 'test:class:Project' as Ref<Class<Doc>>,
      archived: false
    }
  ]

  // People live in a SystemSpace. Search drops those for restricted roles, which is exactly the
  // exclusion a row-restricting policy lifts - so the double has to contain it.
  const contactsSpace = {
    _id: contact.space.Contacts,
    members: [] as AccountUuid[],
    private: false,
    _class: core.class.SystemSpace as Ref<Class<Doc>>,
    archived: false
  }
  spaces.push(contactsSpace as any)

  const personAlice = { _id: generateId(), _class: PERSON_CLASS, personUuid: ALICE, space: contact.space.Contacts }
  const personBob = { _id: generateId(), _class: PERSON_CLASS, personUuid: BOB, space: contact.space.Contacts }
  const personCarol = { _id: generateId(), _class: PERSON_CLASS, personUuid: CAROL, space: contact.space.Contacts }
  const persons = [personAlice, personBob, personCarol]

  let capturedSearchQuery: { spaces?: Ref<Space>[] } | undefined
  let searchDocs: SearchResult = { docs: [], total: 0 }

  const next: Middleware = {
    findAll: (async (_ctx: any, _class: any, query: any) => {
      if (_class === core.class.Space) {
        // Behaves like storage: a traversal step queries spaces by membership, so the double has
        // to honour the query instead of returning everything.
        return spaces.filter((sp) => matchesQuery(sp, query)) as any
      }
      if (_class === PERSON_CLASS) {
        return persons.filter((p) => matchesQuery(p, query)) as any
      }
      return []
    }) as any,
    groupBy: (async (_ctx: any, domain: string) =>
      domain === 'contact' ? new Map([[contact.space.Contacts, 1]]) : new Map()) as any,
    searchFulltext: (async (_ctx: any, query: any) => {
      capturedSearchQuery = query
      return searchDocs
    }) as any,
    tx: (async () => ({})) as any,
    handleBroadcast: (async () => {}) as any,
    loadModel: (async () => []) as any,
    groupByField: undefined,
    domainRequest: (async () => ({ domain: 'test', value: null })) as any,
    closeSession: (async () => {}) as any
  } as any

  const hierarchy: any = {
    // Person visibility is a declared policy now, not a branch in the middleware: the double has
    // to carry the same mixin the contact model declares.
    classHierarchyMixin: (_class: any, mixin: any) => {
      if (mixin !== core.mixin.RowVisibility) return undefined
      if (_class !== PERSON_CLASS) return undefined
      return {
        policy: relatedVia(
          {
            from: 'accountUuid',
            steps: [{ via: core.class.Space, match: 'members', emit: 'members' }],
            to: 'personUuid',
            includeSelf: true
          },
          'People are discoverable through shared real-space membership'
        )
      }
    },
    isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) => {
      if (b === core.class.Space) return a === core.class.Space
      if (b === PERSON_CLASS) return a === PERSON_CLASS
      return a === b
    },
    getDomain: (_class: Ref<Class<Doc>>) => {
      if (_class === core.class.Space) return 'space'
      if (_class === PERSON_CLASS) return 'contact'
      return 'tx'
    }
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

  return {
    mw,
    ALICE,
    BOB,
    CAROL,
    DAVE,
    personAlice: personAlice._id,
    personBob: personBob._id,
    personCarol: personCarol._id,
    get searchDocs () {
      return searchDocs
    },
    set searchDocs (v: SearchResult) {
      searchDocs = v
    },
    get capturedSearchQuery () {
      return capturedSearchQuery
    }
  } as any
}

describe('SpaceSecurityMiddleware – guest People visibility', () => {
  describe('findAll: open (browse) queries', () => {
    it('Guest sees only people from spaces they belong to', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const res = await s.mw.findAll(ctx, PERSON_CLASS, {})
      const ids = res.map((r: any) => r._id).sort(byId)
      expect(ids).toEqual([s.personAlice, s.personBob].sort(byId))
    })

    it('ReadOnlyGuest sees only people from spaces they belong to', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.ReadOnlyGuest, s.ALICE))
      const res = await s.mw.findAll(ctx, PERSON_CLASS, {})
      const ids = res.map((r: any) => r._id).sort(byId)
      expect(ids).toEqual([s.personAlice, s.personBob].sort(byId))
    })

    it('a guest belonging to only one space (P2) does not see P1 members', async () => {
      const s = await setup()
      const carolCtx = makeCtx(makeAccount(AccountRole.Guest, s.CAROL))
      const carolRes = await s.mw.findAll(carolCtx, PERSON_CLASS, {})
      expect(carolRes.map((r: any) => r._id)).toEqual([s.personCarol])
    })

    it('a guest belonging to both P1 and P2 sees the union of both spaces members', async () => {
      const s = await setup()
      const daveCtx = makeCtx(makeAccount(AccountRole.Guest, s.DAVE))
      const daveRes = await s.mw.findAll(daveCtx, PERSON_CLASS, {})
      const ids = daveRes.map((r: any) => r._id).sort(byId)
      expect(ids).toEqual([s.personAlice, s.personBob, s.personCarol].sort(byId))
    })

    it('_id-scoped lookup does not bypass the shared-space relationship check', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const res = await s.mw.findAll(ctx, PERSON_CLASS, { _id: s.personCarol } as any)
      expect(res).toEqual([])
    })

    it('_id: { $in: [...] } lookup is intersected with visible people', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const res = await s.mw.findAll(ctx, PERSON_CLASS, { _id: { $in: [s.personCarol, s.personBob] } } as any)
      expect(res.map((r: any) => r._id)).toEqual([s.personBob])
    })

    it('a guest with no space membership gets an empty result for an open query', async () => {
      const s = await setup()
      const stranger = generateId() as unknown as AccountUuid
      const ctx = makeCtx(makeAccount(AccountRole.Guest, stranger))
      const res = await s.mw.findAll(ctx, PERSON_CLASS, {})
      expect(res.length).toBe(0)
    })

    it('DocGuest gets an empty result even when a person id is known', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.DocGuest, generateId() as unknown as AccountUuid))
      const openRes = await s.mw.findAll(ctx, PERSON_CLASS, {})
      expect(openRes.length).toBe(0)

      const idRes = await s.mw.findAll(ctx, PERSON_CLASS, { _id: s.personAlice } as any)
      expect(idRes).toEqual([])
    })

    it('regular User accounts are not restricted', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.User, s.BOB))
      const res = await s.mw.findAll(ctx, PERSON_CLASS, {})
      const ids = res.map((r: any) => r._id).sort(byId)
      expect(ids).toEqual([s.personAlice, s.personBob, s.personCarol].sort(byId))
    })
  })

  describe('searchFulltext: @-mention / People picker', () => {
    it('is unblocked for Guest for Person/Employee classes, but only returns space-mates', async () => {
      const s = await setup()
      // Simulate the underlying fulltext index returning everyone that matched the text query -
      // this is what would happen today before our fix narrows contact.space.Contacts visibility.
      ;(s as any).searchDocs = {
        docs: [
          { id: s.personAlice, doc: { _id: s.personAlice, _class: PERSON_CLASS, createdOn: 0 } },
          { id: s.personBob, doc: { _id: s.personBob, _class: PERSON_CLASS, createdOn: 0 } },
          { id: s.personCarol, doc: { _id: s.personCarol, _class: PERSON_CLASS, createdOn: 0 } }
        ],
        total: 3
      } as any

      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const result = await s.mw.searchFulltext(ctx, { query: 'a', classes: [PERSON_CLASS] }, { limit: 5 })

      // Bug being fixed: previously contact.space.Contacts was stripped from allowed search
      // spaces for Guest/ReadOnlyGuest, so the query sent downstream would exclude it entirely
      // and the picker would always come back empty. Confirm it's included now.
      expect(s.capturedSearchQuery?.spaces).toContain(contact.space.Contacts)

      // But the result set must still be narrowed to Alice's actual space-mates.
      expect(result.docs.map((d) => d.id).sort(byId)).toEqual([s.personAlice, s.personBob].sort(byId))
    })

    it('does not leak people outside the guest space when searching a broader class set', async () => {
      const s = await setup()
      ;(s as any).searchDocs = {
        docs: [{ id: s.personCarol, doc: { _id: s.personCarol, _class: PERSON_CLASS, createdOn: 0 } }],
        total: 1
      } as any

      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const result = await s.mw.searchFulltext(ctx, { query: 'carol', classes: [PERSON_CLASS] }, { limit: 5 })
      expect(result.docs).toEqual([])
    })
  })
})
