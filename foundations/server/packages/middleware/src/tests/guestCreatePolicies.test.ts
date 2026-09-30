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

import core, {
  AccountRole,
  generateId,
  MeasureMetricsContext,
  type Account,
  type Class,
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
import type { PipelineContext } from '@hcengineering/server-core'
import { GuestPermissionsMiddleware } from '../guestPermissions'

const APP = 'test:app:Docs' as Ref<Doc>
const GUEST_CREATE = 'test:permission:GuestCreate' as Ref<Doc>
const POLICY = 'test:permission:TargetPolicy' as Ref<Doc>
const BASE_CLASS = 'test:class:Base' as Ref<Class<Doc>>
const TARGET = 'test:class:Target' as Ref<Class<Doc>>
const RELATED = 'test:class:Related' as Ref<Class<Doc>>
const UNCOVERED = 'test:class:Uncovered' as Ref<Class<Doc>>
const MIXIN = 'test:mixin:Template' as Ref<Mixin<Doc>>
const POLICY_SPACE_CLASS = 'test:class:PolicySpace' as Ref<Class<Space>>
const OTHER_SPACE_CLASS = 'test:class:OtherSpace' as Ref<Class<Space>>
const SPACE = 'test:space:Policy' as Ref<Space>
const OTHER_SPACE = 'test:space:Other' as Ref<Space>
const NAMESPACE = 'test.sequence'
const GUEST = 'test:guest' as PersonId
const OTHER = 'test:other' as PersonId

const ownTarget = generateId()
const foreignTarget = generateId()
const ownUncovered = generateId()
const sequenceId = generateId()

function makeDoc (_id: Ref<Doc>, _class: Ref<Class<Doc>>, createdBy: PersonId, space = SPACE): Doc {
  return { _id, _class, space, modifiedOn: 0, modifiedBy: createdBy, createdBy }
}

const docs = new Map<Ref<Doc>, Doc>([
  [ownTarget, makeDoc(ownTarget, TARGET, GUEST)],
  [foreignTarget, makeDoc(foreignTarget, TARGET, OTHER)],
  [ownUncovered, makeDoc(ownUncovered, UNCOVERED, GUEST)],
  [SPACE, makeDoc(SPACE, POLICY_SPACE_CLASS, OTHER, core.space.Space)],
  [OTHER_SPACE, makeDoc(OTHER_SPACE, OTHER_SPACE_CLASS, OTHER, core.space.Space)],
  [
    sequenceId,
    {
      ...makeDoc(sequenceId, core.class.CustomSequence, GUEST, core.space.Workspace),
      namespace: NAMESPACE,
      sequence: 3
    } as any
  ]
])

function makeGroup (overrides: Record<string, unknown> = {}): Doc {
  return {
    ...makeDoc(generateId(), core.class.ModulePermissionGroup, OTHER, core.space.Model),
    application: APP,
    role: AccountRole.Guest,
    permissions: [GUEST_CREATE],
    spaceClass: POLICY_SPACE_CLASS,
    enabled: true,
    ...overrides
  } as any
}

const policy = {
  ...makeDoc(POLICY, core.class.ClassPermission, OTHER, core.space.Model),
  targetClass: TARGET,
  application: APP,
  guestUpdateAttributes: ['title'],
  guestUpdateMixinAttributes: { [MIXIN]: ['prefix'] },
  guestCreateMixinAttributes: { [MIXIN]: ['sequence', 'prefix'] },
  relatedCreateClasses: [RELATED],
  sequenceNamespaces: [NAMESPACE]
}

function makeMiddleware (groups: Doc[] = [makeGroup()]): GuestPermissionsMiddleware {
  const findAll = async (_ctx: MeasureContext, _class: Ref<Class<Doc>>, query: any): Promise<Doc[]> => {
    if (_class === core.class.ModulePermissionGroup) return groups
    if (_class === core.class.Permission) {
      return query?._id?.$in?.includes(GUEST_CREATE) === true
        ? [{ ...makeDoc(GUEST_CREATE, core.class.Permission, OTHER), guestCreate: true } as any]
        : []
    }
    if (_class === core.class.ClassPermission) {
      return query?.application?.$in?.includes(APP) === true ? [policy] : []
    }
    const doc = docs.get(query?._id)
    return doc !== undefined ? [doc] : []
  }
  const hierarchy = {
    isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) =>
      a === b ||
      (a === TARGET && b === BASE_CLASS) ||
      (a === core.class.ClassPermission && b === core.class.Permission),
    classHierarchyMixin: () => undefined
  }
  const context = { hierarchy } as unknown as PipelineContext
  const next = { tx: async () => ({}) }
  const mw = new (GuestPermissionsMiddleware as any)(context, next) as GuestPermissionsMiddleware
  ;(mw as any).findAll = findAll
  return mw
}

