/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import core, {
  AccountRole,
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
  type Tx,
  toFindResult,
  TxFactory
} from '@hcengineering/core'
import contact from '@hcengineering/contact'
import type { PipelineContext } from '@hcengineering/server-core'
import { GuestPersonMiddleware } from '../guestPerson'

const EMPLOYEE = contact.mixin.Employee as unknown as Ref<Class<Doc>>
const ORGANIZATION = 'contact:class:Organization' as Ref<Class<Doc>>

const PARENTS: Record<string, string | undefined> = {
  [core.class.Doc]: undefined,
  [core.class.Space]: core.class.Doc,
  [core.class.SystemSpace]: core.class.Space,
  [contact.class.Contact]: core.class.Doc,
  [contact.class.Person]: contact.class.Contact,
  [EMPLOYEE]: contact.class.Person,
  [ORGANIZATION]: contact.class.Contact,
  [contact.class.Channel]: core.class.Doc,
  [contact.class.SocialIdentity]: core.class.Doc
}

const hierarchy = {
  isDerived: (_class: string, base: string): boolean => {
    let current: string | undefined = _class
    while (current !== undefined) {
      if (current === base) return true
      if (!(current in PARENTS)) throw new Error(`Unknown class ${current}`)
      current = PARENTS[current]
    }
    return false
  }
}

const GUEST = 'guest-uuid' as AccountUuid
const MEMBER = 'member-uuid' as AccountUuid
const OWNER = 'owner-uuid' as AccountUuid
const SYSTEM_MEMBER = 'system-member-uuid' as AccountUuid
const ARCHIVED_MEMBER = 'archived-member-uuid' as AccountUuid
const STRANGER = 'stranger-uuid' as AccountUuid

const SPACES = [
  { _id: 'space:project', _class: core.class.Space, members: [GUEST, MEMBER], owners: [OWNER] },
  { _id: 'space:system', _class: core.class.SystemSpace, members: [GUEST, SYSTEM_MEMBER] },
  { _id: 'space:archived', _class: core.class.Space, members: [GUEST, ARCHIVED_MEMBER], archived: true }
]

const PERSONS = [
  { _id: 'person:stranger', _class: contact.class.Person, personUuid: STRANGER },
  { _id: 'person:guest', _class: contact.class.Person, personUuid: GUEST },
  { _id: 'person:member', _class: contact.class.Person, personUuid: MEMBER },
  { _id: 'person:owner', _class: contact.class.Person, personUuid: OWNER },
  { _id: 'person:contact', _class: contact.class.Person },
  { _id: 'organization:one', _class: ORGANIZATION }
]

interface Call {
  _class: string
  query: Record<string, any>
}

function makeAccount (uuid: AccountUuid, role: AccountRole): Account {
  return {
    uuid,
    role,
    primarySocialId: 'test' as PersonId,
    socialIds: ['test' as PersonId],
    fullSocialIds: []
  }
}

function makeCtx (account: Account, users: Array<[AccountUuid, AccountRole]> = []): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = {
    account,
    broadcast: { txes: [], targets: {}, queue: [], sessions: {} },
    removedMap: new Map(),
    socialStringsToUsers: new Map(users.map(([uuid, role]) => [`social-${uuid}` as PersonId, { accontUuid: uuid, role }]))
  } as any
  return ctx
}

function matches (doc: Record<string, any>, query: Record<string, any>): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value.$in) && !value.$in.includes(doc[key])) return false
      if (Array.isArray(value.$nin) && value.$nin.includes(doc[key])) return false
      return true
    }
    if (key === 'members') return (doc.members ?? []).includes(value)
    return doc[key] === value
  })
}

// Mirrors MAX_EXPAND_ROUNDS in guestPerson.ts: one initial fetch plus bounded refills.
const MAX_FETCHES = 4

function makeMiddleware (
  search?: SearchResult,
  persons: Array<Record<string, any>> = PERSONS
): { mw: GuestPersonMiddleware, calls: Call[] } {
  const calls: Call[] = []
  const next = {
    findAll: async (
      _ctx: MeasureContext,
      _class: string,
      query: Record<string, any>,
      options?: { limit?: number, total?: boolean }
    ) => {
      calls.push({ _class, query })
      const docs =
        _class === core.class.Space
          ? SPACES.filter((it) => matches(it, query))
          : hierarchy.isDerived(_class, contact.class.Contact)
            ? persons.filter((it) => matches(it, query))
            : []
      const limited = options?.limit !== undefined ? docs.slice(0, options.limit) : docs
      return toFindResult(limited as any[], options?.total === true ? docs.length : -1)
    },
    searchFulltext: async (_ctx: MeasureContext, _query: unknown, options: { limit?: number }) => {
      calls.push({ _class: 'search', query: { limit: options.limit } })
      const result = search ?? { docs: [] }
      const docs = options.limit !== undefined ? result.docs.slice(0, options.limit) : result.docs
      return { docs, total: result.total }
    },
    tx: async () => ({}),
    handleBroadcast: async () => {}
  }
  const context = { hierarchy } as unknown as PipelineContext
  const mw = new (GuestPersonMiddleware as any)(context, next) as GuestPersonMiddleware
  return { mw, calls }
}

