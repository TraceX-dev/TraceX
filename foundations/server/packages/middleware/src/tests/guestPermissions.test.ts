//
// Copyright © 2025 Hardcore Engineering Inc.
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

/**
 * Tests for GuestPermissionsMiddleware
 *
 * Verifies that:
 *  - Non-guest users pass through without restriction.
 *  - Restricted users are forbidden unless a class explicitly declares a sufficient access level.
 *  - For covered classes (resolved from module allowedPermissions):
 *      new permission model is authoritative; TxAccessLevel is ignored.
 *      Create in any space → permitted.
 *  - For uncovered classes: TxAccessLevel fallback is used.
 */

import core, {
  AccountRole,
  generateId,
  Hierarchy,
  MeasureMetricsContext,
  type Account,
  type Class,
  type Doc,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  TxFactory
} from '@hcengineering/core'
import contact from '@hcengineering/contact'
import type { PipelineContext, TxMiddlewareResult } from '@hcengineering/server-core'
import { GuestPermissionsMiddleware } from '../guestPermissions'

const COVERED_CLASS = 'test:class:CoveredClass' as Ref<Class<Doc>>
const UNCOVERED_CLASS = 'test:class:UncoveredClass' as Ref<Class<Doc>>
const COVERED_CLASS_PERMISSION = 'test:permission:CoveredClassPermission' as Ref<Doc>
const MODULE_PERMISSION_GROUP_CLASS = core.class.ModulePermissionGroup
const ALLOWED_SPACE = 'test:space:Allowed' as Ref<Space>
const FORBIDDEN_SPACE = 'test:space:Forbidden' as Ref<Space>
const DOCUMENT_PRESENCE = 'pulse:class:DocumentPresence' as Ref<Class<Doc>>
const TYPING_INDICATOR = 'pulse:class:TypingIndicator' as Ref<Class<Doc>>
const CHAT_MESSAGE = 'chunter:class:ChatMessage' as Ref<Class<Doc>>
const ATTACHMENT = 'attachment:class:Attachment' as Ref<Class<Doc>>
const SAVED_MESSAGE = 'activity:class:SavedMessage' as Ref<Class<Doc>>

interface TestDocumentPresence extends Doc {
  person: Ref<Doc>
  lastActive: number
}

interface TestTypingIndicator extends Doc {
  socialId: PersonId
  status?: string
}

interface TestChatMessage extends Doc {
  message: string
}