function makeAccount (role = AccountRole.Guest): Account {
  return { uuid: generateId() as any, role, primarySocialId: GUEST, socialIds: [GUEST], fullSocialIds: [] }
}

function makeCtx (account = makeAccount()): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = { account, broadcast: { txes: [], queue: [], sessions: {} } } as any
  return ctx
}

const factory = new TxFactory(GUEST)

function create (_class: Ref<Class<Doc>>, space = SPACE, attributes: Record<string, unknown> = {}): Tx {
  return factory.createTxCreateDoc(_class, space, attributes)
}

function apply (txes: Tx[], notMatch: any[] = []): Tx {
  return factory.createTxApplyIf(SPACE, undefined, [], notMatch, txes as any, 'test')
}

function skippedApply (txes: Tx[]): Tx {
  return factory.createTxApplyIf(
    SPACE,
    undefined,
    [{ _class: TARGET, query: { _id: generateId() } }],
    [],
    txes as any,
    'test'
  )
}

async function allowed (mw: GuestPermissionsMiddleware, txes: Tx[]): Promise<void> {
  await mw.tx(makeCtx(), txes)
}

async function forbidden (mw: GuestPermissionsMiddleware, txes: Tx[]): Promise<void> {
  await expect(mw.tx(makeCtx(), txes)).rejects.toThrow()
}

