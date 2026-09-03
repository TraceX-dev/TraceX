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
  type SessionData,
  ownBy,
  linkedViaCollaborator
} from '@hcengineering/core'
import buildModel from '@hcengineering/model-all'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { SpaceSecurityMiddleware } from '../spaceSecurity'
import {
  renderRowVisibilityPolicyTable,
  resolveRegisteredRowVisibilityPolicies,
  validateRowVisibilityRegistrations
} from '../securityPolicyRegistry'

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

describe('RowVisibility invariant', () => {
  let hierarchy: Hierarchy

  beforeAll(() => {
    hierarchy = buildModel().hierarchy
  })

  // The inventory is read out of the model rather than maintained by hand, so this asserts the
  // declarations are well formed instead of asserting a list matches itself.
  it('every declared row policy is well formed', () => {
    expect(validateRowVisibilityRegistrations(hierarchy)).toEqual([])
  })

  it('declares a policy for the classes that need one', () => {
    const declared = new Set(resolveRegisteredRowVisibilityPolicies(hierarchy).map((p) => p.name))
    for (const _class of [
      core.class.Collaborator,
      contact.class.Person,
      contact.class.SocialIdentity,
      CHAT_MESSAGE,
      THREAD_MESSAGE,
      ATTACHMENT,
      SAVED_MESSAGE,
      CARD,
      DOCUMENT_PRESENCE,
      TYPING_INDICATOR,
      LOVE_ROOM,
      LOVE_FLOOR,
      PARTICIPANT_INFO,
      PENDING_RECORDING,
      DEVICES_PREFERENCE
    ]) {
      expect(declared).toContain(_class as string)
    }
  })

  it('generates the policy table from the model', () => {
    const table = renderRowVisibilityPolicyTable(hierarchy)
    for (const { name } of resolveRegisteredRowVisibilityPolicies(hierarchy)) {
      expect(table).toContain(`\`${name}\``)
    }
  })

  it('core.class.Collaborator is gated by a permission at Layer 1 and by parent ownership at Layer 2 (regression test for the collaborator-edit permission)', () => {
    const COLLABORATOR = core.class.Collaborator as Ref<Class<Doc>>
    // No static access level: card.ids.GuestCollaboratorClassPermission is the only Layer 1 gate,
    // so an administrator turning it off actually turns the capability off.
    expect(hierarchy.classHierarchyMixin(COLLABORATOR, core.mixin.TxAccessLevel)).toBeUndefined()

    const visibility = hierarchy.classHierarchyMixin(COLLABORATOR, core.mixin.RowVisibility)
    expect(visibility?.policy).toEqual(ownBy('collaborator', 'accountUuid'))
    // Writing is a different question from reading: the caller must have created the parent.
    const writePolicy = (visibility as typeof visibility & { writePolicy?: any })?.writePolicy
    expect(writePolicy?.kind).toBe('relation')
    expect(writePolicy?.path?.steps?.[0]?.via).toEqual({ classFromField: 'attachedToClass' })
    expect(writePolicy?.path?.to).toBe('attachedTo')
  })

  it('process.class.ApproveRequest is gated by a permission at Layer 1 and scoped to the assigned approver at Layer 2 (regression test for the process-actions permission)', () => {
    const APPROVE_REQUEST = 'process:class:ApproveRequest' as Ref<Class<Doc>>
    // No static access level: process.ids.GuestApproveRequestClassPermission is the only Layer 1
    // gate, and it covers update and mixin - which is what approving or rejecting actually is.
    expect(hierarchy.classHierarchyMixin(APPROVE_REQUEST, core.mixin.TxAccessLevel)).toBeUndefined()

    const visibility = hierarchy.classHierarchyMixin(APPROVE_REQUEST, core.mixin.RowVisibility)
    expect(visibility?.policy).toEqual(ownBy('user', 'personId'))
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
    expect(mixin?.policy).toEqual(ownBy('_id', 'linkId'))
    expect(mixin?.allowKnownIdBypass).not.toBe(true)
  })

  it('contact.class.SocialIdentity is scoped to the current person but supports known-id resolution', () => {
    const mixin = hierarchy.classHierarchyMixin(
      contact.class.SocialIdentity as Ref<Class<Doc>>,
      core.mixin.RowVisibility
    )
    expect(mixin?.policy).toEqual(ownBy('attachedTo', 'personId'))
    expect(mixin?.allowKnownIdBypass).toBe(true)
  })

  it('pulse.class.DocumentPresence is space-scoped ephemeral activity state', () => {
    const mixin = hierarchy.classHierarchyMixin(DOCUMENT_PRESENCE, core.mixin.RowVisibility)
    expect(mixin?.policy.kind).toBe('spaceScoped')
    expect(mixin?.allowKnownIdBypass).not.toBe(true)
  })

  it('pulse.class.DocumentPresence permits writes starting from ReadOnlyGuest', () => {
    const mixin = hierarchy.classHierarchyMixin(DOCUMENT_PRESENCE, core.mixin.TxAccessLevel)
    expect(mixin?.createAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(mixin?.updateAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(mixin?.removeAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(mixin?.allowViewerWrite).toBe(true)
  })

  it('pulse.class.TypingIndicator is space-scoped ephemeral activity state', () => {
    const visibility = hierarchy.classHierarchyMixin(TYPING_INDICATOR, core.mixin.RowVisibility)
    expect(visibility?.policy.kind).toBe('spaceScoped')
    expect(visibility?.allowKnownIdBypass).not.toBe(true)

    const access = hierarchy.classHierarchyMixin(TYPING_INDICATOR, core.mixin.TxAccessLevel)
    expect(access?.createAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(access?.updateAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(access?.removeAccessLevel).toBe(AccountRole.ReadOnlyGuest)
    expect(access?.allowViewerWrite).toBe(true)
  })

  it.each([CHAT_MESSAGE, THREAD_MESSAGE])('%s restricts writes to the original author', (_class) => {
    const visibility = hierarchy.classHierarchyMixin(_class, core.mixin.RowVisibility)
    expect(visibility?.policy.kind).toBe('spaceScoped')
    expect((visibility as typeof visibility & { writePolicy?: object })?.writePolicy).toEqual(ownBy('createdBy', 'socialId'))
    expect(visibility?.allowKnownIdBypass).not.toBe(true)

    const access = hierarchy.classHierarchyMixin(_class, core.mixin.TxAccessLevel)
    expect(access?.createAccessLevel).toBe(AccountRole.Guest)
    expect(access?.updateAccessLevel).toBe(AccountRole.Guest)
    expect(access?.removeAccessLevel).toBe(AccountRole.Guest)
  })

  it('attachment.class.Attachment restricts writes to the uploader', () => {
    const visibility = hierarchy.classHierarchyMixin(ATTACHMENT, core.mixin.RowVisibility)
    expect(visibility?.policy.kind).toBe('spaceScoped')
    expect((visibility as typeof visibility & { writePolicy?: object })?.writePolicy).toEqual(ownBy('createdBy', 'socialId'))
    expect(visibility?.allowKnownIdBypass).not.toBe(true)

    const access = hierarchy.classHierarchyMixin(ATTACHMENT, core.mixin.TxAccessLevel)
    expect(access?.createAccessLevel).toBe(AccountRole.Guest)
    expect(access?.updateAccessLevel).toBe(AccountRole.Guest)
    expect(access?.removeAccessLevel).toBe(AccountRole.Guest)
  })

  it('activity.class.SavedMessage is private to the account social identity', () => {
    const visibility = hierarchy.classHierarchyMixin(SAVED_MESSAGE, core.mixin.RowVisibility)
    expect(visibility?.policy).toEqual(ownBy('createdBy', 'socialId'))
    expect(visibility?.allowKnownIdBypass).not.toBe(true)

    const access = hierarchy.classHierarchyMixin(SAVED_MESSAGE, core.mixin.TxAccessLevel)
    expect(access?.createAccessLevel).toBe(AccountRole.Guest)
    expect(access?.updateAccessLevel).toBe(AccountRole.Guest)
    expect(access?.removeAccessLevel).toBe(AccountRole.Guest)
  })

  it('card.class.Card restricts updates to the creator, reads stay ordinary space-scoped (regression test for the File-card guest-upload fix)', () => {
    const visibility = hierarchy.classHierarchyMixin(CARD, core.mixin.RowVisibility)
    expect(visibility?.policy.kind).toBe('spaceScoped')
    expect((visibility as typeof visibility & { writePolicy?: object })?.writePolicy).toEqual(ownBy('createdBy', 'socialId'))
    expect(visibility?.allowKnownIdBypass).not.toBe(true)

    const access = hierarchy.classHierarchyMixin(CARD, core.mixin.TxAccessLevel)
    expect(access?.updateAccessLevel).toBe(AccountRole.Guest)
  })

  it('Office room activity is scoped through room collaborators', () => {
    const expectedPolicy = linkedViaCollaborator(
      core.class.Collaborator,
      'attachedTo',
      'collaborator',
      'accountUuid',
      {
        targetField: 'room',
        through: {
          documentClass: 'love:class:MeetingMinutes' as Ref<Class<Doc>>,
          sourceField: '_id',
          targetField: 'attachedTo',
          includeDirect: true
        }
      }
    )
    expect(hierarchy.classHierarchyMixin(PARTICIPANT_INFO, core.mixin.RowVisibility)?.policy).toEqual(expectedPolicy)
    expect(
      hierarchy.classHierarchyMixin('love:class:RoomInfo' as Ref<Class<Doc>>, core.mixin.RowVisibility)?.policy
    ).toEqual(expectedPolicy)
  })

  it('Office floors are public metadata and device preferences remain private', () => {
    expect(hierarchy.classHierarchyMixin(LOVE_FLOOR, core.mixin.RowVisibility)?.policy.kind).toBe('spaceScoped')
    expect(hierarchy.classHierarchyMixin(DEVICES_PREFERENCE, core.mixin.RowVisibility)?.policy).toEqual(ownBy('createdBy', 'socialId'))
  })
})

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
