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
  type Class,
  type Doc,
  type MeasureContext,
  type Ref,
  type Space,
  type Tx,
  TxFactory,
  type TxMixin,
  type TxUpdateDoc,
  type UserGroup
} from '@hcengineering/core'
import { type TriggerControl } from '@hcengineering/server-core'
import { OnSpaceMembershipChange, OnUserGroupChange } from '../spaceMembers'

const CHANNEL = 'chunter:class:Channel' as Ref<Class<Space>>
const PROJECT = 'tracker:class:Project' as Ref<Class<Space>>
const PROJECT_TYPE = 'project-type'
const PROJECT_MIXIN = 'tracker:mixin:ProjectTypeData'
const ROLE = 'role-manager'
const OTHER_ROLE = 'role-reviewer'

const A = 'acc-a' as AccountUuid
const B = 'acc-b' as AccountUuid
const G1 = 'acc-g1' as AccountUuid
const G2 = 'acc-g2' as AccountUuid

const factory = new TxFactory(core.account.System)

function group (_id: string, members: AccountUuid[]): UserGroup {
  return { _id, _class: core.class.UserGroup, name: _id, members } as unknown as UserGroup
}

function space (fields: Partial<Space> & Record<string, any>): Space {
  return { _id: 'space-1', _class: CHANNEL, space: core.space.Space, members: [], ...fields } as unknown as Space
}

function createControl (spaces: Space[], groups: UserGroup[]): TriggerControl {
  return {
    ctx: {} as unknown as MeasureContext,
    txFactory: factory,
    hierarchy: {
      isDerived: (_class: string, base: string) =>
        base === core.class.TypedSpace ? _class === PROJECT : base === core.class.UserGroup
          ? _class === core.class.UserGroup : base === core.class.Space,
      hasMixin: (doc: any, mixin: string) => doc[mixin] !== undefined,
      as: (doc: any, mixin: string) => ({ ...doc, ...doc[mixin] })
    },
    modelDb: {
      findAllSync: (_class: string, query: any) => {
        if (_class === core.class.SpaceType && query._id === PROJECT_TYPE) {
          return [{ _id: PROJECT_TYPE, targetClass: PROJECT_MIXIN }]
        }
        if (_class === core.class.Role && query.attachedTo === PROJECT_TYPE) return [{ _id: ROLE }, { _id: OTHER_ROLE }]
        return []
      }
    },
    findAll: async (_ctx: MeasureContext, _class: Ref<Class<Doc>>, query: any) => {
      if (_class === core.class.UserGroup) return groups.filter((it) => query._id.$in.includes(it._id))
      if (query.groups !== undefined) return spaces.filter((it) => (it.groups ?? []).includes(query.groups))
      return spaces.filter((it) => it._id === query._id)
    }
  } as unknown as TriggerControl
}

/** members after applying the $push / $pull updates produced by the trigger. */
function applyMembers (before: AccountUuid[], txes: Tx[]): AccountUuid[] {
  let members = [...before]
  for (const tx of txes) {
    if (tx._class !== core.class.TxUpdateDoc) continue
    const ops = (tx as TxUpdateDoc<Space>).operations as Record<string, any>
    const values = (v: any): AccountUuid[] =>
      v === undefined ? [] : typeof v === 'string' ? [v as AccountUuid] : (v.$each ?? v.$in ?? [])
    members = [...members, ...values(ops.$push?.members)]
    const pulled = new Set(values(ops.$pull?.members))
    members = members.filter((it) => !pulled.has(it))
  }
  return members.sort()
}

const update = (operations: Record<string, any>, _class = CHANNEL): Tx =>
  factory.createTxUpdateDoc(_class, core.space.Space, 'space-1' as Ref<Space>, operations as any)

