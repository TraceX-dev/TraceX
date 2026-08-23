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
 * Scope: only the sensitive classes restricted today. Widening to every class outside ordinary space
 * filtering platform-wide needs a full audit first (dozens of classes are in `core.space.Workspace`
 * for unrelated reasons - shared tags, reactions, global settings, ...) - see the design doc.
 */

import contact, { type SocialIdentityRef } from '@hcengineering/contact'
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

const DOCUMENT_PRESENCE = 'pulse:class:DocumentPresence' as Ref<Class<Doc>>
const TYPING_INDICATOR = 'pulse:class:TypingIndicator' as Ref<Class<Doc>>
const CHAT_MESSAGE = 'chunter:class:ChatMessage' as Ref<Class<Doc>>
const THREAD_MESSAGE = 'chunter:class:ThreadMessage' as Ref<Class<Doc>>
const ATTACHMENT = 'attachment:class:Attachment' as Ref<Class<Doc>>
const SAVED_MESSAGE = 'activity:class:SavedMessage' as Ref<Class<Doc>>
const LOVE_ROOM = 'love:class:Room' as Ref<Class<Doc>>
const LOVE_FLOOR = 'love:class:Floor' as Ref<Class<Doc>>
const PARTICIPANT_INFO = 'love:class:ParticipantInfo' as Ref<Class<Doc>>
const PENDING_RECORDING = 'love:class:PendingRecording' as Ref<Class<Doc>>
const DEVICES_PREFERENCE = 'love:class:DevicesPreference' as Ref<Class<Doc>>
const CARD = 'card:class:Card' as Ref<Class<Doc>>

