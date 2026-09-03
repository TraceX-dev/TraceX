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

import core, {
  AccountRole,
  generateId,
  GuestActivityScope,
  MeasureMetricsContext,
  type Account,
  type AccountUuid,
  type Class,
  type Doc,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { SpaceSecurityMiddleware } from '../spaceSecurity'

const CARD_CLASS = 'test:class:Card' as Ref<Class<Doc>>
const MESSAGE_CLASS = 'test:class:Message' as Ref<Class<Doc>>
const CHANNEL_MESSAGE_CLASS = 'test:class:ChannelMessage' as Ref<Class<Doc>>

interface QueryOperator {
  $in?: unknown[]
  $nin?: unknown[]
}

function isQueryOperator (value: unknown): value is QueryOperator {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function matchesQuery (doc: Record<string, unknown>, query: Record<string, unknown> | undefined): boolean {
  for (const key of Object.keys(query ?? {})) {
    const cond = query?.[key]
    const val = doc[key]
    if (isQueryOperator(cond) && cond.$in !== undefined) {
      if (!cond.$in.includes(val)) return false
    } else if (isQueryOperator(cond) && cond.$nin !== undefined) {
      if (cond.$nin.includes(val)) return false
    } else if (val !== cond) {
      return false
    }
  }
  return true
}

function makeAccount (role: AccountRole, uuid: AccountUuid, socialId: PersonId = 'test' as PersonId): Account {
  return {
    uuid,
    role,
    primarySocialId: socialId,
    socialIds: [socialId],
    fullSocialIds: []
  }
}

function makeCtx (account: Account): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = { account, broadcast: { txes: [], queue: [], sessions: {} } } as any
  return ctx
}

async function setup (activityScope?: GuestActivityScope): Promise<{
  mw: SpaceSecurityMiddleware
  ALICE: AccountUuid
  ALICE_SOCIAL: PersonId
  msgOnCardAlice: Ref<Doc>
  msgOnCardBobByBob: Ref<Doc>
  channelMsg: Ref<Doc>
}> {
  const ALICE = generateId() as unknown as AccountUuid
  const BOB = generateId() as unknown as AccountUuid
  const ALICE_SOCIAL = 'social:alice' as PersonId
  const BOB_SOCIAL = 'social:bob' as PersonId

  const SHARED_SPACE = 'test:space:shared' as Ref<Space>

  const cardAlice = { _id: generateId(), _class: CARD_CLASS, space: SHARED_SPACE, createdBy: ALICE_SOCIAL }
  const cardBob = { _id: generateId(), _class: CARD_CLASS, space: SHARED_SPACE, createdBy: BOB_SOCIAL }

  const msgOnCardAlice = {
    _id: generateId(),
    _class: MESSAGE_CLASS,
    space: SHARED_SPACE,
    attachedTo: cardAlice._id,
    attachedToClass: CARD_CLASS,
    createdBy: ALICE_SOCIAL
  }
  const msgOnCardBobByBob = {
    _id: generateId(),
    _class: MESSAGE_CLASS,
    space: SHARED_SPACE,
    attachedTo: cardBob._id,
    attachedToClass: CARD_CLASS,
    createdBy: BOB_SOCIAL
  }
  const messages = [msgOnCardAlice, msgOnCardBobByBob]

  const collaborators = [
    { _id: generateId(), _class: core.class.Collaborator, collaborator: ALICE, attachedTo: cardBob._id }
  ]

  const channelMsg = {
    _id: generateId(),
    _class: CHANNEL_MESSAGE_CLASS,
    space: SHARED_SPACE,
    attachedTo: generateId(),
    attachedToClass: 'test:class:Channel' as Ref<Class<Doc>>,
    createdBy: BOB_SOCIAL
  }

  const sharedSpaceDoc = {
    _id: SHARED_SPACE,
    _class: 'test:class:Channel' as Ref<Class<Doc>>,
    private: false,
    archived: false,
    members: [ALICE, BOB]
  }

  const permissions = activityScope === undefined ? [] : [{ role: AccountRole.Guest, activityScope }]

  const next: Middleware = {
    findAll: (async (_ctx: any, _class: any, query: any) => {
      if (_class === core.class.Space) return [sharedSpaceDoc] as any
      if (_class === core.class.GuestActivitySettings) return permissions.filter((p) => matchesQuery(p, query)) as any
      if (_class === MESSAGE_CLASS) return messages.filter((d) => matchesQuery(d, query)) as any
      if (_class === CHANNEL_MESSAGE_CLASS) return [channelMsg].filter((d) => matchesQuery(d, query)) as any
      if (_class === core.class.Collaborator) return collaborators.filter((d) => matchesQuery(d, query)) as any
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

  const rowVisibilityByClass: Record<string, any> = {
    [CARD_CLASS]: {
      policy: { kind: 'spaceScoped', reason: 'Test card visibility follows space access' },
      allowKnownIdBypass: false,
      scopeActivityToOwner: true
    }
  }

  const hierarchy: any = {
    isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) => {
      if (b === core.class.Space) return a === core.class.Space
      if (b === core.class.AttachedDoc) return a === MESSAGE_CLASS || a === CHANNEL_MESSAGE_CLASS
      return a === b
    },
    getDomain: (_class: Ref<Class<Doc>>) => (_class === core.class.Space ? 'space' : 'test-domain'),
    classHierarchyMixin: (_class: Ref<Class<Doc>>) => rowVisibilityByClass[_class as unknown as string]
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
    ALICE_SOCIAL,
    msgOnCardAlice: msgOnCardAlice._id,
    msgOnCardBobByBob: msgOnCardBobByBob._id,
    channelMsg: channelMsg._id
  }
}

describe('GuestActivitySettings.activityScope', () => {
  it('defaults to Own when no settings document exists', async () => {
    const s = await setup()
    const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE, s.ALICE_SOCIAL))
    const res = await s.mw.findAll(ctx, MESSAGE_CLASS, {})
    expect(res.map((r: any) => r._id)).toEqual([s.msgOnCardAlice])
  })

  it('Any: sees activity on every card, unaffected', async () => {
    const s = await setup(GuestActivityScope.Any)
    const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE, s.ALICE_SOCIAL))
    const res = await s.mw.findAll(ctx, MESSAGE_CLASS, {})
    expect(new Set(res.map((r: any) => r._id))).toEqual(new Set([s.msgOnCardAlice, s.msgOnCardBobByBob]))
  })

  it('Own: sees only activity it authored itself', async () => {
    const s = await setup(GuestActivityScope.Own)
    const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE, s.ALICE_SOCIAL))
    const res = await s.mw.findAll(ctx, MESSAGE_CLASS, {})
    expect(res.map((r: any) => r._id)).toEqual([s.msgOnCardAlice])
  })

  it('Collaborator: sees activity on cards where it is a listed collaborator, not its own uncollaborated card', async () => {
    const s = await setup(GuestActivityScope.Collaborator)
    const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE, s.ALICE_SOCIAL))
    const res = await s.mw.findAll(ctx, MESSAGE_CLASS, {})
    expect(res.map((r: any) => r._id)).toEqual([s.msgOnCardBobByBob])
  })

  it('does not touch activity on a class that has not opted in (e.g. a channel), even under Own', async () => {
    const s = await setup(GuestActivityScope.Own)
    const ctx = makeCtx(makeAccount(AccountRole.Guest, s.ALICE, s.ALICE_SOCIAL))
    const res = await s.mw.findAll(ctx, CHANNEL_MESSAGE_CLASS, {})
    expect(res.map((r: any) => r._id)).toEqual([s.channelMsg])
  })

  it('regular User accounts are never scoped', async () => {
    const s = await setup(GuestActivityScope.Own)
    const ctx = makeCtx(makeAccount(AccountRole.User, s.ALICE, s.ALICE_SOCIAL))
    const res = await s.mw.findAll(ctx, MESSAGE_CLASS, {})
    expect(new Set(res.map((r: any) => r._id))).toEqual(new Set([s.msgOnCardAlice, s.msgOnCardBobByBob]))
  })
})