const guestCtx = (): MeasureContext<SessionData> => makeCtx(makeAccount(GUEST, AccountRole.Guest))

describe('GuestPersonMiddleware', () => {
  describe('non-guest', () => {
    it('passes person queries through unchanged', async () => {
      const { mw, calls } = makeMiddleware()
      await mw.findAll(makeCtx(makeAccount(MEMBER, AccountRole.User)), EMPLOYEE, { active: true })
      expect(calls).toEqual([{ _class: EMPLOYEE, query: { active: true } }])
    })
  })

  describe('person list queries', () => {
    it('restricts to members/owners of guest spaces, ignoring system and archived spaces', async () => {
      const { mw, calls } = makeMiddleware()
      await mw.findAll(guestCtx(), EMPLOYEE, { active: true })
      const personCall = calls.find((it) => it._class === EMPLOYEE)
      expect(new Set(personCall?.query.personUuid.$in)).toEqual(new Set([GUEST, MEMBER, OWNER]))
      expect(personCall?.query.active).toBe(true)
    })

    it('keeps existing personUuid operators', async () => {
      const { mw, calls } = makeMiddleware()
      await mw.findAll(guestCtx(), contact.class.Person, { personUuid: { $nin: [MEMBER] } })
      const personCall = calls.find((it) => it._class === contact.class.Person)
      expect(personCall?.query.personUuid.$nin).toEqual([MEMBER])
      expect(personCall?.query.personUuid.$in).toBeDefined()
    })

    it('does not restrict point queries', async () => {
      const { mw, calls } = makeMiddleware()
      await mw.findAll(guestCtx(), contact.class.Person, { _id: 'person:stranger' } as any)
      await mw.findAll(guestCtx(), contact.class.Person, { _id: { $in: ['person:stranger'] } } as any)
      await mw.findAll(guestCtx(), EMPLOYEE, { personUuid: { $in: [STRANGER] } })
      expect(calls.map((it) => it.query)).toEqual([
        { _id: 'person:stranger' },
        { _id: { $in: ['person:stranger'] } },
        { personUuid: { $in: [STRANGER] } }
      ])
    })

    it('fails closed for a guest without spaces', async () => {
      const { mw, calls } = makeMiddleware()
      const ctx = makeCtx(makeAccount(STRANGER, AccountRole.ReadOnlyGuest))
      await mw.findAll(ctx, EMPLOYEE, {})
      expect(calls.find((it) => it._class === EMPLOYEE)?.query.personUuid.$in).toEqual([STRANGER])
    })
  })

  describe('person attached docs', () => {
    it('restricts list queries to visible person refs', async () => {
      const { mw, calls } = makeMiddleware()
      await mw.findAll(guestCtx(), contact.class.SocialIdentity, { type: 'email' } as any)
      const call = calls.find((it) => it._class === contact.class.SocialIdentity)
      expect(new Set(call?.query.attachedTo.$in)).toEqual(new Set(['person:guest', 'person:member', 'person:owner']))
    })

    it('does not restrict point queries and non-person owners', async () => {
      const { mw, calls } = makeMiddleware()
      await mw.findAll(guestCtx(), contact.class.SocialIdentity, { _id: { $in: ['a', 'b'] } } as any)
      await mw.findAll(guestCtx(), contact.class.Channel, { attachedTo: 'person:stranger' } as any)
      await mw.findAll(guestCtx(), contact.class.Channel, { attachedToClass: ORGANIZATION })
      expect(calls.map((it) => it.query)).toEqual([
        { _id: { $in: ['a', 'b'] } },
        { attachedTo: 'person:stranger' },
        { attachedToClass: ORGANIZATION }
      ])
    })
  })

  it('post-filters Contact queries', async () => {
    const { mw } = makeMiddleware()
    const res = await mw.findAll(guestCtx(), contact.class.Contact, {})
    expect(res.map((it) => it._id).sort()).toEqual([
      'organization:one',
      'person:guest',
      'person:member',
      'person:owner'
    ])
    expect(res.total).toBe(-1)
  })

  it('fills Contact pages and reports unknown total when not all matches were loaded', async () => {
    const { mw } = makeMiddleware()
    const res = await mw.findAll(guestCtx(), contact.class.Contact, {}, { limit: 2, total: true })
    expect(res.map((it) => it._id)).toEqual(['person:guest', 'person:member'])
    expect(res.total).toBe(-1)
  })

  it('calculates the visible Contact total when all matches were loaded', async () => {
    const { mw } = makeMiddleware()
    const res = await mw.findAll(guestCtx(), contact.class.Contact, {}, { limit: 10, total: true })
    expect(res).toHaveLength(4)
    expect(res.total).toBe(4)
  })

  it('bounds Contact refills when most matches are hidden', async () => {
    const hidden = Array.from({ length: 100 }, (_, i) => ({
      _id: `person:hidden-${i}`,
      _class: contact.class.Person,
      personUuid: `hidden-${i}`
    }))
    const { mw, calls } = makeMiddleware(undefined, hidden)
    const res = await mw.findAll(guestCtx(), contact.class.Contact, {}, { limit: 2, total: true })
    expect(res).toHaveLength(0)
    expect(res.total).toBe(-1)
    expect(calls.filter((it) => it._class === contact.class.Contact)).toHaveLength(MAX_FETCHES)
  })

  it('fills Contact pages without changing the unknown total sentinel', async () => {
    const { mw } = makeMiddleware()
    const res = await mw.findAll(guestCtx(), contact.class.Contact, {}, { limit: 2 })
    expect(res.map((it) => it._id)).toEqual(['person:guest', 'person:member'])
    expect(res.total).toBe(-1)
  })

  it('filters persons from fulltext results', async () => {
    const doc = (_id: string, _class: string): any => ({ id: _id, doc: { _id, _class, createdOn: 0 } })
    const { mw } = makeMiddleware({
      docs: [doc('person:member', EMPLOYEE), doc('person:stranger', EMPLOYEE), doc('issue:1', core.class.Doc)],
      total: 3
    })
    const res = await mw.searchFulltext(guestCtx(), { query: 'x' }, {})
    expect(res.docs.map((it) => it.id)).toEqual(['person:member', 'issue:1'])
    expect(res.total).toBe(2)
  })

  it('fills fulltext pages after filtering hidden persons', async () => {
    const doc = (_id: string, _class: string): any => ({ id: _id, doc: { _id, _class, createdOn: 0 } })
    const { mw } = makeMiddleware({
      docs: [
        doc('person:stranger', EMPLOYEE),
        doc('person:member', EMPLOYEE),
        doc('issue:1', core.class.Doc),
        doc('issue:2', core.class.Doc)
      ],
      total: 4
    })
    const res = await mw.searchFulltext(guestCtx(), { query: 'x' }, { limit: 2 })
    expect(res.docs.map((it) => it.id)).toEqual(['person:member', 'issue:1'])
    expect(res.total).toBe(3)
  })

  it('bounds fulltext refills when most matches are hidden', async () => {
    const docs = Array.from({ length: 100 }, (_, i) => ({
      id: `person:hidden-${i}`,
      doc: { _id: `person:hidden-${i}`, _class: EMPLOYEE, createdOn: 0 }
    })) as any[]
    const { mw, calls } = makeMiddleware({ docs, total: docs.length })
    const res = await mw.searchFulltext(guestCtx(), { query: 'x' }, { limit: 2 })
    expect(res.docs).toHaveLength(0)
    expect(res.total).toBeUndefined()
    expect(calls.filter((it) => it._class === 'search').map((it) => it.query.limit)).toEqual([2, 4, 8, 16])
  })

  describe('broadcast', () => {
    const OTHER_GUEST = 'other-guest-uuid' as AccountUuid

    async function getExclude (tx: Tx): Promise<unknown> {
      const { mw } = makeMiddleware()
      const ctx = makeCtx(makeAccount(MEMBER, AccountRole.User), [
        [MEMBER, AccountRole.User],
        [GUEST, AccountRole.Guest],
        [OTHER_GUEST, AccountRole.Guest]
      ])
      await mw.handleBroadcast(ctx)
      return await ctx.contextData.broadcast.targets.guestPerson(tx)
    }

    it('excludes guests that can not see the person', async () => {
      const factory = new TxFactory('test' as PersonId)
      const tx = factory.createTxUpdateDoc(contact.class.Person, core.space.Workspace, 'person:member' as any, {
        name: 'x'
      })
      expect(await getExclude(tx as Tx)).toEqual({ exclude: [OTHER_GUEST] })
    })

    it('ignores unrelated classes', async () => {
      const factory = new TxFactory('test' as PersonId)
      const tx = factory.createTxCreateDoc(core.class.Space, core.space.Space, {} as any)
      expect(await getExclude(tx as Tx)).toBeUndefined()
    })
  })
})
