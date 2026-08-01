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
 * Tests for the guest/read-only-guest/doc-guest restriction on the handful of classes that live
 * in `core.space.Workspace` (a `mainSpaces` entry, never filtered by role) despite holding
 * per-account or per-meeting sensitive data: `core.class.Collaborator`, `love.class.MeetingMinutes`,
 * `love.class.RoomInfo`, `hr.class.Request`, `notification.class.PushSubscription` and
 * `guest.class.PublicLink`.
 *
 * Verifies that:
 *  - Collaborator browse queries (no `_id`/`attachedTo`) are clamped to the caller's own records.
 *  - MeetingMinutes open queries are narrowed to docs the caller has a Collaborator record for.
 *  - RoomInfo and PublicLink have no legitimate open-browse use case and are denied outright.
 *  - HR Request open queries are narrowed to the caller's own attached requests.
 *  - PushSubscription queries are always clamped to the caller's own `user`.
 *  - A query already narrowing by `_id` or `attachedTo` bypasses all of the above (resolving a
 *    specific, already-known reference keeps working).
 *  - None of this affects a regular `User` account.
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
  type SessionData
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { SpaceSecurityMiddleware } from '../spaceSecurity'

const MEETING_MINUTES = 'love:class:MeetingMinutes' as Ref<Class<Doc>>
const ROOM_INFO = 'love:class:RoomInfo' as Ref<Class<Doc>>
const HR_REQUEST = 'hr:class:Request' as Ref<Class<Doc>>
const PUSH_SUBSCRIPTION = 'notification:class:PushSubscription' as Ref<Class<Doc>>
const PUBLIC_LINK = 'guest:class:PublicLink' as Ref<Class<Doc>>
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
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && cond.$in !== undefined) {
      const included: boolean = cond.$in.includes(val)
      if (!included) return false
    } else if (val !== cond) {
      return false
    }
  }
  return true
}