describe('OnSpaceMembershipChange', () => {
  it('adds members of a bound group', async () => {
    const stored = space({ members: [A], directMembers: [A], groups: ['g1' as Ref<UserGroup>] })
    const control = createControl([stored], [group('g1', [G1, A])])
    const res = await OnSpaceMembershipChange([update({ $push: { groups: 'g1' } })], control)
    expect(applyMembers(stored.members, res)).toEqual([A, G1].sort())
  })

  it('keeps a member that is still given by a group or directly', async () => {
    // A left directMembers but stays through g1; G2 left g2 binding and is removed.
    const stored = space({
      members: [A, B, G1, G2],
      directMembers: [B],
      groups: ['g1' as Ref<UserGroup>]
    })
    const control = createControl([stored], [group('g1', [A, G1]), group('g2', [G2])])
    const res = await OnSpaceMembershipChange([update({ $pull: { groups: 'g2' } })], control)
    expect(applyMembers(stored.members, res)).toEqual([A, B, G1].sort())
  })

  it('removes a direct member without other basis', async () => {
    const stored = space({ members: [A, B], directMembers: [A] })
    const control = createControl([stored], [])
    const res = await OnSpaceMembershipChange([update({ $pull: { directMembers: B } })], control)
    expect(applyMembers(stored.members, res)).toEqual([A])
  })

  it('recomputes a space only once for multiple source updates', async () => {
    const stored = space({ members: [A], directMembers: [A, B], groups: ['g1' as Ref<UserGroup>] })
    const control = createControl([stored], [group('g1', [G1])])
    const res = await OnSpaceMembershipChange([
      update({ directMembers: [A, B] }),
      update({ groups: ['g1'] })
    ], control)
    expect(applyMembers(stored.members, res)).toEqual([A, B, G1].sort())
  })

  it('recomputes a space once when its sources and a group change together', async () => {
    const stored = space({ members: [A], directMembers: [A, B], groups: ['g1' as Ref<UserGroup>] })
    const control = createControl([stored], [group('g1', [G1])])
    const changedGroup = factory.createTxUpdateDoc(core.class.UserGroup, core.space.Workspace, 'g1' as Ref<UserGroup>, {
      members: [G1]
    })
    const res = await OnSpaceMembershipChange([update({ directMembers: [A, B] }), changedGroup], control)
    expect(applyMembers(stored.members, res)).toEqual([A, B, G1].sort())
  })

  it('recomputes when groups are unset', async () => {
    const stored = space({ members: [A, G1], directMembers: [A] })
    const res = await OnSpaceMembershipChange([update({ $unset: { groups: true } })], createControl([stored], []))
    expect(applyMembers(stored.members, res)).toEqual([A])
  })

  it('does nothing when members already match', async () => {
    const stored = space({ members: [A, G1], directMembers: [A], groups: ['g1' as Ref<UserGroup>] })
    const control = createControl([stored], [group('g1', [G1])])
    expect(await OnSpaceMembershipChange([update({ $push: { directMembers: A } })], control)).toEqual([])
  })

  it('ignores updates of members itself and of other fields', async () => {
    const stored = space({ members: [A, B], directMembers: [A] })
    const control = createControl([stored], [])
    const res = await OnSpaceMembershipChange([update({ $push: { members: B } }), update({ name: 'renamed' })], control)
    expect(res).toEqual([])
  })

  it('fills directMembers of a space created without them', async () => {
    const control = createControl([], [])
    const create = factory.createTxCreateDoc(CHANNEL, core.space.Space, { name: 'c', members: [A, B] } as any)
    const res = await OnSpaceMembershipChange([create], control)
    expect(res).toHaveLength(1)
    expect((res[0] as TxUpdateDoc<Space>).operations).toEqual({ directMembers: [A, B] })
  })

  it('recomputes a space created with groups', async () => {
    const stored = space({ members: [A], directMembers: [A], groups: ['g1' as Ref<UserGroup>] })
    const control = createControl([stored], [group('g1', [G1])])
    const create = factory.createTxCreateDoc(
      CHANNEL,
      core.space.Space,
      { name: 'c', members: [A], directMembers: [A], groups: ['g1'] } as any,
      'space-1' as Ref<Space>
    )
    const res = await OnSpaceMembershipChange([create], control)
    expect(applyMembers(stored.members, res)).toEqual([A, G1].sort())
  })

  it('removes accounts that left the space from its roles', async () => {
    const stored = space({
      _class: PROJECT,
      type: PROJECT_TYPE,
      members: [A, B, G1],
      directMembers: [A, B],
      groups: [],
      [PROJECT_MIXIN]: { [ROLE]: [A, G1], [OTHER_ROLE]: [B] }
    })
    const control = createControl([stored], [])
    const res = await OnSpaceMembershipChange([update({ $pull: { groups: 'g1' } }, PROJECT)], control)
    expect(applyMembers(stored.members, res)).toEqual([A, B].sort())
    const mixin = res.find((it) => it._class === core.class.TxMixin) as TxMixin<Doc, Doc>
    expect(mixin.mixin).toBe(PROJECT_MIXIN)
    expect(mixin.attributes).toEqual({ [ROLE]: [A], [OTHER_ROLE]: [B] })
  })
})