const SENSITIVE_CLASSES: Array<{ name: string, _class: Ref<Class<Doc>> }> = [
  { name: 'core.class.Collaborator', _class: core.class.Collaborator },
  { name: 'love.class.MeetingMinutes', _class: 'love:class:MeetingMinutes' as Ref<Class<Doc>> },
  { name: 'love.class.RoomInfo', _class: 'love:class:RoomInfo' as Ref<Class<Doc>> },
  { name: 'hr.class.Request', _class: 'hr:class:Request' as Ref<Class<Doc>> },
  { name: 'notification.class.PushSubscription', _class: 'notification:class:PushSubscription' as Ref<Class<Doc>> },
  { name: 'guest.class.PublicLink', _class: 'guest:class:PublicLink' as Ref<Class<Doc>> },
  { name: 'contact.class.SocialIdentity', _class: contact.class.SocialIdentity },
  { name: 'pulse.class.DocumentPresence', _class: DOCUMENT_PRESENCE },
  { name: 'pulse.class.TypingIndicator', _class: TYPING_INDICATOR },
  { name: 'chunter.class.ChatMessage', _class: CHAT_MESSAGE },
  { name: 'chunter.class.ThreadMessage', _class: THREAD_MESSAGE },
  { name: 'attachment.class.Attachment', _class: ATTACHMENT },
  { name: 'activity.class.SavedMessage', _class: SAVED_MESSAGE },
  { name: 'love.class.Room', _class: LOVE_ROOM },
  { name: 'love.class.Floor', _class: LOVE_FLOOR },
  { name: 'love.class.ParticipantInfo', _class: PARTICIPANT_INFO },
  { name: 'love.class.PendingRecording', _class: PENDING_RECORDING },
  { name: 'love.class.DevicesPreference', _class: DEVICES_PREFERENCE },
  { name: 'card.class.Card', _class: CARD }
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

  it('core.class.Collaborator opens Layer 1 to any restricted role, still self-service-only at Layer 2 unless card.ids.GuestCollaboratorClassPermission opts a role in (regression test for the collaborator-edit permission)', () => {
    const COLLABORATOR = core.class.Collaborator as Ref<Class<Doc>>
    const access = hierarchy.classHierarchyMixin(COLLABORATOR, core.mixin.TxAccessLevel)
    expect(access?.createAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(access?.removeAccessLevel).toBe(AccountRole.ReadOnlyGuest)

    const visibility = hierarchy.classHierarchyMixin(COLLABORATOR, core.mixin.RowVisibility)
    expect(visibility?.policy).toEqual({ kind: 'ownerField', field: 'collaborator', identity: 'accountUuid' })
  })

  it('process.class.ApproveRequest opens Layer 1 to any restricted role, scoped to the assigned approver at Layer 2 (regression test for the process-actions permission)', () => {
    const APPROVE_REQUEST = 'process:class:ApproveRequest' as Ref<Class<Doc>>
    const access = hierarchy.classHierarchyMixin(APPROVE_REQUEST, core.mixin.TxAccessLevel)
    expect(access?.updateAccessLevel).toBe(AccountRole.ReadOnlyGuest)

    const visibility = hierarchy.classHierarchyMixin(APPROVE_REQUEST, core.mixin.RowVisibility)
    expect(visibility?.policy).toEqual({ kind: 'ownerField', field: 'user', identity: 'personId' })
  })

  it('hr.class.Request and love.class.MeetingMinutes do not list their own ownerField/linkTargetField as a known-id bypass (regression test for the ownership bypass fix)', () => {
    const hrMixin = hierarchy.classHierarchyMixin('hr:class:Request' as Ref<Class<Doc>>, core.mixin.RowVisibility)
    expect(hrMixin?.knownIdBypassFields ?? []).not.toContain('attachedTo')

    const mmMixin = hierarchy.classHierarchyMixin(
      'love:class:MeetingMinutes' as Ref<Class<Doc>>,
      core.mixin.RowVisibility
    )
    expect(mmMixin?.knownIdBypassFields ?? []).not.toContain('attachedTo')
  })

  it('guest.class.PublicLink is scoped to _id, not a bypassable field (regression guard for the linkId-enumeration fix)', () => {
    const mixin = hierarchy.classHierarchyMixin('guest:class:PublicLink' as Ref<Class<Doc>>, core.mixin.RowVisibility)
    expect(mixin?.policy).toEqual({ kind: 'ownerField', field: '_id', identity: 'linkId' })
    expect(mixin?.allowKnownIdBypass).toBe(false)
  })

  it('contact.class.SocialIdentity is scoped to the current person but supports known-id resolution', () => {
    const mixin = hierarchy.classHierarchyMixin(
      contact.class.SocialIdentity as Ref<Class<Doc>>,
      core.mixin.RowVisibility
    )
    expect(mixin?.policy).toEqual({ kind: 'ownerField', field: 'attachedTo', identity: 'personId' })
    expect(mixin?.allowKnownIdBypass).toBe(true)
  })

  it('pulse.class.DocumentPresence is public ephemeral activity state', () => {
    const mixin = hierarchy.classHierarchyMixin(DOCUMENT_PRESENCE, core.mixin.RowVisibility)
    expect(mixin?.policy.kind).toBe('publicReadable')
    expect(mixin?.allowKnownIdBypass).toBe(false)
  })

  it('pulse.class.DocumentPresence permits writes starting from ReadOnlyGuest', () => {
    const mixin = hierarchy.classHierarchyMixin(DOCUMENT_PRESENCE, core.mixin.TxAccessLevel)
    expect(mixin?.createAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(mixin?.updateAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(mixin?.removeAccessLevel).toBe(AccountRole.ReadOnlyGuest)
  })

  it('pulse.class.TypingIndicator is public ephemeral activity state', () => {
    const visibility = hierarchy.classHierarchyMixin(TYPING_INDICATOR, core.mixin.RowVisibility)
    expect(visibility?.policy.kind).toBe('publicReadable')
    expect(visibility?.allowKnownIdBypass).toBe(false)

    const access = hierarchy.classHierarchyMixin(TYPING_INDICATOR, core.mixin.TxAccessLevel)
    expect(access?.createAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(access?.updateAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(access?.removeAccessLevel).toBe(AccountRole.ReadOnlyGuest)
  })

  it.each([CHAT_MESSAGE, THREAD_MESSAGE])('%s restricts writes to the original author', (_class) => {
    const visibility = hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility)
    expect(visibility?.policy.kind).toBe('publicReadable')
    expect((visibility as typeof visibility & { writePolicy?: object })?.writePolicy).toEqual({
      kind: 'ownerField',
      field: 'createdBy',
      identity: 'socialId'
    })
    expect(visibility?.allowKnownIdBypass).toBe(false)

    const access = hierarchy.classHierarchyMixin(_class, core.mixin.TxAccessLevel)
    expect(access?.createAccessLevel).toBe(AccountRole.Guest)
    expect(access?.updateAccessLevel).toBe(AccountRole.Guest)
    expect(access?.removeAccessLevel).toBe(AccountRole.Guest)
  })

  it('attachment.class.Attachment restricts writes to the uploader', () => {
    const visibility = hierarchy.classHierarchyMixin(ATTACHMENT, core.mixin.RowVisibility)
    expect(visibility?.policy.kind).toBe('publicReadable')
    expect((visibility as typeof visibility & { writePolicy?: object })?.writePolicy).toEqual({
      kind: 'ownerField',
      field: 'createdBy',
      identity: 'socialId'
    })
    expect(visibility?.allowKnownIdBypass).toBe(false)

    const access = hierarchy.classHierarchyMixin(ATTACHMENT, core.mixin.TxAccessLevel)
    expect(access?.createAccessLevel).toBe(AccountRole.Guest)
    expect(access?.updateAccessLevel).toBe(AccountRole.Guest)
    expect(access?.removeAccessLevel).toBe(AccountRole.Guest)
  })

  it('activity.class.SavedMessage is private to the account social identity', () => {
    const visibility = hierarchy.classHierarchyMixin(SAVED_MESSAGE, core.mixin.RowVisibility)
    expect(visibility?.policy).toEqual({ kind: 'ownerField', field: 'createdBy', identity: 'socialId' })
    expect(visibility?.allowKnownIdBypass).toBe(false)

    const access = hierarchy.classHierarchyMixin(SAVED_MESSAGE, core.mixin.TxAccessLevel)
    expect(access?.createAccessLevel).toBe(AccountRole.Guest)
    expect(access?.updateAccessLevel).toBe(AccountRole.Guest)
    expect(access?.removeAccessLevel).toBe(AccountRole.Guest)
  })

  it('card.class.Card restricts updates to the creator, reads stay ordinary space-scoped (regression test for the File-card guest-upload fix)', () => {
    const visibility = hierarchy.classHierarchyMixin(CARD, core.mixin.RowVisibility)
    expect(visibility?.policy.kind).toBe('publicReadable')
    expect((visibility as typeof visibility & { writePolicy?: object })?.writePolicy).toEqual({
      kind: 'ownerField',
      field: 'createdBy',
      identity: 'socialId'
    })
    expect(visibility?.allowKnownIdBypass).toBe(false)

    const access = hierarchy.classHierarchyMixin(CARD, core.mixin.TxAccessLevel)
    expect(access?.updateAccessLevel).toBe(AccountRole.Guest)
  })

  it('Office room activity is scoped through room collaborators', () => {
    const expectedPolicy = {
      kind: 'linkedViaRecord',
      linkClass: core.class.Collaborator,
      linkTargetField: 'attachedTo',
      linkIdentityField: 'collaborator',
      identity: 'accountUuid',
      targetField: 'room',
      through: {
        documentClass: 'love:class:MeetingMinutes',
        sourceField: '_id',
        targetField: 'attachedTo',
        includeDirect: true
      }
    }
    expect(hierarchy.classHierarchyMixin(PARTICIPANT_INFO, core.mixin.RowVisibility)?.policy).toEqual(expectedPolicy)
    expect(
      hierarchy.classHierarchyMixin('love:class:RoomInfo' as Ref<Class<Doc>>, core.mixin.RowVisibility)?.policy
    ).toEqual(expectedPolicy)
  })

  it('Office floors are public metadata and device preferences remain private', () => {
    expect(hierarchy.classHierarchyMixin(LOVE_FLOOR, core.mixin.RowVisibility)?.policy.kind).toBe('publicReadable')
    expect(hierarchy.classHierarchyMixin(DEVICES_PREFERENCE, core.mixin.RowVisibility)?.policy).toEqual({
      kind: 'ownerField',
      field: 'createdBy',
      identity: 'socialId'
    })
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

    // Regression test for the ownership bypass fix: attachedTo is the field the policy itself
    // protects, so querying by Bob's attachedTo (his Person id) must not resolve his request.
    const byAttachedTo = await mw.findAll(ctx, HR_REQUEST, { attachedTo: reqBob.attachedTo })
    expect(byAttachedTo).toHaveLength(0)
  })

  it('contact.class.SocialIdentity: a Guest sees only identities attached to its own Person', async () => {
    const ALICE = generateId() as unknown as AccountUuid
    const personAlice = {
      _id: generateId(),
      _class: contact.class.Person,
      personUuid: ALICE,
      space: contact.space.Contacts
    }
    const ownIdentity = {
      _id: 'test:alice-social' as SocialIdentityRef,
      _class: contact.class.SocialIdentity,
      attachedTo: personAlice._id,
      space: contact.space.Contacts
    }
    const otherIdentity = {
      _id: 'test:other-social' as SocialIdentityRef,
      _class: contact.class.SocialIdentity,
      attachedTo: generateId(),
      space: contact.space.Contacts
    }

    const next: Middleware = {
      findAll: (async (_ctx: any, _class: any, query: any) => {
        if (_class === core.class.Space) return []
        if (_class === contact.class.Person) return [personAlice].filter((d) => matches(d, query)) as any
        if (_class === contact.class.SocialIdentity) {
          return [ownIdentity, otherIdentity].filter((d) => matches(d, query)) as any
        }
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

    const visible = await mw.findAll(ctx, contact.class.SocialIdentity, {})
    expect(visible.map((identity: any) => identity._id)).toEqual([ownIdentity._id])

    const foreignByKnownId = await mw.findAll(ctx, contact.class.SocialIdentity, { _id: otherIdentity._id })
    expect(foreignByKnownId.map((identity: any) => identity._id)).toEqual([otherIdentity._id])
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
