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
  TxFactory
} from '@hcengineering/core'
import contact from '@hcengineering/contact'
import type { PipelineContext } from '@hcengineering/server-core'
import { GuestPermissionsMiddleware } from '../guestPermissions'

const APP = 'test:app:Process' as Ref<Doc>
const POLICY = 'test:permission:Participate' as Ref<Doc>
const TASK = 'test:class:Task' as Ref<Class<Doc>>
const APPROVAL = 'test:class:Approval' as Ref<Class<Doc>>
const CARD_CLASS = 'test:class:Card' as Ref<Class<Doc>>
const CARD_SPACE_CLASS = 'test:class:CardSpace' as Ref<Class<Space>>
const TODO_SPACE = 'test:space:ToDos' as Ref<Space>
const CARD_SPACE = 'test:space:Cards' as Ref<Space>
const HIDDEN_SPACE = 'test:space:Hidden' as Ref<Space>
const ARCHIVED_SPACE = 'test:space:Archived' as Ref<Space>

const GUEST = 'test:guest' as PersonId
const OTHER = 'test:other' as PersonId
const GUEST_UUID = generateId() as unknown as AccountUuid
const GUEST_PERSON = 'test:person:Guest' as Ref<Doc>
const OTHER_PERSON = 'test:person:Other' as Ref<Doc>

const card = 'test:card:Shared' as Ref<Doc>
const hiddenCard = 'test:card:Hidden' as Ref<Doc>
const collaboratorCard = 'test:card:Collaborator' as Ref<Doc>
const archivedCard = 'test:card:Archived' as Ref<Doc>

/** Attributes declared by each class; APPROVAL is derived from TASK. */
const attributes = new Map<Ref<Class<Doc>>, string[]>([
  [TASK, ['user', 'doneOn', 'title']],
  [APPROVAL, ['user', 'doneOn', 'title', 'approved', 'reason']]
])

function makeDoc (_id: Ref<Doc>, _class: Ref<Class<Doc>>, space: Ref<Space>, extra: Record<string, unknown> = {}): Doc {
  return { _id, _class, space, modifiedOn: 0, modifiedBy: OTHER, createdBy: OTHER, ...extra }
}

function makeSpace (_id: Ref<Space>, members: AccountUuid[], archived = false): Doc {
  return makeDoc(_id, CARD_SPACE_CLASS, core.space.Space, { members, archived, private: true })
}

function makeTask (
  _class: Ref<Class<Doc>>,
  attachedTo: Ref<Doc>,
  extra: Record<string, unknown> = {}
): { _id: Ref<Doc>, doc: Doc } {
  const _id = generateId<Doc>()
  return {
    _id,
    doc: makeDoc(_id, _class, TODO_SPACE, {
      user: GUEST_PERSON,
      doneOn: null,
      attachedTo,
      attachedToClass: CARD_CLASS,
      collection: 'todos',
      ...extra
    })
  }
}

const openTask = makeTask(TASK, card)
const openApproval = makeTask(APPROVAL, card)
const closedTask = makeTask(TASK, card, { doneOn: 1 })
const foreignTask = makeTask(TASK, card, { user: OTHER_PERSON })
const hiddenCardTask = makeTask(TASK, hiddenCard)
const collaboratorCardTask = makeTask(TASK, collaboratorCard)
const archivedCardTask = makeTask(TASK, archivedCard)

const docs = new Map<Ref<Doc>, Doc>([
  [GUEST_PERSON, makeDoc(GUEST_PERSON, contact.class.Person, core.space.Space, { personUuid: GUEST_UUID })],
  [OTHER_PERSON, makeDoc(OTHER_PERSON, contact.class.Person, core.space.Space, { personUuid: generateId() })],
  [TODO_SPACE, makeDoc(TODO_SPACE, core.class.SystemSpace, core.space.Space, { members: [] })],
  [CARD_SPACE, makeSpace(CARD_SPACE, [GUEST_UUID])],
  [HIDDEN_SPACE, makeSpace(HIDDEN_SPACE, [])],
  [ARCHIVED_SPACE, makeSpace(ARCHIVED_SPACE, [GUEST_UUID], true)],
  [card, makeDoc(card, CARD_CLASS, CARD_SPACE)],
  [hiddenCard, makeDoc(hiddenCard, CARD_CLASS, HIDDEN_SPACE)],
  [collaboratorCard, makeDoc(collaboratorCard, CARD_CLASS, HIDDEN_SPACE)],
  [archivedCard, makeDoc(archivedCard, CARD_CLASS, ARCHIVED_SPACE)],
  ...[openTask, openApproval, closedTask, foreignTask, hiddenCardTask, collaboratorCardTask, archivedCardTask].map(
    ({ _id, doc }) => [_id, doc] as const
  )
])

const collaborators = [{ attachedTo: collaboratorCard, collaborator: GUEST_UUID }]

function makeGroup (overrides: Record<string, unknown> = {}): Doc {
  return {
    ...makeDoc(generateId(), core.class.ModulePermissionGroup, core.space.Model),
    application: APP,
    role: AccountRole.Guest,
    permissions: [POLICY],
    enabled: true,
    ...overrides
  } as any
}