function makeAccount (role: AccountRole): Account {
  return {
    uuid: generateId() as any,
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

type FindAllFn = (ctx: MeasureContext, _class: Ref<Class<Doc>>, query: object, options?: object) => Promise<Doc[]>

function makePipelineContext (findAll?: FindAllFn): PipelineContext {
  const hierarchy = new Hierarchy()
  const model = { findAllSync: (_class: any, _query: any) => [] } as any
  return {
    workspace: { uuid: 'test-workspace' as any, url: 'test', dataId: 'test' as any },
    hierarchy,
    modelDb: model,
    branding: null as any,
    adapterManager: {} as any,
    storageAdapter: {} as any,
    contextVars: {},
    lastTx: '',
    lastHash: '',
    broadcastEvent: async () => {}
  } as any
}

function makeMiddleware (
  findAll: FindAllFn,
  nextFn?: (ctx: MeasureContext, txes: Tx[]) => Promise<TxMiddlewareResult>
): GuestPermissionsMiddleware {
  const context = makePipelineContext(findAll)
  const next = {
    findAll,
    tx: nextFn ?? (async (_ctx: MeasureContext, _txes: Tx[]) => ({}))
  }
  const mw = new (GuestPermissionsMiddleware as any)(context, next)
  // Override findAll to inject our test data
  mw.findAll = findAll
  return mw
}

function makeCreateTx (objectClass: Ref<Class<Doc>>, objectSpace: Ref<Space>): Tx {
  const factory = new TxFactory('test:account:System' as PersonId)
  return factory.createTxCreateDoc(objectClass, objectSpace, {})
}

// Helper: buildGuestSettings - simulate the document ClassAccessResolver would find
function makeGuestSettingsDoc (allowedPermissions: Ref<Doc>[], disabledPermissions?: Ref<Doc>[]): Doc {
  return {
    _id: generateId(),
    _class: MODULE_PERMISSION_GROUP_CLASS,
    space: 'core:space:Workspace' as Ref<Space>,
    modifiedOn: Date.now(),
    modifiedBy: 'test' as PersonId,
    application: 'test:app:tracker' as Ref<Doc>,
    role: AccountRole.Guest,
    permissions: allowedPermissions,
    ...(disabledPermissions !== undefined && disabledPermissions.length > 0 ? { disabledPermissions } : {}),
    spaceClass: 'core:class:Space' as Ref<Class<Doc>>,
    enabled: true
  } as any
}

describe('GuestPermissionsMiddleware', () => {
  // ─── Non-guest users pass through ───────────────────────────────────────────
  describe('non-guest users', () => {
    it('User role: passes through without restriction', async () => {
      let nextCalled = false
      const mw = makeMiddleware(
        async () => [],
        async (ctx, txes) => {
          nextCalled = true
          return {}
        }
      )
      const tx = makeCreateTx(COVERED_CLASS, FORBIDDEN_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.User))
      await mw.tx(ctx, [tx])
      expect(nextCalled).toBe(true)
    })

    it('Owner role: passes through without restriction', async () => {
      let nextCalled = false
      const mw = makeMiddleware(
        async () => [],
        async () => {
          nextCalled = true
          return {}
        }
      )
      const tx = makeCreateTx(COVERED_CLASS, FORBIDDEN_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.Owner))
      await mw.tx(ctx, [tx])
      expect(nextCalled).toBe(true)
    })
  })

  // ─── Restricted roles require an explicit access declaration ────────────────
  describe('DocGuest and ReadOnlyGuest', () => {
    it('DocGuest: throws Forbidden when the class has no access declaration', async () => {
      const mw = makeMiddleware(async () => [])
      const tx = makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.DocGuest))
      await expect(mw.tx(ctx, [tx])).rejects.toThrow()
    })

    it('ReadOnlyGuest: throws Forbidden when the class has no access declaration', async () => {
      const mw = makeMiddleware(async () => [])
      const tx = makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.ReadOnlyGuest))
      await expect(mw.tx(ctx, [tx])).rejects.toThrow()
    })
  })

  // ─── New permission model (covered class) ───────────────────────────────────
  describe('covered class – new permission model', () => {
    const settingsDoc = makeGuestSettingsDoc([COVERED_CLASS_PERMISSION])

    const findAllWithSettings: FindAllFn = async (_ctx, _class) => {
      if (_class === MODULE_PERMISSION_GROUP_CLASS) return [settingsDoc]
      if (_class === core.class.ClassPermission) {
        return [{ _id: COVERED_CLASS_PERMISSION, targetClass: COVERED_CLASS } as any]
      }
      return []
    }

    function patchHierarchy (mw: GuestPermissionsMiddleware): void {
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => {
        if (b === core.class.Space) return false
        return a === b
      }
      ;(mw as any).context.hierarchy.classHierarchyMixin = () => undefined
    }

    it('allows create for covered class in any space (TxAccessLevel is irrelevant)', async () => {
      let nextCalled = false
      const mw = makeMiddleware(findAllWithSettings, async () => {
        nextCalled = true
        return {}
      })
      patchHierarchy(mw)
      const tx = makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))
      await mw.tx(ctx, [tx])
      expect(nextCalled).toBe(true)
    })

    it('also allows create in another space when class is covered', async () => {
      let nextCalled = false
      const mw = makeMiddleware(findAllWithSettings, async () => {
        nextCalled = true
        return {}
      })
      patchHierarchy(mw)
      const tx = makeCreateTx(COVERED_CLASS, FORBIDDEN_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))
      await mw.tx(ctx, [tx])
      expect(nextCalled).toBe(true)
    })

    it('ignores permissions listed in disabledPermissions (falls back to TxAccessLevel)', async () => {
      const docWithDisabled = makeGuestSettingsDoc([COVERED_CLASS_PERMISSION], [COVERED_CLASS_PERMISSION])
      const findAll: FindAllFn = async (_ctx, _class) => {
        if (_class === MODULE_PERMISSION_GROUP_CLASS) return [docWithDisabled]
        if (_class === core.class.ClassPermission) {
          return [{ _id: COVERED_CLASS_PERMISSION, targetClass: COVERED_CLASS } as any]
        }
        return []
      }
      const mw = makeMiddleware(findAll)
      patchHierarchy(mw)
      const tx = makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))
      await expect(mw.tx(ctx, [tx])).rejects.toThrow()
    })
  })

  // ─── Uncovered class falls back to TxAccessLevel ────────────────────────────
  describe('uncovered class – TxAccessLevel fallback', () => {
    it('forbids create when class has no TxAccessLevel mixin and no GuestPermissionsSettings', async () => {
      const mw = makeMiddleware(async () => [])
      const tx = makeCreateTx(UNCOVERED_CLASS, ALLOWED_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))
      await expect(mw.tx(ctx, [tx])).rejects.toThrow()
    })

    it('allows create when TxAccessLevel.createAccessLevel === Guest (uncovered type)', async () => {
      // Settings exist but UNCOVERED_CLASS is NOT in allowedPermissions-derived classes
      const settingsDoc = makeGuestSettingsDoc([COVERED_CLASS_PERMISSION])
      let nextCalled = false

      const mw = makeMiddleware(
        async (_ctx, _class) => {
          if (_class === MODULE_PERMISSION_GROUP_CLASS) return [settingsDoc]
          if (_class === core.class.ClassPermission) {
            return [{ _id: COVERED_CLASS_PERMISSION, targetClass: COVERED_CLASS } as any]
          }
          return []
        },
        async () => {
          nextCalled = true
          return {}
        }
      )

      // Simulate TxAccessLevel mixin via hierarchy mock on the middleware context
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, _mixin: any) => {
        if (_class === UNCOVERED_CLASS) {
          return { createAccessLevel: AccountRole.Guest }
        }
        return undefined
      }
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => {
        if (b === core.class.Space) return false
        return a === b
      }

      const tx = makeCreateTx(UNCOVERED_CLASS, ALLOWED_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))
      await mw.tx(ctx, [tx])
      expect(nextCalled).toBe(true)
    })
  })

  describe('ChatMessage ownership', () => {
    const OWN_MESSAGE = 'test:message:own' as Ref<TestChatMessage>
    const FOREIGN_MESSAGE = 'test:message:foreign' as Ref<TestChatMessage>
    const GUEST_SOCIAL_ID = 'test' as PersonId
    const OTHER_SOCIAL_ID = 'test:other' as PersonId

    function makeChatMiddleware (nextCalled: () => void): GuestPermissionsMiddleware {
      const messages: TestChatMessage[] = [
        {
          _id: OWN_MESSAGE,
          _class: CHAT_MESSAGE as Ref<Class<TestChatMessage>>,
          space: ALLOWED_SPACE,
          modifiedOn: Date.now(),
          modifiedBy: GUEST_SOCIAL_ID,
          createdBy: GUEST_SOCIAL_ID,
          message: 'own'
        },
        {
          _id: FOREIGN_MESSAGE,
          _class: CHAT_MESSAGE as Ref<Class<TestChatMessage>>,
          space: ALLOWED_SPACE,
          modifiedOn: Date.now(),
          modifiedBy: OTHER_SOCIAL_ID,
          createdBy: OTHER_SOCIAL_ID,
          message: 'foreign'
        }
      ]
      const mw = makeMiddleware(
        async (_ctx, _class, query: any) => {
          if (_class !== CHAT_MESSAGE) return []
          return messages.filter(
            (message) =>
              (query._id === undefined || query._id === message._id) &&
              (query.createdBy === undefined || query.createdBy === message.createdBy)
          )
        },
        async () => {
          nextCalled()
          return {}
        }
      )
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => a === b
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, mixin: any) => {
        if (_class !== CHAT_MESSAGE) return undefined
        if (mixin === core.mixin.TxAccessLevel) {
          return {
            createAccessLevel: AccountRole.Guest,
            updateAccessLevel: AccountRole.Guest,
            removeAccessLevel: AccountRole.Guest
          }
        }
        if (mixin === core.mixin.RowVisibility) {
          return {
            policy: { kind: 'publicReadable', reason: 'Message visibility follows channel access' },
            writePolicy: { kind: 'ownerField', field: 'createdBy', identity: 'socialId' },
            allowKnownIdBypass: false
          }
        }
        return undefined
      }
      return mw
    }

    it('allows Guest to create a message authored by its social identity', async () => {
      let nextCalled = false
      const mw = makeChatMiddleware(() => {
        nextCalled = true
      })
      const factory = new TxFactory(GUEST_SOCIAL_ID)
      const create = factory.createTxCreateDoc(CHAT_MESSAGE, ALLOWED_SPACE, { message: 'new' } as any)

      await mw.tx(makeCtx(makeAccount(AccountRole.Guest)), [create])
      expect(nextCalled).toBe(true)
    })

    it('forbids Guest to create a message attributed to another social identity', async () => {
      const mw = makeChatMiddleware(() => {})
      const factory = new TxFactory(OTHER_SOCIAL_ID)
      const create = factory.createTxCreateDoc(CHAT_MESSAGE, ALLOWED_SPACE, { message: 'spoofed' } as any)

      await expect(mw.tx(makeCtx(makeAccount(AccountRole.Guest)), [create])).rejects.toThrow()
    })

    it('allows Guest to update and remove its own message', async () => {
      let nextCalls = 0
      const mw = makeChatMiddleware(() => {
        nextCalls++
      })
      const factory = new TxFactory(GUEST_SOCIAL_ID)
      const update = factory.createTxUpdateDoc(
        CHAT_MESSAGE as Ref<Class<TestChatMessage>>,
        ALLOWED_SPACE,
        OWN_MESSAGE,
        { message: 'updated' }
      )
      const remove = factory.createTxRemoveDoc(CHAT_MESSAGE as Ref<Class<TestChatMessage>>, ALLOWED_SPACE, OWN_MESSAGE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))

      await mw.tx(ctx, [update])
      await mw.tx(ctx, [remove])
      expect(nextCalls).toBe(2)
    })

    it('forbids Guest to update or remove another author message', async () => {
      const mw = makeChatMiddleware(() => {})
      const factory = new TxFactory(GUEST_SOCIAL_ID)
      const update = factory.createTxUpdateDoc(
        CHAT_MESSAGE as Ref<Class<TestChatMessage>>,
        ALLOWED_SPACE,
        FOREIGN_MESSAGE,
        { message: 'updated' }
      )
      const remove = factory.createTxRemoveDoc(
        CHAT_MESSAGE as Ref<Class<TestChatMessage>>,
        ALLOWED_SPACE,
        FOREIGN_MESSAGE
      )
      const ctx = makeCtx(makeAccount(AccountRole.Guest))

      await expect(mw.tx(ctx, [update])).rejects.toThrow()
      await expect(mw.tx(ctx, [remove])).rejects.toThrow()
    })
  })

  describe('Attachment ownership', () => {
    const OWN_ATTACHMENT = 'test:attachment:own' as Ref<Doc>
    const FOREIGN_ATTACHMENT = 'test:attachment:foreign' as Ref<Doc>
    const GUEST_SOCIAL_ID = 'test' as PersonId
    const OTHER_SOCIAL_ID = 'test:other' as PersonId

    function makeAttachmentMiddleware (nextCalled: () => void): GuestPermissionsMiddleware {
      const attachments: Doc[] = [
        {
          _id: OWN_ATTACHMENT,
          _class: ATTACHMENT,
          space: ALLOWED_SPACE,
          modifiedOn: Date.now(),
          modifiedBy: GUEST_SOCIAL_ID,
          createdBy: GUEST_SOCIAL_ID
        },
        {
          _id: FOREIGN_ATTACHMENT,
          _class: ATTACHMENT,
          space: ALLOWED_SPACE,
          modifiedOn: Date.now(),
          modifiedBy: OTHER_SOCIAL_ID,
          createdBy: OTHER_SOCIAL_ID
        }
      ]
      const mw = makeMiddleware(
        async (_ctx, _class, query: any) => {
          if (_class !== ATTACHMENT) return []
          return attachments.filter(
            (attachment) =>
              (query._id === undefined || query._id === attachment._id) &&
              (query.createdBy === undefined || query.createdBy === attachment.createdBy)
          )
        },
        async () => {
          nextCalled()
          return {}
        }
      )
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => a === b
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, mixin: any) => {
        if (_class !== ATTACHMENT) return undefined
        if (mixin === core.mixin.TxAccessLevel) {
          return {
            createAccessLevel: AccountRole.Guest,
            updateAccessLevel: AccountRole.Guest,
            removeAccessLevel: AccountRole.Guest
          }
        }
        if (mixin === core.mixin.RowVisibility) {
          return {
            policy: { kind: 'publicReadable', reason: 'Attachment visibility follows parent access' },
            writePolicy: { kind: 'ownerField', field: 'createdBy', identity: 'socialId' },
            allowKnownIdBypass: false
          }
        }
        return undefined
      }
      return mw
    }

    it('allows Guest to remove its own attachment', async () => {
      let nextCalled = false
      const mw = makeAttachmentMiddleware(() => {
        nextCalled = true
      })
      const factory = new TxFactory(GUEST_SOCIAL_ID)
      const remove = factory.createTxRemoveDoc(ATTACHMENT, ALLOWED_SPACE, OWN_ATTACHMENT)

      await mw.tx(makeCtx(makeAccount(AccountRole.Guest)), [remove])
      expect(nextCalled).toBe(true)
    })

    it('forbids Guest to remove another author attachment', async () => {
      const mw = makeAttachmentMiddleware(() => {})
      const factory = new TxFactory(GUEST_SOCIAL_ID)
      const remove = factory.createTxRemoveDoc(ATTACHMENT, ALLOWED_SPACE, FOREIGN_ATTACHMENT)

      await expect(mw.tx(makeCtx(makeAccount(AccountRole.Guest)), [remove])).rejects.toThrow()
    })
  })

  describe('SavedMessage ownership', () => {
    const OWN_SAVED_MESSAGE = 'test:saved-message:own' as Ref<Doc>
    const FOREIGN_SAVED_MESSAGE = 'test:saved-message:foreign' as Ref<Doc>
    const GUEST_SOCIAL_ID = 'test' as PersonId
    const OTHER_SOCIAL_ID = 'test:other' as PersonId

    function makeSavedMessageMiddleware (nextCalled: () => void): GuestPermissionsMiddleware {
      const savedMessages: Doc[] = [
        {
          _id: OWN_SAVED_MESSAGE,
          _class: SAVED_MESSAGE,
          space: core.space.Workspace,
          modifiedOn: Date.now(),
          modifiedBy: GUEST_SOCIAL_ID,
          createdBy: GUEST_SOCIAL_ID
        },
        {
          _id: FOREIGN_SAVED_MESSAGE,
          _class: SAVED_MESSAGE,
          space: core.space.Workspace,
          modifiedOn: Date.now(),
          modifiedBy: OTHER_SOCIAL_ID,
          createdBy: OTHER_SOCIAL_ID
        }
      ]
      const mw = makeMiddleware(
        async (_ctx, _class, query: any) => {
          if (_class !== SAVED_MESSAGE) return []
          return savedMessages.filter(
            (savedMessage) =>
              (query._id === undefined || query._id === savedMessage._id) &&
              (query.createdBy === undefined || query.createdBy === savedMessage.createdBy)
          )
        },
        async () => {
          nextCalled()
          return {}
        }
      )
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => a === b
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, mixin: any) => {
        if (_class !== SAVED_MESSAGE) return undefined
        if (mixin === core.mixin.TxAccessLevel) {
          return {
            createAccessLevel: AccountRole.Guest,
            updateAccessLevel: AccountRole.Guest,
            removeAccessLevel: AccountRole.Guest
          }
        }
        if (mixin === core.mixin.RowVisibility) {
          return {
            policy: { kind: 'ownerField', field: 'createdBy', identity: 'socialId' },
            allowKnownIdBypass: false
          }
        }
        return undefined
      }
      return mw
    }

    it('allows Guest to create and remove its own saved message', async () => {
      let nextCalls = 0
      const mw = makeSavedMessageMiddleware(() => {
        nextCalls++
      })
      const factory = new TxFactory(GUEST_SOCIAL_ID)
      const create = factory.createTxCreateDoc(SAVED_MESSAGE, core.space.Workspace, {
        attachedTo: 'test:message'
      } as any)
      const remove = factory.createTxRemoveDoc(SAVED_MESSAGE, core.space.Workspace, OWN_SAVED_MESSAGE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))

      await mw.tx(ctx, [create])
      await mw.tx(ctx, [remove])
      expect(nextCalls).toBe(2)
    })

    it('forbids Guest to create or remove another account saved message', async () => {
      const mw = makeSavedMessageMiddleware(() => {})
      const foreignFactory = new TxFactory(OTHER_SOCIAL_ID)
      const create = foreignFactory.createTxCreateDoc(SAVED_MESSAGE, core.space.Workspace, {
        attachedTo: 'test:message'
      } as any)
      const ownFactory = new TxFactory(GUEST_SOCIAL_ID)
      const remove = ownFactory.createTxRemoveDoc(SAVED_MESSAGE, core.space.Workspace, FOREIGN_SAVED_MESSAGE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))

      await expect(mw.tx(ctx, [create])).rejects.toThrow()
      await expect(mw.tx(ctx, [remove])).rejects.toThrow()
    })
  })

  describe('SocialIdentity ownership on create', () => {
    const GUEST_SOCIAL = 'test:guest-social' as PersonId
    const OTHER_SOCIAL = 'test:other-social' as PersonId
    const OWN_PERSON = 'test:person:guest' as Ref<Doc>
    const OTHER_PERSON = 'test:person:other' as Ref<Doc>

    function makeSocialIdentityCreateTx (socialId: PersonId, attachedTo: Ref<Doc>): Tx {
      const factory = new TxFactory(GUEST_SOCIAL)
      const create = factory.createTxCreateDoc(
        contact.class.SocialIdentity,
        contact.space.Contacts,
        {
          key: `EMAIL:${socialId}`,
          type: 'EMAIL',
          value: `${socialId}@example.com`,
          isDeleted: false
        } as any,
        socialId as any
      )
      return factory.createTxCollectionCUD(
        contact.class.Person,
        attachedTo as any,
        contact.space.Contacts,
        'socialIds',
        create
      )
    }

    function makeSocialIdentityMiddleware (nextCalled: () => void): GuestPermissionsMiddleware {
      const mw = makeMiddleware(
        async (_ctx, _class, query: any) => {
          if (_class === contact.class.Person && query?.personUuid !== undefined) {
            return [
              {
                _id: OWN_PERSON,
                _class: contact.class.Person,
                space: contact.space.Contacts,
                personUuid: query.personUuid
              } as any
            ]
          }
          if (_class === contact.class.SocialIdentity) {
            if (query?._id !== undefined && query._id !== GUEST_SOCIAL) return []
            if (query?.attachedTo !== undefined && query.attachedTo !== OWN_PERSON) return []
            return [
              {
                _id: GUEST_SOCIAL,
                _class: contact.class.SocialIdentity,
                space: contact.space.Contacts,
                attachedTo: OWN_PERSON
              } as any
            ]
          }
          return []
        },
        async () => {
          nextCalled()
          return {}
        }
      )
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => a === b
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, mixin: any) => {
        if (_class !== contact.class.SocialIdentity) return undefined
        if (mixin === core.mixin.TxAccessLevel) {
          return { createAccessLevel: AccountRole.Guest, isIdentity: true }
        }
        if (mixin === core.mixin.RowVisibility) {
          return {
            policy: { kind: 'ownerField', field: 'attachedTo', identity: 'personId' },
            allowKnownIdBypass: false
          }
        }
        return undefined
      }
      return mw
    }

    function makeGuestAccount (): Account {
      return {
        uuid: 'test:guest-account' as any,
        role: AccountRole.Guest,
        primarySocialId: GUEST_SOCIAL,
        socialIds: [GUEST_SOCIAL],
        fullSocialIds: []
      }
    }

    it('allows creating the current account social identity for its own Person', async () => {
      let nextCalled = false
      const mw = makeSocialIdentityMiddleware(() => {
        nextCalled = true
      })
      await mw.tx(makeCtx(makeGuestAccount()), [makeSocialIdentityCreateTx(GUEST_SOCIAL, OWN_PERSON)])
      expect(nextCalled).toBe(true)
    })

    it('forbids creating a social identity not present in the current account', async () => {
      const mw = makeSocialIdentityMiddleware(() => {})
      await expect(
        mw.tx(makeCtx(makeGuestAccount()), [makeSocialIdentityCreateTx(OTHER_SOCIAL, OWN_PERSON)])
      ).rejects.toThrow()
    })

    it('forbids attaching the current account social identity to another Person', async () => {
      const mw = makeSocialIdentityMiddleware(() => {})
      await expect(
        mw.tx(makeCtx(makeGuestAccount()), [makeSocialIdentityCreateTx(GUEST_SOCIAL, OTHER_PERSON)])
      ).rejects.toThrow()
    })

    it('forbids transferring an existing social identity to another Person', async () => {
      const mw = makeSocialIdentityMiddleware(() => {})
      const factory = new TxFactory(GUEST_SOCIAL)
      const update = factory.createTxUpdateDoc(
        contact.class.SocialIdentity,
        contact.space.Contacts,
        GUEST_SOCIAL as any,
        { attachedTo: OTHER_PERSON } as any
      )

      await expect(mw.tx(makeCtx(makeGuestAccount()), [update])).rejects.toThrow()
    })
  })

  describe('DocumentPresence for restricted roles', () => {
    const SOCIAL_ID = 'test:presence-social' as PersonId
    const PERSON = 'test:person:presence' as Ref<Doc>
    const OTHER_PERSON = 'test:person:other-presence' as Ref<Doc>
    const PRESENCE_ID = `presence:test:document:${PERSON}` as Ref<Doc>

    function makePresenceAccount (role: AccountRole): Account {
      return {
        uuid: 'test:presence-account' as any,
        role,
        primarySocialId: SOCIAL_ID,
        socialIds: [SOCIAL_ID],
        fullSocialIds: []
      }
    }

    function makePresenceMiddleware (nextCalled: () => void): GuestPermissionsMiddleware {
      const presence = {
        _id: PRESENCE_ID,
        _class: DOCUMENT_PRESENCE,
        space: core.space.Space,
        objectId: 'test:document',
        objectClass: 'test:class:Document',
        person: PERSON,
        lastActive: Date.now()
      } as any
      const mw = makeMiddleware(
        async (_ctx, _class, query: any) => {
          if (_class === contact.class.Person && query?.personUuid !== undefined) {
            return [
              {
                _id: PERSON,
                _class: contact.class.Person,
                space: contact.space.Contacts,
                personUuid: query.personUuid
              } as any
            ]
          }
          if (_class === DOCUMENT_PRESENCE) {
            if (query?._id !== undefined && query._id !== PRESENCE_ID) return []
            if (query?.person !== undefined && query.person !== PERSON) return []
            return [presence]
          }
          return []
        },
        async () => {
          nextCalled()
          return {}
        }
      )
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => a === b
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, mixin: any) => {
        if (_class !== DOCUMENT_PRESENCE) return undefined
        if (mixin === core.mixin.TxAccessLevel) {
          return {
            createAccessLevel: AccountRole.ReadOnlyGuest,
            updateAccessLevel: AccountRole.ReadOnlyGuest,
            removeAccessLevel: AccountRole.ReadOnlyGuest
          }
        }
        if (mixin === core.mixin.RowVisibility) {
          return {
            policy: { kind: 'publicReadable', reason: 'Ephemeral test data' },
            allowKnownIdBypass: false
          }
        }
        return undefined
      }
      return mw
    }

    function makePresenceCreateTx (person: Ref<Doc>): Tx {
      const factory = new TxFactory(SOCIAL_ID)
      return factory.createTxCreateDoc(
        DOCUMENT_PRESENCE,
        core.space.Space,
        {
          objectId: 'test:document',
          objectClass: 'test:class:Document',
          person,
          lastActive: Date.now()
        } as any,
        PRESENCE_ID as any
      )
    }

    it.each([AccountRole.Guest, AccountRole.DocGuest, AccountRole.ReadOnlyGuest])(
      'allows %s to create DocumentPresence',
      async (role) => {
        let nextCalled = false
        const mw = makePresenceMiddleware(() => {
          nextCalled = true
        })
        await mw.tx(makeCtx(makePresenceAccount(role)), [makePresenceCreateTx(PERSON)])
        expect(nextCalled).toBe(true)
      }
    )

    it('allows ReadOnlyGuest to update and remove DocumentPresence', async () => {
      let nextCalls = 0
      const mw = makePresenceMiddleware(() => {
        nextCalls++
      })
      const factory = new TxFactory(SOCIAL_ID)
      const update = factory.createTxUpdateDoc<TestDocumentPresence>(
        DOCUMENT_PRESENCE as Ref<Class<TestDocumentPresence>>,
        core.space.Space,
        PRESENCE_ID as Ref<TestDocumentPresence>,
        { lastActive: Date.now() }
      )
      const remove = factory.createTxRemoveDoc<TestDocumentPresence>(
        DOCUMENT_PRESENCE as Ref<Class<TestDocumentPresence>>,
        core.space.Space,
        PRESENCE_ID as Ref<TestDocumentPresence>
      )
      const ctx = makeCtx(makePresenceAccount(AccountRole.ReadOnlyGuest))

      await mw.tx(ctx, [update])
      await mw.tx(ctx, [remove])
      expect(nextCalls).toBe(2)
    })

    it('allows ReadOnlyGuest to create DocumentPresence for another Person', async () => {
      let nextCalled = false
      const mw = makePresenceMiddleware(() => {
        nextCalled = true
      })
      await mw.tx(makeCtx(makePresenceAccount(AccountRole.ReadOnlyGuest)), [makePresenceCreateTx(OTHER_PERSON)])
      expect(nextCalled).toBe(true)
    })

    it('allows ReadOnlyGuest to update the person in an existing DocumentPresence', async () => {
      let nextCalled = false
      const mw = makePresenceMiddleware(() => {
        nextCalled = true
      })
      const factory = new TxFactory(SOCIAL_ID)
      const update = factory.createTxUpdateDoc<TestDocumentPresence>(
        DOCUMENT_PRESENCE as Ref<Class<TestDocumentPresence>>,
        core.space.Space,
        PRESENCE_ID as Ref<TestDocumentPresence>,
        { person: OTHER_PERSON }
      )

      await mw.tx(makeCtx(makePresenceAccount(AccountRole.ReadOnlyGuest)), [update])
      expect(nextCalled).toBe(true)
    })
  })

  describe('TypingIndicator for restricted roles', () => {
    const SOCIAL_ID = 'test:typing-social' as PersonId
    const OTHER_SOCIAL_ID = 'test:typing-other-social' as PersonId
    const TYPING_ID = `typing:test:document:${SOCIAL_ID}` as Ref<Doc>

    function makeTypingAccount (role: AccountRole): Account {
      return {
        uuid: 'test:typing-account' as any,
        role,
        primarySocialId: SOCIAL_ID,
        socialIds: [SOCIAL_ID],
        fullSocialIds: []
      }
    }

    function makeTypingMiddleware (nextCalled: () => void): GuestPermissionsMiddleware {
      const indicator = {
        _id: TYPING_ID,
        _class: TYPING_INDICATOR,
        space: core.space.Space,
        objectId: 'test:document',
        socialId: SOCIAL_ID
      } as any
      const mw = makeMiddleware(
        async (_ctx, _class, query: any) => {
          if (_class !== TYPING_INDICATOR) return []
          if (query?._id !== undefined && query._id !== TYPING_ID) return []
          if (query?.socialId !== undefined && query.socialId !== SOCIAL_ID) return []
          return [indicator]
        },
        async () => {
          nextCalled()
          return {}
        }
      )
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => a === b
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, mixin: any) => {
        if (_class !== TYPING_INDICATOR) return undefined
        if (mixin === core.mixin.TxAccessLevel) {
          return {
            createAccessLevel: AccountRole.ReadOnlyGuest,
            updateAccessLevel: AccountRole.ReadOnlyGuest,
            removeAccessLevel: AccountRole.ReadOnlyGuest
          }
        }
        if (mixin === core.mixin.RowVisibility) {
          return {
            policy: { kind: 'publicReadable', reason: 'Ephemeral test data' },
            allowKnownIdBypass: false
          }
        }
        return undefined
      }
      return mw
    }

    function makeTypingCreateTx (socialId: PersonId): Tx {
      const factory = new TxFactory(SOCIAL_ID)
      return factory.createTxCreateDoc(
        TYPING_INDICATOR,
        core.space.Space,
        { objectId: 'test:document', socialId } as any,
        TYPING_ID as any
      )
    }

    it.each([AccountRole.Guest, AccountRole.DocGuest, AccountRole.ReadOnlyGuest])(
      'allows %s to create TypingIndicator',
      async (role) => {
        let nextCalled = false
        const mw = makeTypingMiddleware(() => {
          nextCalled = true
        })

        await mw.tx(makeCtx(makeTypingAccount(role)), [makeTypingCreateTx(SOCIAL_ID)])
        expect(nextCalled).toBe(true)
      }
    )

    it('allows ReadOnlyGuest to update and remove TypingIndicator', async () => {
      let nextCalls = 0
      const mw = makeTypingMiddleware(() => {
        nextCalls++
      })
      const factory = new TxFactory(SOCIAL_ID)
      const update = factory.createTxUpdateDoc<TestTypingIndicator>(
        TYPING_INDICATOR as Ref<Class<TestTypingIndicator>>,
        core.space.Space,
        TYPING_ID as Ref<TestTypingIndicator>,
        { status: 'test:status' }
      )
      const remove = factory.createTxRemoveDoc<TestTypingIndicator>(
        TYPING_INDICATOR as Ref<Class<TestTypingIndicator>>,
        core.space.Space,
        TYPING_ID as Ref<TestTypingIndicator>
      )
      const ctx = makeCtx(makeTypingAccount(AccountRole.ReadOnlyGuest))

      await mw.tx(ctx, [update])
      await mw.tx(ctx, [remove])
      expect(nextCalls).toBe(2)
    })

    it.each([AccountRole.Guest, AccountRole.DocGuest, AccountRole.ReadOnlyGuest])(
      'allows %s to remove an already expired TypingIndicator',
      async (role) => {
        let nextCalled = false
        const mw = makeTypingMiddleware(() => {
          nextCalled = true
        })
        const factory = new TxFactory(SOCIAL_ID)
        const expiredId = `typing:test:expired:${OTHER_SOCIAL_ID}` as Ref<TestTypingIndicator>
        const remove = factory.createTxRemoveDoc<TestTypingIndicator>(
          TYPING_INDICATOR as Ref<Class<TestTypingIndicator>>,
          core.space.Space,
          expiredId
        )

        await mw.tx(makeCtx(makeTypingAccount(role)), [remove])
        expect(nextCalled).toBe(true)
      }
    )

    it('allows ReadOnlyGuest to create a TypingIndicator for another social identity', async () => {
      let nextCalled = false
      const mw = makeTypingMiddleware(() => {
        nextCalled = true
      })
      await mw.tx(makeCtx(makeTypingAccount(AccountRole.ReadOnlyGuest)), [makeTypingCreateTx(OTHER_SOCIAL_ID)])
      expect(nextCalled).toBe(true)
    })

    it('allows ReadOnlyGuest to update the social identity in an existing TypingIndicator', async () => {
      let nextCalled = false
      const mw = makeTypingMiddleware(() => {
        nextCalled = true
      })
      const factory = new TxFactory(SOCIAL_ID)
      const update = factory.createTxUpdateDoc<TestTypingIndicator>(
        TYPING_INDICATOR as Ref<Class<TestTypingIndicator>>,
        core.space.Space,
        TYPING_ID as Ref<TestTypingIndicator>,
        { socialId: OTHER_SOCIAL_ID }
      )

      await mw.tx(makeCtx(makeTypingAccount(AccountRole.ReadOnlyGuest)), [update])
      expect(nextCalled).toBe(true)
    })
  })

  // ─── Precedence: covered class ignores TxAccessLevel even if it would deny ──
  describe('precedence – new model overrides TxAccessLevel for covered types', () => {
    it('allows covered class create in allowed space regardless of missing TxAccessLevel', async () => {
      const settingsDoc = makeGuestSettingsDoc([COVERED_CLASS_PERMISSION])
      let nextCalled = false

      const mw = makeMiddleware(
        async (_ctx, _class) => {
          if (_class === MODULE_PERMISSION_GROUP_CLASS) return [settingsDoc]
          if (_class === core.class.ClassPermission) {
            return [{ _id: COVERED_CLASS_PERMISSION, targetClass: COVERED_CLASS } as any]
          }
          return []
        },
        async () => {
          nextCalled = true
          return {}
        }
      )

      // Ensure hierarchy says TxAccessLevel is absent for the covered class
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, _mixin: any) => undefined
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => {
        if (b === core.class.Space) return false
        return a === b
      }

      const tx = makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))
      await mw.tx(ctx, [tx])
      expect(nextCalled).toBe(true)
    })

    it('allows covered class create in any space even if TxAccessLevel would deny', async () => {
      const settingsDoc = makeGuestSettingsDoc([COVERED_CLASS_PERMISSION])

      const mw = makeMiddleware(async (_ctx, _class) => {
        if (_class === MODULE_PERMISSION_GROUP_CLASS) return [settingsDoc]
        if (_class === core.class.ClassPermission) {
          return [{ _id: COVERED_CLASS_PERMISSION, targetClass: COVERED_CLASS } as any]
        }
        return []
      })

      // TxAccessLevel would allow (createAccessLevel === Guest) – should be ignored
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, _mixin: any) => {
        if (_class === COVERED_CLASS) return { createAccessLevel: AccountRole.Guest }
        return undefined
      }
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => {
        if (b === core.class.Space) return false
        return a === b
      }

      const tx = makeCreateTx(COVERED_CLASS, FORBIDDEN_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))
      await mw.tx(ctx, [tx])
    })
  })

  // ─── Layer 1 cannot be bypassed by document creator ──────────────────────────
  describe('guest update/remove documents', () => {
    const GUEST_SOCIAL = 'test:guest-social' as PersonId

    function makeGuestAccountWithSocial (): Account {
      return {
        uuid: generateId() as any,
        role: AccountRole.Guest,
        primarySocialId: GUEST_SOCIAL,
        socialIds: [GUEST_SOCIAL],
        fullSocialIds: []
      }
    }

    function patchHierarchyNoTxAccessLevel (mw: GuestPermissionsMiddleware): void {
      ;(mw as any).context.hierarchy.classHierarchyMixin = () => undefined
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => {
        if (b === core.class.Space) return false
        return a === b
      }
    }

    it('forbids guest to update its own document when the class does not allow updates', async () => {
      const objectId = generateId()
      const findAll: FindAllFn = async (_ctx, _class, query: any) => {
        if (_class === UNCOVERED_CLASS && query?._id === objectId) {
          return [
            {
              _id: objectId,
              _class: UNCOVERED_CLASS,
              space: ALLOWED_SPACE,
              modifiedOn: Date.now(),
              modifiedBy: GUEST_SOCIAL,
              createdBy: GUEST_SOCIAL
            } as any
          ]
        }
        return []
      }
      let nextCalled = false
      const mw = makeMiddleware(findAll, async () => {
        nextCalled = true
        return {}
      })
      patchHierarchyNoTxAccessLevel(mw)
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxUpdateDoc(UNCOVERED_CLASS, ALLOWED_SPACE, objectId, { name: 'x' } as any)
      await expect(mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])).rejects.toThrow()
      expect(nextCalled).toBe(false)
    })

    it('forbids guest to remove its own document when the class does not allow removal', async () => {
      const objectId = generateId()
      const findAll: FindAllFn = async (_ctx, _class, query: any) => {
        if (_class === UNCOVERED_CLASS && query?._id === objectId) {
          return [
            {
              _id: objectId,
              _class: UNCOVERED_CLASS,
              space: ALLOWED_SPACE,
              modifiedOn: Date.now(),
              modifiedBy: GUEST_SOCIAL,
              createdBy: GUEST_SOCIAL
            } as any
          ]
        }
        return []
      }
      let nextCalled = false
      const mw = makeMiddleware(findAll, async () => {
        nextCalled = true
        return {}
      })
      patchHierarchyNoTxAccessLevel(mw)
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxRemoveDoc(UNCOVERED_CLASS, ALLOWED_SPACE, objectId)
      await expect(mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])).rejects.toThrow()
      expect(nextCalled).toBe(false)
    })

    it('forbids guest to update document created by another account', async () => {
      const objectId = generateId()
      const otherSocial = 'test:other-social' as PersonId
      const findAll: FindAllFn = async (_ctx, _class, query: any) => {
        if (_class === UNCOVERED_CLASS && query?._id === objectId) {
          return [
            {
              _id: objectId,
              _class: UNCOVERED_CLASS,
              space: ALLOWED_SPACE,
              modifiedOn: Date.now(),
              modifiedBy: otherSocial,
              createdBy: otherSocial
            } as any
          ]
        }
        return []
      }
      const mw = makeMiddleware(findAll)
      patchHierarchyNoTxAccessLevel(mw)
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxUpdateDoc(UNCOVERED_CLASS, ALLOWED_SPACE, objectId, { name: 'x' } as any)
      await expect(mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])).rejects.toThrow()
    })
  })

  // ─── card.class.Card ownership on update (regression test for the File-card guest-upload fix) ──
  describe('card.class.Card ownership on update', () => {
    const CARD_CLASS = 'card:class:Card' as Ref<Class<Doc>>
    const GUEST_SOCIAL = 'test:guest-social' as PersonId
    const OTHER_SOCIAL = 'test:other-social' as PersonId
    const OWN_CARD = 'test:card:own' as Ref<Doc>
    const OTHER_CARD = 'test:card:other' as Ref<Doc>
    const CARD_SPACE = 'test:space:cards' as Ref<Space>

    function makeCardMiddleware (nextCalled: () => void): GuestPermissionsMiddleware {
      const mw = makeMiddleware(
        async (_ctx, _class, query: any) => {
          if (_class === CARD_CLASS) {
            const cards = [
              { _id: OWN_CARD, _class: CARD_CLASS, space: CARD_SPACE, createdBy: GUEST_SOCIAL },
              { _id: OTHER_CARD, _class: CARD_CLASS, space: CARD_SPACE, createdBy: OTHER_SOCIAL }
            ]
            return cards.filter((c) => (query?._id === undefined || query._id === c._id) &&
              (query?.createdBy === undefined || query.createdBy === c.createdBy)) as any
          }
          return []
        },
        async () => {
          nextCalled()
          return {}
        }
      )
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => a === b
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, mixin: any) => {
        if (_class !== CARD_CLASS) return undefined
        if (mixin === core.mixin.TxAccessLevel) {
          return { updateAccessLevel: AccountRole.Guest }
        }
        if (mixin === core.mixin.RowVisibility) {
          return {
            policy: { kind: 'publicReadable' },
            writePolicy: { kind: 'ownerField', field: 'createdBy', identity: 'socialId' },
            allowKnownIdBypass: false
          }
        }
        return undefined
      }
      return mw
    }

    function makeGuestAccount (): Account {
      return {
        uuid: 'test:guest-account' as any,
        role: AccountRole.Guest,
        primarySocialId: GUEST_SOCIAL,
        socialIds: [GUEST_SOCIAL],
        fullSocialIds: []
      }
    }

    it('allows Guest to update a card it created', async () => {
      let nextCalled = false
      const mw = makeCardMiddleware(() => {
        nextCalled = true
      })
      const factory = new TxFactory(GUEST_SOCIAL)
      const update = factory.createTxUpdateDoc(CARD_CLASS, CARD_SPACE, OWN_CARD, { blobs: {} } as any)
      await mw.tx(makeCtx(makeGuestAccount()), [update])
      expect(nextCalled).toBe(true)
    })

    it('forbids Guest to update a card created by another account', async () => {
      const mw = makeCardMiddleware(() => {})
      const factory = new TxFactory(GUEST_SOCIAL)
      const update = factory.createTxUpdateDoc(CARD_CLASS, CARD_SPACE, OTHER_CARD, { blobs: {} } as any)
      await expect(mw.tx(makeCtx(makeGuestAccount()), [update])).rejects.toThrow()
    })
  })

  // ─── core.class.Collaborator editing on own cards (card.ids.GuestCollaboratorClassPermission) ──
  describe('editing collaborators on a card the guest created', () => {
    const CARD_CLASS = 'card:class:Card' as Ref<Class<Doc>>
    const GUEST_SOCIAL = 'test:guest-social' as PersonId
    const OTHER_SOCIAL = 'test:other-social' as PersonId
    const OWN_CARD = 'test:card:own' as Ref<Doc>
    const OTHER_CARD = 'test:card:other' as Ref<Doc>
    const CARD_SPACE = 'test:space:cards' as Ref<Space>
    const NEW_COLLABORATOR_ACCOUNT = 'test:other-account' as any
    const COLLABORATOR_PERMISSION = 'test:permission:collaborator' as Ref<Doc>

    function makeCollaboratorMiddleware (editOwnDocCollaborators: boolean, nextCalled: () => void): GuestPermissionsMiddleware {
      const mw = makeMiddleware(
        async (_ctx, _class, query: any) => {
          if (_class === core.class.ModulePermissionGroup) {
            return [
              {
                role: AccountRole.Guest,
                permissions: [COLLABORATOR_PERMISSION],
                disabledPermissions: editOwnDocCollaborators ? [] : [COLLABORATOR_PERMISSION],
                enabled: true
              }
            ] as any
          }
          if (_class === core.class.ClassPermission) {
            return [{ _id: COLLABORATOR_PERMISSION, targetClass: core.class.Collaborator }] as any
          }
          if (_class === CARD_CLASS) {
            const cards = [
              { _id: OWN_CARD, _class: CARD_CLASS, space: CARD_SPACE, createdBy: GUEST_SOCIAL },
              { _id: OTHER_CARD, _class: CARD_CLASS, space: CARD_SPACE, createdBy: OTHER_SOCIAL }
            ]
            return cards.filter((c) => query?._id === undefined || query._id === c._id) as any
          }
          return []
        },
        async () => {
          nextCalled()
          return {}
        }
      )
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => a === b
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, mixin: any) => {
        if (_class !== core.class.Collaborator || mixin !== core.mixin.TxAccessLevel) return undefined
        return { createAccessLevel: AccountRole.ReadOnlyGuest, removeAccessLevel: AccountRole.ReadOnlyGuest }
      }
      return mw
    }

    function makeGuestAccount (): Account {
      return {
        uuid: 'test:guest-account' as any,
        role: AccountRole.Guest,
        primarySocialId: GUEST_SOCIAL,
        socialIds: [GUEST_SOCIAL],
        fullSocialIds: []
      }
    }

    function makeAddCollaboratorTx (card: Ref<Doc>): Tx {
      const factory = new TxFactory(GUEST_SOCIAL)
      const create = factory.createTxCreateDoc(core.class.Collaborator, CARD_SPACE, {
        collaborator: NEW_COLLABORATOR_ACCOUNT
      } as any)
      return factory.createTxCollectionCUD(CARD_CLASS, card, CARD_SPACE, 'collaborators', create)
    }

    function makeRemoveCollaboratorTx (card: Ref<Doc>): Tx {
      const factory = new TxFactory(GUEST_SOCIAL)
      const remove = factory.createTxRemoveDoc(core.class.Collaborator, CARD_SPACE, generateId())
      return factory.createTxCollectionCUD(CARD_CLASS, card, CARD_SPACE, 'collaborators', remove)
    }

    it('forbids by default (editOwnDocCollaborators off)', async () => {
      const mw = makeCollaboratorMiddleware(false, () => {})
      await expect(mw.tx(makeCtx(makeGuestAccount()), [makeAddCollaboratorTx(OWN_CARD)])).rejects.toThrow()
    })

    it('allows adding a collaborator to a card the guest created, once opted in', async () => {
      let nextCalled = false
      const mw = makeCollaboratorMiddleware(true, () => {
        nextCalled = true
      })
      await mw.tx(makeCtx(makeGuestAccount()), [makeAddCollaboratorTx(OWN_CARD)])
      expect(nextCalled).toBe(true)
    })

    it('allows removing a collaborator from a card the guest created, once opted in', async () => {
      let nextCalled = false
      const mw = makeCollaboratorMiddleware(true, () => {
        nextCalled = true
      })
      await mw.tx(makeCtx(makeGuestAccount()), [makeRemoveCollaboratorTx(OWN_CARD)])
      expect(nextCalled).toBe(true)
    })

    it('forbids editing collaborators on a card created by another account, even when opted in', async () => {
      const mw = makeCollaboratorMiddleware(true, () => {})
      await expect(mw.tx(makeCtx(makeGuestAccount()), [makeAddCollaboratorTx(OTHER_CARD)])).rejects.toThrow()
    })
  })

  // ─── process.class.ApproveRequest actions (process.ids.GuestApproveRequestClassPermission) ──
  describe('process.class.ApproveRequest approve/reject', () => {
    const APPROVE_REQUEST_CLASS = 'process:class:ApproveRequest' as Ref<Class<Doc>>
    const GUEST_SOCIAL = 'test:guest-social' as PersonId
    const GUEST_PERSON = 'test:guest-person' as Ref<Doc>
    const OTHER_PERSON = 'test:other-person' as Ref<Doc>
    const OWN_REQUEST = 'test:request:own' as Ref<Doc>
    const OTHER_REQUEST = 'test:request:other' as Ref<Doc>
    const REQUEST_SPACE = 'test:space:requests' as Ref<Space>
    const APPROVE_PERMISSION = 'test:permission:approve' as Ref<Doc>

    function makeAccount (): Account {
      return {
        uuid: 'test:guest-account' as any,
        role: AccountRole.Guest,
        primarySocialId: GUEST_SOCIAL,
        socialIds: [GUEST_SOCIAL],
        fullSocialIds: []
      }
    }

    function makeApproveMiddleware (runProcessActions: boolean, nextCalled: () => void): GuestPermissionsMiddleware {
      const mw = makeMiddleware(
        async (_ctx, _class, query: any) => {
          if (_class === core.class.ModulePermissionGroup) {
            return [
              {
                role: AccountRole.Guest,
                permissions: [APPROVE_PERMISSION],
                disabledPermissions: runProcessActions ? [] : [APPROVE_PERMISSION],
                enabled: true
              }
            ] as any
          }
          if (_class === core.class.ClassPermission) {
            return [{ _id: APPROVE_PERMISSION, targetClass: APPROVE_REQUEST_CLASS }] as any
          }
          if (_class === contact.class.Person) {
            return [{ _id: GUEST_PERSON, personUuid: 'test:guest-account' }] as any
          }
          if (_class === APPROVE_REQUEST_CLASS) {
            const requests = [
              { _id: OWN_REQUEST, _class: APPROVE_REQUEST_CLASS, space: REQUEST_SPACE, user: GUEST_PERSON },
              { _id: OTHER_REQUEST, _class: APPROVE_REQUEST_CLASS, space: REQUEST_SPACE, user: OTHER_PERSON }
            ]
            return requests.filter((r) => (query?._id === undefined || query._id === r._id) &&
              (query?.user === undefined || query.user === r.user)) as any
          }
          return []
        },
        async () => {
          nextCalled()
          return {}
        }
      )
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => a === b
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, mixin: any) => {
        if (_class !== APPROVE_REQUEST_CLASS) return undefined
        if (mixin === core.mixin.TxAccessLevel) return { updateAccessLevel: AccountRole.ReadOnlyGuest }
        if (mixin === core.mixin.RowVisibility) {
          return {
            policy: { kind: 'ownerField', field: 'user', identity: 'personId' },
            allowKnownIdBypass: false
          }
        }
        return undefined
      }
      return mw
    }

    function makeApproveTx (request: Ref<Doc>): Tx {
      const factory = new TxFactory(GUEST_SOCIAL)
      return factory.createTxUpdateDoc(APPROVE_REQUEST_CLASS, REQUEST_SPACE, request, {
        doneOn: Date.now(),
        approved: true
      } as any)
    }

    it('forbids by default (runProcessActions off), even for the assigned approver', async () => {
      const mw = makeApproveMiddleware(false, () => {})
      await expect(mw.tx(makeCtx(makeAccount()), [makeApproveTx(OWN_REQUEST)])).rejects.toThrow()
    })

    it('allows the assigned approver once opted in', async () => {
      let nextCalled = false
      const mw = makeApproveMiddleware(true, () => {
        nextCalled = true
      })
      await mw.tx(makeCtx(makeAccount()), [makeApproveTx(OWN_REQUEST)])
      expect(nextCalled).toBe(true)
    })

    it('forbids a request assigned to someone else, even when opted in', async () => {
      const mw = makeApproveMiddleware(true, () => {})
      await expect(mw.tx(makeCtx(makeAccount()), [makeApproveTx(OTHER_REQUEST)])).rejects.toThrow()
    })
  })

  // ─── Cache invalidation ──────────────────────────────────────────────────────
  describe('cache invalidation', () => {
    it('invalidates cache when GuestPermissionsSettings is updated', async () => {
      const findAll: FindAllFn = async (_ctx, _class) => {
        if (_class === MODULE_PERMISSION_GROUP_CLASS) {
          return [makeGuestSettingsDoc([COVERED_CLASS_PERMISSION])]
        }
        if (_class === core.class.ClassPermission) {
          return [{ _id: COVERED_CLASS_PERMISSION, targetClass: COVERED_CLASS } as any]
        }
        return []
      }
      const mw = makeMiddleware(findAll)
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => {
        if (b === core.class.Space) return false
        return a === b
      }
      ;(mw as any).context.hierarchy.classHierarchyMixin = () => undefined

      // First tx as guest should load cache
      const userCtx = makeCtx(makeAccount(AccountRole.User))
      const settingsTx: Tx = {
        _id: generateId(),
        _class: core.class.TxCreateDoc,
        space: core.space.Tx,
        modifiedOn: Date.now(),
        modifiedBy: 'test' as PersonId,
        objectId: generateId(),
        objectClass: MODULE_PERMISSION_GROUP_CLASS,
        objectSpace: 'core:space:Workspace' as Ref<Space>
      } as any

      // Owner updates settings – should invalidate cache
      await mw.tx(userCtx, [settingsTx])
      // Cache should be cleared after settings update
      expect((mw as any).classAccess.cache).toBeUndefined()
    })
  })
})