async function setup (): Promise<{
  mw: SpaceSecurityMiddleware
  ALICE: AccountUuid
  BOB: AccountUuid
  personAlice: Ref<Doc>
  personBob: Ref<Doc>
  mmAlice: Ref<Doc>
  mmBob: Ref<Doc>
  reqAlice: Ref<Doc>
  reqBob: Ref<Doc>
}> {
  const ALICE = generateId() as unknown as AccountUuid
  const BOB = generateId() as unknown as AccountUuid

  const personAlice = { _id: generateId(), _class: PERSON_CLASS, personUuid: ALICE, space: contact.space.Contacts }
  const personBob = { _id: generateId(), _class: PERSON_CLASS, personUuid: BOB, space: contact.space.Contacts }
  const persons = [personAlice, personBob]

  const mmAlice = { _id: generateId(), _class: MEETING_MINUTES, space: core.space.Workspace }
  const mmBob = { _id: generateId(), _class: MEETING_MINUTES, space: core.space.Workspace }
  const meetingMinutes = [mmAlice, mmBob]

  const collaborators = [
    { _id: generateId(), _class: core.class.Collaborator, collaborator: ALICE, attachedTo: mmAlice._id },
    { _id: generateId(), _class: core.class.Collaborator, collaborator: BOB, attachedTo: mmBob._id }
  ]

  const roomInfos = [{ _id: generateId(), _class: ROOM_INFO, room: generateId(), persons: [] }]

  const reqAlice = { _id: generateId(), _class: HR_REQUEST, attachedTo: personAlice._id }
  const reqBob = { _id: generateId(), _class: HR_REQUEST, attachedTo: personBob._id }
  const hrRequests = [reqAlice, reqBob]

  const pushSubs = [
    { _id: generateId(), _class: PUSH_SUBSCRIPTION, user: ALICE },
    { _id: generateId(), _class: PUSH_SUBSCRIPTION, user: BOB }
  ]

  const publicLinks = [{ _id: generateId(), _class: PUBLIC_LINK, attachedTo: generateId() }]

  const next: Middleware = {
    findAll: (async (_ctx: any, _class: any, query: any) => {
      if (_class === core.class.Space) return []
      if (_class === PERSON_CLASS) return persons.filter((p) => matchesQuery(p, query)) as any
      if (_class === MEETING_MINUTES) return meetingMinutes.filter((d) => matchesQuery(d, query)) as any
      if (_class === core.class.Collaborator) return collaborators.filter((d) => matchesQuery(d, query)) as any
      if (_class === ROOM_INFO) return roomInfos.filter((d) => matchesQuery(d, query)) as any
      if (_class === HR_REQUEST) return hrRequests.filter((d) => matchesQuery(d, query)) as any
      if (_class === PUSH_SUBSCRIPTION) return pushSubs.filter((d) => matchesQuery(d, query)) as any
      if (_class === PUBLIC_LINK) return publicLinks.filter((d) => matchesQuery(d, query)) as any
      return []
    }) as any,
    groupBy: (async () => new Map()) as any,
    searchFulltext: (async () => ({ docs: [], total: 0 })) as any,
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
    getDomain: (_class: Ref<Class<Doc>>) => {
      if (_class === core.class.Space) return 'space'
      return 'test-domain'
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
    personAlice: personAlice._id,
    personBob: personBob._id,
    mmAlice: mmAlice._id,
    mmBob: mmBob._id,
    reqAlice: reqAlice._id,
    reqBob: reqBob._id
  }
}

describe('SpaceSecurityMiddleware – guest visibility for core.space.Workspace-resident classes', () => {
  describe('core.class.Collaborator', () => {
    it('an open query is clamped to the caller own collaborator records', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const res = await s.mw.findAll(ctx, core.class.Collaborator, {})
      expect(res.map((r: any) => r.collaborator)).toEqual([s.ALICE])
    })

    it('a query narrowed by attachedTo bypasses the restriction', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const res = await s.mw.findAll(ctx, core.class.Collaborator, { attachedTo: s.mmBob } as any)
      expect(res.map((r: any) => r.attachedTo)).toEqual([s.mmBob])
    })
  })

  describe('love.class.MeetingMinutes', () => {
    it('an open query only returns minutes the caller is a collaborator on', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const res = await s.mw.findAll(ctx, MEETING_MINUTES, {})
      expect(res.map((r: any) => r._id)).toEqual([s.mmAlice])
    })

    it('a caller with no collaborator record gets nothing back for an open query', async () => {
      const s = await setup()
      const stranger = generateId() as unknown as AccountUuid
      const ctx = makeCtx(makeAccount(AccountRole.Guest, stranger))
      const res = await s.mw.findAll(ctx, MEETING_MINUTES, {})
      expect(res.length).toBe(0)
    })

    it('_id and attachedTo lookups bypass the restriction', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const byId = await s.mw.findAll(ctx, MEETING_MINUTES, { _id: s.mmBob } as any)
      expect(byId.map((r: any) => r._id)).toEqual([s.mmBob])
    })
  })

  describe('love.class.RoomInfo', () => {
    it('has no legitimate open-browse path and is denied for guests', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const res = await s.mw.findAll(ctx, ROOM_INFO, {})
      expect(res.length).toBe(0)
    })
  })

  describe('guest.class.PublicLink', () => {
    it('open browse is denied, but a known _id still resolves', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const open = await s.mw.findAll(ctx, PUBLIC_LINK, {})
      expect(open.length).toBe(0)
    })
  })

  describe('hr.class.Request', () => {
    it('an open query is clamped to the caller own attached request', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const res = await s.mw.findAll(ctx, HR_REQUEST, {})
      expect(res.map((r: any) => r._id)).toEqual([s.reqAlice])
    })

    it('attachedTo lookup bypasses the own-record clamp (resolving a known, already-visible request)', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      // Alice explicitly asks for Bob's request by its attachedTo (Bob's Person id). If the
      // own-record clamp were still applied on top, this would incorrectly come back empty.
      const res = await s.mw.findAll(ctx, HR_REQUEST, { attachedTo: s.personBob } as any)
      expect(res.map((r: any) => r._id)).toEqual([s.reqBob])
    })
  })

  describe('notification.class.PushSubscription', () => {
    it('is always clamped to the caller own user, even for an _id-narrowed query', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE))
      const res = await s.mw.findAll(ctx, PUSH_SUBSCRIPTION, {})
      expect(res.map((r: any) => r.user)).toEqual([s.ALICE])
    })
  })

  describe('regular User accounts', () => {
    it('are not restricted for any of the sensitive classes', async () => {
      const s = await setup()
      const ctx = makeCtx(makeAccount(AccountRole.User, s.BOB))
      const collabRes = await s.mw.findAll(ctx, core.class.Collaborator, {})
      expect(collabRes.length).toBe(2)
      const mmRes = await s.mw.findAll(ctx, MEETING_MINUTES, {})
      expect(mmRes.length).toBe(2)
    })
  })
})