const policy = {
  ...makeDoc(POLICY, core.class.ClassPermission, core.space.Model),
  targetClass: TASK,
  guestAssignee: {
    field: 'user',
    attributes: ['doneOn', 'approved', 'reason'],
    openField: 'doneOn',
    requireAttachedToAccess: true
  }
}

interface Options {
  groups?: Doc[]
  /** Card classes with collaborator security. */
  collaboratorSecurity?: boolean
}

function makeMiddleware ({
  groups = [makeGroup()],
  collaboratorSecurity = false
}: Options = {}): GuestPermissionsMiddleware {
  const findAll = async (_ctx: MeasureContext, _class: Ref<Class<Doc>>, query: any): Promise<any[]> => {
    if (_class === core.class.ModulePermissionGroup) return groups
    if (_class === core.class.Permission) return []
    if (_class === core.class.ClassPermission) {
      return query?._id?.$in?.includes(POLICY) === true ? [policy] : []
    }
    if (_class === core.class.Collaborator) {
      return collaborators.filter(
        (it) => query.attachedTo.$in.includes(it.attachedTo) && it.collaborator === query.collaborator
      )
    }
    const doc = docs.get(query?._id)
    return doc !== undefined ? [doc] : []
  }
  const hierarchy = {
    isDerived: (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>) =>
      a === b || (a === APPROVAL && b === TASK) || (a === core.class.ClassPermission && b === core.class.Permission),
    findAttribute: (_class: Ref<Class<Doc>>, name: string) =>
      attributes.get(_class)?.includes(name) === true ? { name } : undefined,
    getAncestors: (_class: Ref<Class<Doc>>) => [_class],
    classHierarchyMixin: () => undefined
  }
  const modelDb = {
    findAllSync: () => (collaboratorSecurity ? [{ attachedTo: CARD_CLASS, fields: [], provideSecurity: true }] : [])
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

function update (
  task: { _id: Ref<Doc>, doc: Doc },
  operations: Record<string, unknown>,
  space: Ref<Space> = TODO_SPACE
): Tx {
  return factory.createTxUpdateDoc(task.doc._class, space, task._id, operations)
}

async function allowed (mw: GuestPermissionsMiddleware, tx: Tx, role?: AccountRole): Promise<void> {
  await mw.tx(makeCtx(role), [tx])
}

async function forbidden (mw: GuestPermissionsMiddleware, tx: Tx, role?: AccountRole): Promise<void> {
  await expect(mw.tx(makeCtx(role), [tx])).rejects.toThrow()
}

describe('GuestPermissionsMiddleware assignee policies', () => {
  it('allows the assignee to complete its open task', async () => {
    await allowed(makeMiddleware(), update(openTask, { doneOn: Date.now() }))
  })

  it('allows the assignee to approve or reject its request', async () => {
    const mw = makeMiddleware()
    await allowed(mw, update(openApproval, { doneOn: Date.now(), approved: true }))
    await allowed(mw, update(openApproval, { doneOn: Date.now(), approved: false, reason: 'No' }))
  })

  it('allows the assignee inside an apply', async () => {
    const tx = factory.createTxApplyIf(
      core.space.Tx,
      generateId(),
      [],
      [],
      [update(openTask, { doneOn: Date.now() })] as any,
      'test'
    )
    await allowed(makeMiddleware(), tx)
  })

  it('rejects attributes outside of the rule or missing on the document class', async () => {
    const mw = makeMiddleware()
    await forbidden(mw, update(openTask, { doneOn: Date.now(), title: 'Renamed' }))
    // `approved` is declared by the approval class only.
    await forbidden(mw, update(openTask, { doneOn: Date.now(), approved: true }))
  })

  it('rejects a task assigned to someone else', async () => {
    await forbidden(makeMiddleware(), update(foreignTask, { doneOn: Date.now() }))
  })

  it('rejects a task that is already completed', async () => {
    const mw = makeMiddleware()
    await forbidden(mw, update(closedTask, { doneOn: Date.now() }))
    await forbidden(mw, update(closedTask, { doneOn: null }))
  })

  it('rejects a task whose card the guest can not read', async () => {
    const mw = makeMiddleware()
    await forbidden(mw, update(hiddenCardTask, { doneOn: Date.now() }))
    await forbidden(mw, update(archivedCardTask, { doneOn: Date.now() }))
  })

  it('accepts card access through collaborator security', async () => {
    await forbidden(makeMiddleware(), update(collaboratorCardTask, { doneOn: Date.now() }))
    await allowed(makeMiddleware({ collaboratorSecurity: true }), update(collaboratorCardTask, { doneOn: Date.now() }))
  })

  it('rejects a tx with a wrong object space', async () => {
    await forbidden(makeMiddleware(), update(openTask, { doneOn: Date.now() }, CARD_SPACE))
  })

  it('rejects removals', async () => {
    await forbidden(makeMiddleware(), factory.createTxRemoveDoc(TASK, TODO_SPACE, openTask._id))
  })

  it.each([[makeGroup({ enabled: false })], [makeGroup({ disabledPermissions: [POLICY] })]])(
    'rejects updates when the permission is not effective',
    async (group) => {
      await forbidden(makeMiddleware({ groups: [group] }), update(openTask, { doneOn: Date.now() }))
    }
  )

  it('rejects read-only guests', async () => {
    await forbidden(makeMiddleware(), update(openTask, { doneOn: Date.now() }), AccountRole.ReadOnlyGuest)
  })
})
