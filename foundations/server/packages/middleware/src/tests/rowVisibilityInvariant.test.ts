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
 * CI invariant: every class `SpaceSecurityMiddleware` row-level-restricts must declare
 * `core.mixin.RowVisibility` - a missing policy should fail the build, not a later review.
 *
 * Scope: only the 6 classes restricted today. Widening to every class outside ordinary space
 * filtering platform-wide needs a full audit first (dozens of classes are in `core.space.Workspace`
 * for unrelated reasons - shared tags, reactions, global settings, ...) - see the design doc.
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
  type Hierarchy,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData
} from '@hcengineering/core'
import buildModel from '@hcengineering/model-all'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { SpaceSecurityMiddleware } from '../spaceSecurity'

const SENSITIVE_CLASSES: Array<{ name: string, _class: Ref<Class<Doc>> }> = [
  { name: 'core.class.Collaborator', _class: core.class.Collaborator },
  { name: 'love.class.MeetingMinutes', _class: 'love:class:MeetingMinutes' as Ref<Class<Doc>> },
  { name: 'love.class.RoomInfo', _class: 'love:class:RoomInfo' as Ref<Class<Doc>> },
  { name: 'hr.class.Request', _class: 'hr:class:Request' as Ref<Class<Doc>> },
  { name: 'notification.class.PushSubscription', _class: 'notification:class:PushSubscription' as Ref<Class<Doc>> },
  { name: 'guest.class.PublicLink', _class: 'guest:class:PublicLink' as Ref<Class<Doc>> }
]

describe('RowVisibility invariant', () => {
  let hierarchy: Hierarchy

  beforeAll(() => {
    hierarchy = buildModel().hierarchy
  })

  it.each(SENSITIVE_CLASSES)('$name declares core.mixin.RowVisibility', ({ _class }) => {
    const mixin = hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility)
    expect(mixin).toBeDefined()
    expect(mixin?.policy).toBeDefined()
    expect(typeof mixin?.allowKnownIdBypass).toBe('boolean')
  })

  it('guest.class.PublicLink is scoped to _id, not a bypassable field (regression guard for the linkId-enumeration fix)', () => {
    const mixin = hierarchy.classHierarchyMixin('guest:class:PublicLink' as Ref<Class<Doc>>, core.mixin.RowVisibility)
    expect(mixin?.policy).toEqual({ kind: 'ownerField', field: '_id', identity: 'linkId' })
    expect(mixin?.allowKnownIdBypass).toBe(false)
  })
})

/**
 * Closes the gap the two tests above don't cover: `spaceSecuritySensitiveClasses.test.ts` proves
 * `RowVisibilityResolver` behaves correctly against a hand-copied mock of the policies, and the
 * `it.each` above proves the real model declares *some* policy - but nothing proves the two agree.
 * A typo in a model registration (wrong field name, wrong `identity`) would pass both suites.
 *
 * Here `SpaceSecurityMiddleware.findAll` runs against the real `buildModel()` hierarchy, so
 * `classHierarchyMixin` returns what's actually registered in `models/hr` and `models/guest`.
 */
describe('RowVisibility integration - real model + real resolver', () => {
  let hierarchy: Hierarchy

  beforeAll(() => {
    hierarchy = buildModel().hierarchy
  })

  function makeAccount (role: AccountRole, uuid: AccountUuid): Account {
    return {
      uuid,
      role,
      primarySocialId: 'test' as PersonId,
      socialIds: ['test' as PersonId],
      fullSocialIds: []
    }
  }

  function makeCtx (account: Account, extra?: Record<string, any>): MeasureContext<SessionData> {
    const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
    ctx.contextData = {
      account,
      broadcast: { txes: [], queue: [], sessions: {} },
      extra
    } as any
    return ctx
  }

  function matches (doc: Record<string, any>, query: Record<string, any> | undefined): boolean {
    for (const key of Object.keys(query ?? {})) {
      const cond = (query as any)[key]
      const val = doc[key]
      if (cond !== null && typeof cond === 'object' && !Array.isArray(cond) && cond.$in !== undefined) {
        if (!(cond.$in as any[]).includes(val)) return false
      } else if (val !== cond) {
        return false
      }
    }
    return true
  }

  it('hr.class.Request: real model registration + real resolver clamp open queries to the caller own request', async () => {
    const HR_REQUEST = 'hr:class:Request' as Ref<Class<Doc>>
    const ALICE = generateId() as unknown as AccountUuid
    const personAlice = {
      _id: generateId(),
      _class: contact.class.Person,
      personUuid: ALICE,
      space: contact.space.Contacts
    }
    const reqAlice = { _id: generateId(), _class: HR_REQUEST, attachedTo: personAlice._id }
    const reqBob = { _id: generateId(), _class: HR_REQUEST, attachedTo: generateId() }

    const next: Middleware = {
      findAll: (async (_ctx: any, _class: any, query: any) => {
        if (_class === core.class.Space) return []
        if (_class === contact.class.Person) return [personAlice].filter((d) => matches(d, query)) as any
        if (_class === HR_REQUEST) return [reqAlice, reqBob].filter((d) => matches(d, query)) as any
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
    const ctx = makeCtx(makeAccount(AccountRole.Guest, ALICE))
    const res = await mw.findAll(ctx, HR_REQUEST, {})
    expect(res.map((r: any) => r._id)).toEqual([reqAlice._id])
  })

  it("guest.class.PublicLink: real model registration + real resolver deny a known _id for someone else's link (enumeration-fix regression, end-to-end)", async () => {
    const PUBLIC_LINK = 'guest:class:PublicLink' as Ref<Class<Doc>>
    const ALICE = generateId() as unknown as AccountUuid
    const linkAlice = { _id: generateId(), _class: PUBLIC_LINK, attachedTo: generateId() }
    const linkOther = { _id: generateId(), _class: PUBLIC_LINK, attachedTo: generateId() }

    const next: Middleware = {
      findAll: (async (_ctx: any, _class: any, query: any) => {
        if (_class === core.class.Space) return []
        if (_class === PUBLIC_LINK) return [linkAlice, linkOther].filter((d) => matches(d, query)) as any
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
    const ctx = makeCtx(makeAccount(AccountRole.DocGuest, ALICE), { linkId: linkAlice._id })

    const own = await mw.findAll(ctx, PUBLIC_LINK, { _id: linkAlice._id } as any)
    expect(own.map((r: any) => r._id)).toEqual([linkAlice._id])

    const other = await mw.findAll(ctx, PUBLIC_LINK, { _id: linkOther._id } as any)
    expect(other.length).toBe(0)
  })
})
