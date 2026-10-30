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
  type AccountUuid,
  type AnyAttribute,
  type Class,
  type Collaborator,
  type Doc,
  type DocumentUpdate,
  type MeasureContext,
  type Ref,
  type Space,
  type Tx,
  TxFactory,
  type TxRemoveDoc
} from '@hcengineering/core'
import notification, { type DocNotifyContext } from '@hcengineering/notification'
import { type TriggerControl } from '@hcengineering/server-core'

import { OnSpaceMembersRemoved } from '../index'

const CHANNEL = 'test:class:Channel' as Ref<Class<Space>>
const NO_COLLABORATORS = 'test:class:Plain' as Ref<Class<Space>>
const SPACE = 'space-1' as Ref<Space>

const OWNER = 'acc-owner' as AccountUuid
const MEMBER = 'acc-member' as AccountUuid
const GUEST = 'acc-guest' as AccountUuid
const OUTSIDER = 'acc-outsider' as AccountUuid

const factory = new TxFactory(core.account.System)

const membersAttr = { name: 'members', type: { _class: core.class.ArrOf, of: { _class: core.class.TypeAccountUuid } } }

interface Setup {
  control: TriggerControl
  applied: Tx[][]
  queried: Array<Ref<Class<Doc>>>
}

function setup (members: AccountUuid[], collaborators: AccountUuid[], _class = CHANNEL): Setup {
  const applied: Tx[][] = []
  const queried: Array<Ref<Class<Doc>>> = []
  const space = { _id: SPACE, _class, space: core.space.Space, members } as unknown as Space
  const collabDocs = collaborators.map(
    (collaborator, i) =>
      ({
        _id: `collab-${i}`,
        _class: core.class.Collaborator,
        space: core.space.Space,
        attachedTo: SPACE,
        attachedToClass: _class,
        collaborator
      }) as unknown as Collaborator
  )
  const contexts = collaborators.map(
    (user, i) =>
      ({
        _id: `context-${i}`,
        _class: notification.class.DocNotifyContext,
        space: core.space.Space,
        objectId: SPACE,
        user
      }) as unknown as DocNotifyContext
  )
  const ctx = { with: async (_name: string, _params: any, fn: (ctx: any) => any) => await fn(ctx) }
  const control = {
    ctx: ctx as unknown as MeasureContext,
    txFactory: factory,
    hierarchy: {
      isDerived: (cls: Ref<Class<Doc>>, base: Ref<Class<Doc>>) => base === core.class.Space && cls !== core.class.Doc,
      getAncestors: (cls: Ref<Class<Doc>>) => [cls],
      findAttribute: (_cls: Ref<Class<Doc>>, field: string) =>
        field === 'members' ? (membersAttr as unknown as AnyAttribute) : undefined
    },
    modelDb: {
      findAllSync: (_cls: Ref<Class<Doc>>, query: any) =>
        (query.attachedTo.$in as string[]).includes(CHANNEL)
          ? [{ _class: core.class.ClassCollaborators, attachedTo: CHANNEL, fields: ['members'] }]
          : []
    },
    findAll: async (_ctx: MeasureContext, cls: Ref<Class<Doc>>) => {
      queried.push(cls)
      if (cls === core.class.Collaborator) return collabDocs
      if (cls === notification.class.DocNotifyContext) return contexts
      return [space]
    },
    apply: async (_ctx: MeasureContext, txes: Tx[]) => {
      applied.push(txes)
      return {}
    }
  } as unknown as TriggerControl
  return { control, applied, queried }
}

function update (operations: DocumentUpdate<Space>, _class = CHANNEL): Tx {
  return factory.createTxUpdateDoc(_class, core.space.Space, SPACE, operations)
}

function removedCollaborators (txes: Tx[]): string[] {
  return txes
    .filter((it) => it._class === core.class.TxRemoveDoc)
    .map((it) => (it as TxRemoveDoc<Doc>).objectId as string)
    .sort()
}

function removedContexts (applied: Tx[][]): string[] {
  return applied
    .flat()
    .map((it) => (it as TxRemoveDoc<Doc>).objectId as string)
    .sort()
}

describe('OnSpaceMembersRemoved', () => {
  it('$pull drops the collaborator and the notify context of the removed member at once', async () => {
    const { control, applied } = setup([OWNER, MEMBER], [OWNER, MEMBER, GUEST])
    const res = await OnSpaceMembersRemoved([update({ $pull: { members: GUEST } })], control)
    expect(removedCollaborators(res)).toEqual(['collab-2'])
    expect(removedContexts(applied)).toEqual(['context-2'])
  })

  it('$pull $in drops every removed member', async () => {
    const { control, applied } = setup([OWNER], [OWNER, MEMBER, GUEST])
    const res = await OnSpaceMembersRemoved([update({ $pull: { members: { $in: [MEMBER, GUEST] } } })], control)
    expect(removedCollaborators(res)).toEqual(['collab-1', 'collab-2'])
    expect(removedContexts(applied)).toEqual(['context-1', 'context-2'])
  })

  it('full replacement drops collaborators absent from the new list', async () => {
    const { control, applied } = setup([OWNER, MEMBER], [OWNER, MEMBER, GUEST])
    const res = await OnSpaceMembersRemoved([update({ members: [OWNER, MEMBER] })], control)
    expect(removedCollaborators(res)).toEqual(['collab-2'])
    expect(removedContexts(applied)).toEqual(['context-2'])
  })

  it('ignores a pulled account that is not a collaborator', async () => {
    const { control, applied } = setup([OWNER], [OWNER])
    const res = await OnSpaceMembersRemoved([update({ $pull: { members: OUTSIDER } })], control)
    expect(res).toEqual([])
    expect(applied).toEqual([])
  })

  it('does not query anything for updates that add members or change other fields', async () => {
    const { control, applied, queried } = setup([OWNER], [OWNER])
    const res = await OnSpaceMembersRemoved(
      [update({ $push: { members: MEMBER } }), update({ name: 'renamed' })],
      control
    )
    expect(res).toEqual([])
    expect(applied).toEqual([])
    expect(queried).toEqual([])
  })

  it('skips spaces whose class has no collaborators', async () => {
    const { control, applied, queried } = setup([OWNER], [OWNER, GUEST], NO_COLLABORATORS)
    const res = await OnSpaceMembersRemoved([update({ $pull: { members: GUEST } }, NO_COLLABORATORS)], control)
    expect(res).toEqual([])
    expect(applied).toEqual([])
    expect(queried).toEqual([])
  })
})