describe('OnUserGroupChange', () => {
  it('recomputes every space bound to a changed group', async () => {
    const s1 = space({
      _id: 's1' as Ref<Space>,
      members: [A, G1],
      directMembers: [A],
      groups: ['g1' as Ref<UserGroup>]
    })
    const s2 = space({ _id: 's2' as Ref<Space>, members: [G1], directMembers: [], groups: ['g1' as Ref<UserGroup>] })
    const other = space({ _id: 's3' as Ref<Space>, members: [B], directMembers: [B] })
    // G1 was replaced by G2 in the group.
    const control = createControl([s1, s2, other], [group('g1', [G2])])
    const tx = factory.createTxUpdateDoc(core.class.UserGroup, core.space.Workspace, 'g1' as Ref<UserGroup>, {
      members: [G2]
    })
    const res = await OnUserGroupChange([tx], control)
    expect(
      applyMembers(
        s1.members,
        res.filter((it) => (it as TxUpdateDoc<Space>).objectId === 's1')
      )
    ).toEqual([A, G2].sort())
    expect(
      applyMembers(
        s2.members,
        res.filter((it) => (it as TxUpdateDoc<Space>).objectId === 's2')
      )
    ).toEqual([G2])
    expect(res.some((it) => (it as TxUpdateDoc<Space>).objectId === 's3')).toBe(false)
  })

  it('recomputes shared spaces once when two groups change in a batch', async () => {
    const stored = space({ members: [A], directMembers: [A], groups: ['g1', 'g2'] as Array<Ref<UserGroup>> })
    const control = createControl([stored], [group('g1', [G1]), group('g2', [G2])])
    const txes = ['g1', 'g2'].map((id) => factory.createTxUpdateDoc(
      core.class.UserGroup, core.space.Workspace, id as Ref<UserGroup>, { members: [G1, G2] }
    ))
    const res = await OnUserGroupChange(txes, control)
    expect(applyMembers(stored.members, res)).toEqual([A, G1, G2].sort())
  })

  it('combines group deletion and membership changes for a shared space', async () => {
    const stored = space({ members: [A, G1], directMembers: [A], groups: ['g1', 'g2'] as Array<Ref<UserGroup>> })
    const control = createControl([stored], [group('g2', [G2])])
    const txes = [
      factory.createTxRemoveDoc(core.class.UserGroup, core.space.Workspace, 'g1' as Ref<UserGroup>),
      factory.createTxUpdateDoc(core.class.UserGroup, core.space.Workspace, 'g2' as Ref<UserGroup>, { members: [G2] })
    ]
    const res = await OnUserGroupChange(txes, control)
    expect(applyMembers(stored.members, res)).toEqual([A, G2].sort())
    expect((res[0] as TxUpdateDoc<Space>).operations).toEqual({ $pull: { groups: 'g1' } })
  })

  it('recomputes once when multiple bound groups are deleted', async () => {
    const stored = space({ members: [A, G1, G2], directMembers: [A], groups: ['g1', 'g2'] as Array<Ref<UserGroup>> })
    const control = createControl([stored], [])
    const txes = ['g1', 'g2'].map((id) =>
      factory.createTxRemoveDoc(core.class.UserGroup, core.space.Workspace, id as Ref<UserGroup>)
    )
    const res = await OnUserGroupChange(txes, control)
    expect(res).toHaveLength(3)
    expect(applyMembers(stored.members, res)).toEqual([A])
  })

  it('revokes group membership when the group members are unset', async () => {
    const stored = space({ members: [A, G1], directMembers: [A], groups: ['g1'] as Array<Ref<UserGroup>> })
    const tx = factory.createTxUpdateDoc(core.class.UserGroup, core.space.Workspace, 'g1' as Ref<UserGroup>, {
      $unset: { members: true }
    })
    const res = await OnUserGroupChange([tx], createControl([stored], [group('g1', [])]))
    expect(applyMembers(stored.members, res)).toEqual([A])
  })

  it('ignores group updates that do not touch members', async () => {
    const s1 = space({ members: [G1], directMembers: [], groups: ['g1' as Ref<UserGroup>] })
    const control = createControl([s1], [group('g1', [])])
    const tx = factory.createTxUpdateDoc(core.class.UserGroup, core.space.Workspace, 'g1' as Ref<UserGroup>, {
      name: 'renamed'
    })
    expect(await OnUserGroupChange([tx], control)).toEqual([])
  })

  it('unbinds a removed group from its spaces', async () => {
    const s1 = space({ members: [G1], directMembers: [], groups: ['g1' as Ref<UserGroup>] })
    const control = createControl([s1], [])
    const tx = factory.createTxRemoveDoc(core.class.UserGroup, core.space.Workspace, 'g1' as Ref<UserGroup>)
    const res = await OnUserGroupChange([tx], control)
    expect(res).toHaveLength(2)
    expect((res[0] as TxUpdateDoc<Space>).operations).toEqual({ $pull: { groups: 'g1' } })
    expect(applyMembers(s1.members, res)).toEqual([])
  })
})
