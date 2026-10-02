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
  type AccountUuid,
  type Class,
  type Doc,
  type MeasureContext,
  type PersonId,
  type Ref,
  type SessionData,
  type Space,
  type Tx,
  type TxCUD,
  TxFactory
} from '@hcengineering/core'
import contact from '@hcengineering/contact'
import { addLocation, type Plugin, type Resource } from '@hcengineering/platform'
import type {
  GuestTxDecision,
  GuestTxValidatorControl,
  GuestTxValidatorFunc,
  PipelineContext
} from '@hcengineering/server-core'
import { GuestPermissionsMiddleware } from '../guestPermissions'

const VALIDATOR_PLUGIN = 'test-guest-validator' as Plugin
const VALIDATOR = `${VALIDATOR_PLUGIN}:function:Validate` as Resource<GuestTxValidatorFunc>

const APP = 'test:app:Docs' as Ref<Doc>
const OTHER_APP = 'test:app:Other' as Ref<Doc>
const POLICY = 'test:permission:Docs' as Ref<Doc>
const TARGET = 'test:class:Target' as Ref<Class<Doc>>
const DERIVED = 'test:class:Derived' as Ref<Class<Doc>>
const UNRELATED = 'test:class:Unrelated' as Ref<Class<Doc>>
const SPACE = 'test:space:Docs' as Ref<Space>

const GUEST = 'test:guest' as PersonId
const OTHER = 'test:other' as PersonId
const GUEST_UUID = generateId() as unknown as AccountUuid
const GUEST_PERSON = 'test:person:Guest' as Ref<Doc>

const foreignDoc = 'test:doc:Foreign' as Ref<Doc>
const ownDoc = 'test:doc:Own' as Ref<Doc>
const unrelatedDoc = 'test:doc:Unrelated' as Ref<Doc>

function makeDoc (
  _id: Ref<Doc>,
  _class: Ref<Class<Doc>>,
  createdBy: PersonId,
  extra: Record<string, unknown> = {}
): Doc {
  return { _id, _class, space: SPACE, modifiedOn: 0, modifiedBy: createdBy, createdBy, ...extra }
}

const docs = new Map<Ref<Doc>, Doc>([
  [foreignDoc, makeDoc(foreignDoc, TARGET, OTHER)],
  [ownDoc, makeDoc(ownDoc, TARGET, GUEST)],
  [unrelatedDoc, makeDoc(unrelatedDoc, UNRELATED, OTHER)]
])

let decide: (tx: TxCUD<Doc>, control: GuestTxValidatorControl) => GuestTxDecision = () => undefined
const calls: Array<{ tx: TxCUD<Doc>, control: GuestTxValidatorControl }> = []

addLocation(VALIDATOR_PLUGIN, async () => ({
  default: async () => ({
    function: {
      Validate: async (tx: TxCUD<Doc>, control: GuestTxValidatorControl): Promise<GuestTxDecision> => {
        calls.push({ tx, control })
        return decide(tx, control)
      }
    }
  })
}))

function makeMiddleware ({ enabled = true, application = APP } = {}): GuestPermissionsMiddleware {
  const group = {
    ...makeDoc(generateId(), core.class.ModulePermissionGroup, OTHER),
    application,
    role: AccountRole.Guest,
    permissions: [POLICY],
    enabled
  }
  const policy = {
    ...makeDoc(POLICY, core.class.ClassPermission, OTHER),
    targetClass: TARGET,
    application,
    guestUpdateAttributes: ['title']
  }
  const findAll = async (_ctx: MeasureContext, _class: Ref<Class<Doc>>, query: any): Promise<any[]> => {
    if (_class === core.class.ModulePermissionGroup) return enabled ? [group] : []
    if (_class === core.class.Permission) return []
    if (_class === core.class.ClassPermission) return query?._id?.$in?.includes(POLICY) === true ? [policy] : []
    if (_class === contact.class.Person) {
      return query?.personUuid === GUEST_UUID ? [{ _id: GUEST_PERSON, personUuid: GUEST_UUID }] : []
    }
    const doc = docs.get(query?._id)
    return doc !== undefined ? [doc] : []
  }
  const hierarchy = {
    isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) =>
      a === b || (a === DERIVED && b === TARGET) || (a === core.class.ClassPermission && b === core.class.Permission),
    classHierarchyMixin: () => undefined
  }
  const modelDb = {
    findAllSync: (_class: Ref<Class<Doc>>) =>
      _class === core.class.ClassCollaborators
        ? []
        : [{ _id: 'test:validator', validator: VALIDATOR, application: APP, classes: [TARGET] }]
  }
  const context = { hierarchy, modelDb } as unknown as PipelineContext
  const next = { tx: async () => ({}) }
  const mw = new (GuestPermissionsMiddleware as any)(context, next) as GuestPermissionsMiddleware
  ;(mw as any).findAll = findAll
  return mw
}