describe('GuestPermissionsMiddleware module create policies', () => {
  describe('module create disabled', () => {
    const disabledGroups = [[makeGroup({ enabled: false })], [makeGroup({ disabledPermissions: [GUEST_CREATE] })]]

    it.each(disabledGroups)('forbids creating the target class', async (group) => {
      await forbidden(makeMiddleware([group]), [create(TARGET)])
    })

    it.each(disabledGroups)('keeps the generic rules for mixins and own updates', async (group) => {
      const mw = makeMiddleware([group])
      await allowed(mw, [factory.createTxMixin(foreignTarget, BASE_CLASS, SPACE, MIXIN, { sequence: 1 } as any)])
      await allowed(mw, [factory.createTxUpdateDoc(TARGET, SPACE, ownTarget, { anything: 1 } as any)])
    })
  })

  describe('create', () => {
    it('allows the target class in a space of the group space class only', async () => {
      const mw = makeMiddleware()
      await allowed(mw, [create(TARGET)])
      await forbidden(mw, [create(TARGET, OTHER_SPACE)])
    })

    it('ignores the module switch of a group without a space class', async () => {
      await forbidden(makeMiddleware([makeGroup({ spaceClass: undefined })]), [create(TARGET)])
    })

    it('allows related classes only in an apply creating the target in the same space', async () => {
      const mw = makeMiddleware()
      await allowed(mw, [apply([create(RELATED), create(TARGET)])])
      await forbidden(mw, [create(RELATED)])
      await forbidden(mw, [apply([create(TARGET), create(RELATED, OTHER_SPACE)])])
    })

    it('does not grant related create access from a conditional nested apply', async () => {
      const mw = makeMiddleware()
      await forbidden(mw, [apply([skippedApply([create(TARGET)]), create(RELATED)])])
    })

    it('allows attaching a related class to an own target only', async () => {
      const mw = makeMiddleware()
      const attached = (parent: Ref<Doc>): Tx => create(RELATED, SPACE, { attachedTo: parent, attachedToClass: TARGET })
      await allowed(mw, [attached(ownTarget)])
      await forbidden(mw, [attached(foreignTarget)])
    })
  })

  describe('mixins', () => {
    it('allows whitelisted creation mixin attributes in the creating apply', async () => {
      const mw = makeMiddleware()
      const target = create(TARGET) as any
      const mixin = (attributes: Record<string, unknown>): Tx =>
        factory.createTxMixin(target.objectId, BASE_CLASS, SPACE, MIXIN, attributes)
      await allowed(mw, [apply([target, mixin({ sequence: 0, prefix: 'T' })])])
      await forbidden(mw, [apply([target, mixin({ sequence: 0, owner: 'x' })])])
    })

    it('restricts mixins on target documents to own documents and whitelisted attributes', async () => {
      const mw = makeMiddleware()
      await allowed(mw, [factory.createTxMixin(ownTarget, BASE_CLASS, SPACE, MIXIN, { prefix: 'T' } as any)])
      await forbidden(mw, [factory.createTxMixin(ownTarget, BASE_CLASS, SPACE, MIXIN, { sequence: 9 } as any)])
      await forbidden(mw, [factory.createTxMixin(foreignTarget, BASE_CLASS, SPACE, MIXIN, { prefix: 'T' } as any)])
    })

    it('does not grant creation mixin access from a conditional nested apply', async () => {
      const mw = makeMiddleware()
      const forgedTarget = factory.createTxCreateDoc(TARGET, SPACE, {}, foreignTarget)
      const mixin = factory.createTxMixin(foreignTarget, BASE_CLASS, SPACE, MIXIN, { prefix: 'T' } as any)
      await forbidden(mw, [apply([skippedApply([forgedTarget]), mixin])])
    })

    it('keeps mixins unrestricted for classes without a restricting policy', async () => {
      const mw = makeMiddleware()
      await allowed(mw, [factory.createTxMixin(ownUncovered, UNCOVERED, SPACE, MIXIN, { any: 1 } as any)])
    })
  })

  describe('updates', () => {
    it('restricts own target updates to whitelisted attributes', async () => {
      const mw = makeMiddleware()
      await allowed(mw, [factory.createTxUpdateDoc(TARGET, SPACE, ownTarget, { title: 'x' } as any)])
      await forbidden(mw, [factory.createTxUpdateDoc(TARGET, SPACE, ownTarget, { owner: 'x' } as any)])
      await forbidden(mw, [factory.createTxUpdateDoc(TARGET, SPACE, foreignTarget, { title: 'x' } as any)])
    })

    it('keeps the generic own document rule for other classes and for removal', async () => {
      const mw = makeMiddleware()
      await allowed(mw, [factory.createTxUpdateDoc(UNCOVERED, SPACE, ownUncovered, { any: 1 } as any)])
      await allowed(mw, [factory.createTxRemoveDoc(TARGET, SPACE, ownTarget)])
    })
  })

  describe('sequences', () => {
    const sequence = (sequence: number, namespace = NAMESPACE): Tx =>
      factory.createTxCreateDoc(core.class.CustomSequence, core.space.Workspace, {
        attachedTo: core.class.CustomSequence,
        namespace,
        scope: '',
        prefix: 'seq',
        sequence
      })
    const guard = (namespace = NAMESPACE): any[] => [
      { _class: core.class.CustomSequence, query: { namespace, scope: '', prefix: 'seq' } }
    ]
    const update = (operations: object): Tx =>
      factory.createTxUpdateDoc(core.class.CustomSequence, core.space.Workspace, sequenceId, operations)

    it('allows creating a permitted sequence from zero in a guarded apply only', async () => {
      const mw = makeMiddleware()
      await allowed(mw, [apply([sequence(0)], guard())])
      await forbidden(mw, [sequence(0)])
      await forbidden(mw, [apply([sequence(5)], guard())])
      await forbidden(mw, [apply([sequence(0, 'other')], guard('other'))])
    })

    it('allows moving a permitted sequence forward only', async () => {
      const mw = makeMiddleware()
      await allowed(mw, [update({ $inc: { sequence: 5 } })])
      await forbidden(mw, [update({ $inc: { sequence: 0 } })])
      await forbidden(mw, [update({ $inc: { sequence: -1 } })])
      await forbidden(mw, [update({ sequence: 0 })])
    })

    it('forbids sequences while the module create switch is off', async () => {
      await forbidden(makeMiddleware([makeGroup({ enabled: false })]), [update({ $inc: { sequence: 1 } })])
    })
  })

  it('reloads policies after a class permission changes', async () => {
    const mw = makeMiddleware()
    await allowed(mw, [create(TARGET)])
    expect((mw as any).permissionsCache).toBeDefined()
    const userFactory = new TxFactory(OTHER)
    await mw.tx(makeCtx(makeAccount(AccountRole.Owner)), [
      userFactory.createTxUpdateDoc(core.class.ClassPermission, core.space.Model, POLICY as any, { label: 'x' } as any)
    ])
    expect((mw as any).permissionsCache).toBeUndefined()
  })
})
