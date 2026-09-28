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
 *  - DocGuest / ReadOnlyGuest users are always forbidden.
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
  type ClassPermission,
  type CustomSequence,
  type Doc,
  type MeasureContext,
  type Mixin,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  TxFactory
} from '@hcengineering/core'
import type { PipelineContext, TxMiddlewareResult } from '@hcengineering/server-core'
import { GuestPermissionsMiddleware } from '../guestPermissions'

const COVERED_CLASS = 'test:class:CoveredClass' as Ref<Class<Doc>>
const UNCOVERED_CLASS = 'test:class:UncoveredClass' as Ref<Class<Doc>>
const COVERED_CLASS_PERMISSION = 'test:permission:CoveredClassPermission' as Ref<Doc>
const GUEST_CREATE_PERMISSION = 'test:permission:GuestCreate' as Ref<Doc>
const TEST_APPLICATION = 'test:app:tracker' as Ref<Doc>
const RELATED_CLASS = 'test:class:RelatedClass' as Ref<Class<Doc>>
const ALLOWED_MIXIN = 'test:mixin:Allowed' as Ref<Mixin<Doc>>
const OTHER_SPACE_CLASS = 'test:class:OtherSpace' as Ref<Class<Space>>
const ALLOWED_SEQUENCE_NAMESPACE = 'test.sequence' as const
const MODULE_PERMISSION_GROUP_CLASS = core.class.ModulePermissionGroup
const ALLOWED_SPACE = 'test:space:Allowed' as Ref<Space>
const FORBIDDEN_SPACE = 'test:space:Forbidden' as Ref<Space>

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
    branding: null,
    adapterManager: {} as any,
    storageAdapter: {} as any,
    contextVars: {},
    lastTx: '',
    lastHash: '',
    broadcastEvent: async () => {}
  }
}

function makeMiddleware (
  findAll: FindAllFn,
  nextFn?: (ctx: MeasureContext, txes: Tx[]) => Promise<TxMiddlewareResult>
): GuestPermissionsMiddleware {
  const effectiveFindAll: FindAllFn = async (ctx, _class, query, options) => {
    if (
      _class === core.class.Space &&
      ((query as { _id?: Ref<Space> })._id === ALLOWED_SPACE ||
        (query as { _id?: Ref<Space> })._id === FORBIDDEN_SPACE)
    ) {
      return [
        {
          _id: (query as { _id: Ref<Space> })._id,
          _class: core.class.Space,
          space: core.space.Workspace,
          modifiedOn: Date.now(),
          modifiedBy: 'test' as PersonId
        } as Space
      ]
    }
    return await findAll(ctx, _class, query, options)
  }
  const context = makePipelineContext(effectiveFindAll)
  const next = nextFn !== undefined ? { tx: nextFn } : { tx: async (_ctx: MeasureContext, _txes: Tx[]) => ({}) }
  const mw = new (GuestPermissionsMiddleware as any)(context, next)
  // Override findAll to inject our test data
  mw.findAll = effectiveFindAll
  return mw
}

function makeCreateTx (objectClass: Ref<Class<Doc>>, objectSpace: Ref<Space>): Tx {
  const factory = new TxFactory('test:account:System' as PersonId)
  return factory.createTxCreateDoc(objectClass, objectSpace, {})
}