function makeCtx (role = AccountRole.Guest): MeasureContext<SessionData> {
  const account: Account = { uuid: GUEST_UUID, role, primarySocialId: GUEST, socialIds: [GUEST], fullSocialIds: [] }
  const ctx = new MeasureMetricsContext('test', {}) as MeasureContext<SessionData>
  ctx.contextData = { account, broadcast: { txes: [], queue: [], sessions: {} } } as any
  return ctx
}

const factory = new TxFactory(GUEST)

function update (_id: Ref<Doc>, operations: Record<string, unknown>, _class = TARGET): TxCUD<Doc> {
  return factory.createTxUpdateDoc(_class, SPACE, _id, operations)
}

async function allowed (mw: GuestPermissionsMiddleware, tx: Tx, role?: AccountRole): Promise<void> {
  await mw.tx(makeCtx(role), [tx])
}

async function forbidden (mw: GuestPermissionsMiddleware, tx: Tx): Promise<void> {
  await expect(mw.tx(makeCtx(), [tx])).rejects.toThrow()
}

describe('GuestPermissionsMiddleware module validators', () => {
  beforeEach(() => {
    decide = () => undefined
    calls.length = 0
  })

  it('allows a transaction the generic rules reject', async () => {
    const mw = makeMiddleware()
    await forbidden(mw, update(foreignDoc, { title: 'Renamed' }))
    decide = () => 'allow'
    await allowed(mw, update(foreignDoc, { title: 'Renamed' }))
  })

  it('rejects a transaction the generic rules allow', async () => {
    const mw = makeMiddleware()
    await allowed(mw, update(ownDoc, { title: 'Renamed' }))
    decide = () => 'deny'
    await forbidden(mw, update(ownDoc, { title: 'Renamed' }))
  })

  it('falls back to the generic rules without a decision', async () => {
    const mw = makeMiddleware()
    await allowed(mw, update(ownDoc, { title: 'Renamed' }))
    await forbidden(mw, update(ownDoc, { state: 'released' }))
    expect(calls).toHaveLength(2)
  })

  it('validates derived classes and skips other classes', async () => {
    const mw = makeMiddleware()
    decide = () => 'deny'
    await forbidden(mw, update(ownDoc, { title: 'Renamed' }, DERIVED))
    decide = () => 'allow'
    await forbidden(mw, update(unrelatedDoc, { title: 'Renamed' }, UNRELATED))
    expect(calls.map((it) => it.tx.objectClass)).toEqual([DERIVED])
  })

  it('is inactive without an active policy of the module', async () => {
    decide = () => 'allow'
    await forbidden(makeMiddleware({ enabled: false }), update(foreignDoc, { title: 'Renamed' }))
    await forbidden(makeMiddleware({ application: OTHER_APP }), update(foreignDoc, { title: 'Renamed' }))
    expect(calls).toHaveLength(0)
  })

  it('is not used for users', async () => {
    decide = () => 'deny'
    await allowed(makeMiddleware(), update(foreignDoc, { title: 'Renamed' }), AccountRole.User)
    expect(calls).toHaveLength(0)
  })

  it('passes the guest person and the transactions of the enclosing apply', async () => {
    const mw = makeMiddleware()
    decide = () => 'allow'
    const first = update(foreignDoc, { title: 'Renamed' })
    const second = update(ownDoc, { title: 'Renamed' })
    await allowed(mw, factory.createTxApplyIf(core.space.Tx, generateId(), [], [], [first, second], 'test'))
    expect(calls).toHaveLength(2)
    expect(calls[0].control.person).toBe(GUEST_PERSON)
    expect(calls[0].control.applyTxes).toEqual([first, second])

    calls.length = 0
    await allowed(mw, first)
    expect(calls[0].control.applyTxes).toEqual([])
  })
})