// Helper: buildGuestSettings - simulate the document that loadPermissionsCache would find
function makeGuestSettingsDoc (allowedPermissions: Ref<Doc>[], disabledPermissions?: Ref<Doc>[]): Doc {
  return {
    _id: generateId(),
    _class: MODULE_PERMISSION_GROUP_CLASS,
    space: 'core:space:Workspace' as Ref<Space>,
    modifiedOn: Date.now(),
    modifiedBy: 'test' as PersonId,
    application: TEST_APPLICATION,
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

  // ─── DocGuest / ReadOnlyGuest are always forbidden ──────────────────────────
  describe('DocGuest and ReadOnlyGuest', () => {
    it('DocGuest: throws Forbidden for any tx', async () => {
      const mw = makeMiddleware(async () => [])
      const tx = makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.DocGuest))
      await expect(mw.tx(ctx, [tx])).rejects.toThrow()
    })

    it('ReadOnlyGuest: throws Forbidden for any tx', async () => {
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

    it('forbids create when the space class does not match the module group', async () => {
      const group = { ...(settingsDoc as any), spaceClass: OTHER_SPACE_CLASS }
      const mw = makeMiddleware(async (_ctx, _class) => {
        if (_class === MODULE_PERMISSION_GROUP_CLASS) return [group]
        if (_class === core.class.ClassPermission) {
          return [{ _id: COVERED_CLASS_PERMISSION, targetClass: COVERED_CLASS } as any]
        }
        return []
      })
      patchHierarchy(mw)

      await expect(
        mw.tx(makeCtx(makeAccount(AccountRole.Guest)), [makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)])
      ).rejects.toThrow()
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

  describe('class permission workflow policies', () => {
    const GUEST_SOCIAL = 'test:guest-social' as PersonId
    const OTHER_SOCIAL = 'test:other-social' as PersonId
    const settingsDoc = makeGuestSettingsDoc([COVERED_CLASS_PERMISSION])
    const sequenceId = generateId<CustomSequence>()
    const ownParentId = generateId()
    const foreignParentId = generateId()
    const policyPermission = {
      _id: COVERED_CLASS_PERMISSION,
      targetClass: COVERED_CLASS,
      application: TEST_APPLICATION,
      relatedCreateClasses: [RELATED_CLASS],
      sequenceNamespaces: [ALLOWED_SEQUENCE_NAMESPACE]
    }

    function makeParent (_id: Ref<Doc>, createdBy: PersonId): Doc {
      return {
        _id,
        _class: COVERED_CLASS,
        space: ALLOWED_SPACE,
        modifiedOn: Date.now(),
        modifiedBy: createdBy,
        createdBy
      }
    }

    function makeFindAll (groups: Doc[] = [settingsDoc]): FindAllFn {
      return async (_ctx, _class, query: any) => {
        if (_class === MODULE_PERMISSION_GROUP_CLASS) return groups
        if (_class === core.class.ClassPermission) return [policyPermission as any]
        if (_class === core.class.CustomSequence && query?._id === sequenceId) {
          return [{ _id: sequenceId, namespace: ALLOWED_SEQUENCE_NAMESPACE, sequence: 10 } as any]
        }
        if (_class === COVERED_CLASS && query?._id === ownParentId) return [makeParent(ownParentId, GUEST_SOCIAL)]
        if (_class === COVERED_CLASS && query?._id === foreignParentId) {
          return [makeParent(foreignParentId, OTHER_SOCIAL)]
        }
        return []
      }
    }

    function makeGuest (): Account {
      return {
        uuid: generateId() as any,
        role: AccountRole.Guest,
        primarySocialId: GUEST_SOCIAL,
        socialIds: [GUEST_SOCIAL],
        fullSocialIds: []
      }
    }

    function patchHierarchy (mw: GuestPermissionsMiddleware): void {
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => {
        if (b === core.class.Space) return false
        return a === b
      }
      ;(mw as any).context.hierarchy.classHierarchyMixin = () => undefined
    }

    function makePolicyMiddleware (groups?: Doc[]): GuestPermissionsMiddleware {
      const mw = makeMiddleware(makeFindAll(groups))
      patchHierarchy(mw)
      return mw
    }

    function makeApply (txes: Tx[]): Tx {
      const factory = new TxFactory('test:account:System' as PersonId)
      return factory.createTxApplyIf(ALLOWED_SPACE, undefined, [], [], txes as any, 'test')
    }

    function makeSequenceCreate (namespace: string, sequence: number): Tx {
      const factory = new TxFactory('test:account:System' as PersonId)
      return factory.createTxCreateDoc(core.class.CustomSequence, core.space.Workspace, {
        attachedTo: core.class.CustomSequence,
        namespace,
        scope: '',
        prefix: 'seq',
        sequence
      })
    }

    function makeGuardedSequenceCreate (namespace: string, sequence: number): Tx {
      const factory = new TxFactory('test:account:System' as PersonId)
      return factory.createTxApplyIf(
        core.space.Workspace,
        undefined,
        [],
        [{ _class: core.class.CustomSequence, query: { namespace, scope: '', prefix: 'seq' } }],
        [makeSequenceCreate(namespace, sequence) as any],
        'test'
      )
    }

    function makeSequenceUpdate (operations: any): Tx {
      const factory = new TxFactory('test:account:System' as PersonId)
      return factory.createTxUpdateDoc(core.class.CustomSequence, core.space.Workspace, sequenceId, operations)
    }

    function makeAttachedCreate (objectClass: Ref<Class<Doc>>, space: Ref<Space>, parentId: Ref<Doc>): Tx {
      const factory = new TxFactory(GUEST_SOCIAL)
      return factory.createTxCreateDoc(objectClass, space, {
        attachedTo: parentId,
        attachedToClass: COVERED_CLASS
      })
    }

    it('allows related creates in an apply that creates the target class in the same space', async () => {
      const mw = makePolicyMiddleware()
      const apply = makeApply([makeCreateTx(RELATED_CLASS, ALLOWED_SPACE), makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)])
      await mw.tx(makeCtx(makeGuest()), [apply])
    })

    it('loads application class policies from a single guest create permission', async () => {
      const createGroup = makeGuestSettingsDoc([GUEST_CREATE_PERMISSION])
      const findAll: FindAllFn = async (_ctx, _class) => {
        if (_class === MODULE_PERMISSION_GROUP_CLASS) return [createGroup]
        if (_class === core.class.Permission) {
          return [{ _id: GUEST_CREATE_PERMISSION, guestCreate: true } as any]
        }
        if (_class === core.class.ClassPermission) return [policyPermission as any]
        return []
      }
      const mw = makeMiddleware(findAll)
      patchHierarchy(mw)

      await mw.tx(makeCtx(makeGuest()), [makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)])
    })

    it('forbids related creates outside of an apply with the target class', async () => {
      const mw = makePolicyMiddleware()
      await expect(mw.tx(makeCtx(makeGuest()), [makeCreateTx(RELATED_CLASS, ALLOWED_SPACE)])).rejects.toThrow()
    })

    it('forbids related creates in a different space than the target document', async () => {
      const mw = makePolicyMiddleware()
      const apply = makeApply([
        makeCreateTx(COVERED_CLASS, ALLOWED_SPACE),
        makeCreateTx(RELATED_CLASS, FORBIDDEN_SPACE)
      ])
      await expect(mw.tx(makeCtx(makeGuest()), [apply])).rejects.toThrow()
    })

    it('forbids everything when the permission is disabled in the group', async () => {
      const mw = makePolicyMiddleware([makeGuestSettingsDoc([COVERED_CLASS_PERMISSION], [COVERED_CLASS_PERMISSION])])
      await expect(mw.tx(makeCtx(makeGuest()), [makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)])).rejects.toThrow()
      await expect(mw.tx(makeCtx(makeGuest()), [makeSequenceCreate(ALLOWED_SEQUENCE_NAMESPACE, 0)])).rejects.toThrow()
    })

    it('forbids everything when the group is disabled', async () => {
      const disabledGroup = { ...(makeGuestSettingsDoc([COVERED_CLASS_PERMISSION]) as any), enabled: false }
      const mw = makePolicyMiddleware([disabledGroup])
      const apply = makeApply([makeCreateTx(RELATED_CLASS, ALLOWED_SPACE), makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)])
      await expect(mw.tx(makeCtx(makeGuest()), [apply])).rejects.toThrow()
    })

    it('allows creating a guarded permitted sequence from zero only', async () => {
      const mw = makePolicyMiddleware()
      await mw.tx(makeCtx(makeGuest()), [makeGuardedSequenceCreate(ALLOWED_SEQUENCE_NAMESPACE, 0)])
      await expect(
        mw.tx(makeCtx(makeGuest()), [makeGuardedSequenceCreate(ALLOWED_SEQUENCE_NAMESPACE, 1000)])
      ).rejects.toThrow()
      await expect(mw.tx(makeCtx(makeGuest()), [makeGuardedSequenceCreate('other.sequence', 0)])).rejects.toThrow()
    })

    it('forbids creating a sequence without a matching apply guard', async () => {
      const mw = makePolicyMiddleware()
      await expect(
        mw.tx(makeCtx(makeGuest()), [makeSequenceCreate(ALLOWED_SEQUENCE_NAMESPACE, 0)])
      ).rejects.toThrow()
    })

    it('allows moving a permitted sequence forward only', async () => {
      const mw = makePolicyMiddleware()
      await mw.tx(makeCtx(makeGuest()), [makeSequenceUpdate({ $inc: { sequence: 1 } })])
      // Allocation catches a lagging sequence up to the minimum in a single increment.
      await mw.tx(makeCtx(makeGuest()), [makeSequenceUpdate({ $inc: { sequence: 42 } })])
      await expect(mw.tx(makeCtx(makeGuest()), [makeSequenceUpdate({ $inc: { sequence: 0 } })])).rejects.toThrow()
      await expect(mw.tx(makeCtx(makeGuest()), [makeSequenceUpdate({ $inc: { sequence: -1 } })])).rejects.toThrow()
      await expect(mw.tx(makeCtx(makeGuest()), [makeSequenceUpdate({ $inc: { sequence: 1.5 } })])).rejects.toThrow()
      await expect(
        mw.tx(makeCtx(makeGuest()), [makeSequenceUpdate({ $inc: { sequence: 100_001 } })])
      ).rejects.toThrow()
      await expect(
        mw.tx(makeCtx(makeGuest()), [makeSequenceUpdate({ $inc: { sequence: 1, other: 1 } })])
      ).rejects.toThrow()
      await expect(mw.tx(makeCtx(makeGuest()), [makeSequenceUpdate({ sequence: 0 })])).rejects.toThrow()
      await expect(mw.tx(makeCtx(makeGuest()), [makeSequenceUpdate({ namespace: 'other.sequence' })])).rejects.toThrow()
    })

    it('forbids sequence changes when no policy grants a namespace', async () => {
      const mw = makePolicyMiddleware([makeGuestSettingsDoc([])])
      await expect(mw.tx(makeCtx(makeGuest()), [makeSequenceCreate(ALLOWED_SEQUENCE_NAMESPACE, 0)])).rejects.toThrow()
      await expect(mw.tx(makeCtx(makeGuest()), [makeSequenceUpdate({ $inc: { sequence: 1 } })])).rejects.toThrow()
    })

    it('allows attaching a related class to an own target document', async () => {
      const mw = makePolicyMiddleware()
      await mw.tx(makeCtx(makeGuest()), [makeAttachedCreate(RELATED_CLASS, ALLOWED_SPACE, ownParentId)])
    })

    it('forbids attaching a class outside the policy to an own document', async () => {
      const mw = makePolicyMiddleware()
      await expect(
        mw.tx(makeCtx(makeGuest()), [makeAttachedCreate(UNCOVERED_CLASS, ALLOWED_SPACE, ownParentId)])
      ).rejects.toThrow()
    })

    it('forbids attaching a related class to a document created by another account', async () => {
      const mw = makePolicyMiddleware()
      await expect(
        mw.tx(makeCtx(makeGuest()), [makeAttachedCreate(RELATED_CLASS, ALLOWED_SPACE, foreignParentId)])
      ).rejects.toThrow()
    })

    it('forbids attaching a related class to an own document from another space', async () => {
      const mw = makePolicyMiddleware()
      await expect(
        mw.tx(makeCtx(makeGuest()), [makeAttachedCreate(RELATED_CLASS, FORBIDDEN_SPACE, ownParentId)])
      ).rejects.toThrow()
    })

    it('reloads policies after a ClassPermission change', async () => {
      let permission: object = policyPermission
      const findAll: FindAllFn = async (_ctx, _class) => {
        if (_class === MODULE_PERMISSION_GROUP_CLASS) return [settingsDoc]
        if (_class === core.class.ClassPermission) return [permission as any]
        return []
      }
      const mw = makeMiddleware(findAll)
      patchHierarchy(mw)
      await mw.tx(makeCtx(makeGuest()), [makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)])

      permission = { ...policyPermission, targetClass: UNCOVERED_CLASS }
      const factory = new TxFactory('test:account:System' as PersonId)
      const permissionUpdate = factory.createTxUpdateDoc(
        core.class.ClassPermission,
        core.space.Model,
        COVERED_CLASS_PERMISSION as Ref<ClassPermission>,
        { targetClass: UNCOVERED_CLASS }
      )
      await mw.tx(makeCtx(makeAccount(AccountRole.Owner)), [permissionUpdate])

      await expect(mw.tx(makeCtx(makeGuest()), [makeCreateTx(COVERED_CLASS, ALLOWED_SPACE)])).rejects.toThrow()
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

    it('allows Guest create when TxAccessLevel.createAccessLevel is ReadOnlyGuest (uncovered type)', async () => {
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
          return { createAccessLevel: AccountRole.ReadOnlyGuest }
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

    it('allows Guest update and remove when the required access level is ReadOnlyGuest', async () => {
      let nextCallCount = 0
      const mw = makeMiddleware(
        async () => [],
        async () => {
          nextCallCount++
          return {}
        }
      )
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, _mixin: any) => {
        if (_class === UNCOVERED_CLASS) {
          return {
            updateAccessLevel: AccountRole.ReadOnlyGuest,
            removeAccessLevel: AccountRole.ReadOnlyGuest
          }
        }
        return undefined
      }
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => {
        if (b === core.class.Space) return false
        return a === b
      }

      const factory = new TxFactory('test:account:System' as PersonId)
      const objectId = generateId()
      const updateTx = factory.createTxUpdateDoc(UNCOVERED_CLASS, ALLOWED_SPACE, objectId, {})
      const removeTx = factory.createTxRemoveDoc(UNCOVERED_CLASS, ALLOWED_SPACE, objectId)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))

      await mw.tx(ctx, [updateTx])
      await mw.tx(ctx, [removeTx])

      expect(nextCallCount).toBe(2)
    })

    it('forbids Guest create when TxAccessLevel requires User', async () => {
      const mw = makeMiddleware(async () => [])
      ;(mw as any).context.hierarchy.classHierarchyMixin = (_class: any, _mixin: any) => {
        if (_class === UNCOVERED_CLASS) {
          return { createAccessLevel: AccountRole.User }
        }
        return undefined
      }
      ;(mw as any).context.hierarchy.isDerived = (a: any, b: any) => {
        if (b === core.class.Space) return false
        return a === b
      }

      const tx = makeCreateTx(UNCOVERED_CLASS, ALLOWED_SPACE)
      const ctx = makeCtx(makeAccount(AccountRole.Guest))

      await expect(mw.tx(ctx, [tx])).rejects.toThrow()
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

  // ─── Policy-controlled updates of guest-owned documents ──────────────────────
  describe('guest updates of own documents', () => {
    const GUEST_SOCIAL = 'test:guest-social' as PersonId
    const objectId = generateId()

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

    function makeOwnedDocument (createdBy: PersonId = GUEST_SOCIAL): Doc {
      return {
        _id: objectId,
        _class: COVERED_CLASS,
        space: ALLOWED_SPACE,
        modifiedOn: Date.now(),
        modifiedBy: createdBy,
        createdBy
      }
    }

    function makeOwnUpdateMiddleware (
      policyOverrides: Partial<ClassPermission> = {},
      createdBy: PersonId = GUEST_SOCIAL,
      groupOverrides: Record<string, unknown> = {}
    ): GuestPermissionsMiddleware {
      const group = { ...makeGuestSettingsDoc([GUEST_CREATE_PERMISSION]), ...groupOverrides } as Doc
      const permission = {
        _id: COVERED_CLASS_PERMISSION,
        targetClass: COVERED_CLASS,
        application: TEST_APPLICATION,
        guestUpdateAttributes: ['name'],
        guestUpdateMixinAttributes: { [ALLOWED_MIXIN]: ['caption'] },
        ...policyOverrides
      }
      const mw = makeMiddleware(async (_ctx, _class, query: any) => {
        if (_class === MODULE_PERMISSION_GROUP_CLASS) return [group]
        if (_class === core.class.Permission) return [{ _id: GUEST_CREATE_PERMISSION, guestCreate: true } as any]
        if (_class === core.class.ClassPermission) return [permission as any]
        if (_class === COVERED_CLASS && query?._id === objectId) return [makeOwnedDocument(createdBy)]
        return []
      })
      patchHierarchyNoTxAccessLevel(mw)
      return mw
    }

    it('allows a guest to update whitelisted fields of a document created by the same account', async () => {
      const mw = makeOwnUpdateMiddleware()
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxUpdateDoc(COVERED_CLASS, ALLOWED_SPACE, objectId, { name: 'x' } as any)
      await mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])
    })

    it('allows whitelisted update operators', async () => {
      const mw = makeOwnUpdateMiddleware()
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxUpdateDoc(COVERED_CLASS, ALLOWED_SPACE, objectId, { $unset: { name: true } } as any)
      await mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])
    })

    it('forbids updating fields outside the whitelist', async () => {
      const mw = makeOwnUpdateMiddleware()
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxUpdateDoc(COVERED_CLASS, ALLOWED_SPACE, objectId, { state: 'approved' } as any)
      await expect(mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])).rejects.toThrow()
    })

    it('forbids updating a document created by another account', async () => {
      const otherSocial = 'test:other-social' as PersonId
      const mw = makeOwnUpdateMiddleware({}, otherSocial)
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxUpdateDoc(COVERED_CLASS, ALLOWED_SPACE, objectId, { name: 'x' } as any)
      await expect(mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])).rejects.toThrow()
    })

    it('forbids updating an own document when the module group is disabled', async () => {
      const mw = makeOwnUpdateMiddleware({}, GUEST_SOCIAL, { enabled: false })
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxUpdateDoc(COVERED_CLASS, ALLOWED_SPACE, objectId, { name: 'x' } as any)
      await expect(mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])).rejects.toThrow()
    })

    it('forbids updating an own document when guest object creation is disabled', async () => {
      const mw = makeOwnUpdateMiddleware({}, GUEST_SOCIAL, {
        disabledPermissions: [GUEST_CREATE_PERMISSION]
      })
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxUpdateDoc(COVERED_CLASS, ALLOWED_SPACE, objectId, { name: 'x' } as any)
      await expect(mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])).rejects.toThrow()
    })

    it('forbids updating an own document in a space of another class', async () => {
      const mw = makeOwnUpdateMiddleware({}, GUEST_SOCIAL, { spaceClass: OTHER_SPACE_CLASS })
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxUpdateDoc(COVERED_CLASS, ALLOWED_SPACE, objectId, { name: 'x' } as any)
      await expect(mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])).rejects.toThrow()
    })

    it('allows only whitelisted mixin fields on an own document', async () => {
      const mw = makeOwnUpdateMiddleware()
      const factory = new TxFactory(GUEST_SOCIAL)
      const allowedTx = factory.createTxMixin(
        objectId,
        COVERED_CLASS,
        ALLOWED_SPACE,
        ALLOWED_MIXIN,
        { caption: 'x' } as any
      )
      await mw.tx(makeCtx(makeGuestAccountWithSocial()), [allowedTx])

      const forbiddenTx = factory.createTxMixin(
        objectId,
        COVERED_CLASS,
        ALLOWED_SPACE,
        ALLOWED_MIXIN,
        { systemState: 'approved' } as any
      )
      await expect(mw.tx(makeCtx(makeGuestAccountWithSocial()), [forbiddenTx])).rejects.toThrow()
    })

    it('forbids removing an own document without an explicit removal policy', async () => {
      const mw = makeOwnUpdateMiddleware()
      const factory = new TxFactory(GUEST_SOCIAL)
      const tx = factory.createTxRemoveDoc(COVERED_CLASS, ALLOWED_SPACE, objectId)
      await expect(mw.tx(makeCtx(makeGuestAccountWithSocial()), [tx])).rejects.toThrow()
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
      expect((mw as any).permissionsCache).toBeUndefined()
    })
  })
})
