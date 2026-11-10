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
  type Account,
  AccountRole,
  type AccountUuid,
  type Class,
  type Doc,
  type MeasureContext,
  MeasureMetricsContext,
  readOnlyGuestAccountUuid,
  type Ref,
  type SessionData,
  type Space,
  toFindResult,
  type Tx,
  type TxCreateDoc,
  TxFactory,
  type TxUpdateDoc
} from '@hcengineering/core'
import type { Middleware, PipelineContext } from '@hcengineering/server-core'
import { SpaceMembershipMiddleware } from '../spaceMembership'

const CHANNEL = 'chunter:class:Channel' as Ref<Class<Space>>
const PROJECT = 'tracker:class:Project' as Ref<Class<Space>>
const PERSON_SPACE = 'contact:class:PersonSpace' as Ref<Class<Space>>
const DISCUSSION = 'chunter:class:Discussion' as Ref<Class<Doc>>
const SPACE_ID = 'space-1' as Ref<Space>

const A = 'acc-a' as AccountUuid
const B = 'acc-b' as AccountUuid
const C = 'acc-c' as AccountUuid
const G = 'acc-group' as AccountUuid

const ancestors: Record<string, string[]> = {
  [CHANNEL]: [CHANNEL, core.class.Space],
  [PROJECT]: [PROJECT, core.class.TypedSpace, core.class.Space],
  [PERSON_SPACE]: [PERSON_SPACE, core.class.Space],
  [core.class.UserGroup]: [core.class.UserGroup],
  [DISCUSSION]: [DISCUSSION]
}

const factory = new TxFactory(core.account.System)

function sessionCtx (role: AccountRole, extra: Partial<SessionData> = {}): MeasureContext<SessionData> {
  const ctx = new MeasureMetricsContext('test', {}) as unknown as MeasureContext<SessionData>
  ;(ctx as any).contextData = {
    account: { uuid: 'acc-session', role, primarySocialId: 'social-session' } as unknown as Account,
    broadcast: { txes: [], targets: {}, queue: [], sessions: {} },
    socialStringsToUsers: new Map([
      ['s-user', { accontUuid: A, role: AccountRole.User }],
      ['s-guest', { accontUuid: G, role: AccountRole.Guest }]
    ]),
    ...extra
  }
  return ctx
}

interface Setup {
  middleware: SpaceMembershipMiddleware
  sent: Tx[]
}

/**
 * `stored`: documents found by `_id` (spaces and groups) and by group binding; `found`: the result of other queries.
 */
async function setup (stored: Doc[] = [], found: Doc[] = []): Promise<Setup> {
  const sent: Tx[] = []
  const next = {
    tx: async (_ctx: MeasureContext, txes: Tx[]) => {
      sent.push(...txes)
      return {}
    },
    findAll: async (_ctx: MeasureContext, _class: Ref<Class<Doc>>, query: any) => {
      if (typeof query._id === 'string') return toFindResult(stored.filter((it) => it._id === query._id))
      if (query._id?.$in !== undefined) return toFindResult(stored.filter((it) => query._id.$in.includes(it._id)))
      if (query.groups !== undefined) {
        return toFindResult(stored.filter((it) => ((it as any).groups ?? []).includes(query.groups)))
      }
      return toFindResult(found)
    },
    handleBroadcast: async () => {}
  } as unknown as Middleware
  const context = {
    hierarchy: {
      isDerived: (_class: string, base: string) => (ancestors[_class] ?? [_class]).includes(base)
    }
  } as unknown as PipelineContext
  const middleware = await SpaceMembershipMiddleware.create(new MeasureMetricsContext('test', {}), context, next)
  return { middleware, sent }
}

function spaceUpdate (operations: Record<string, any>, _class = CHANNEL): TxUpdateDoc<Space> {
  return factory.createTxUpdateDoc(_class, core.space.Space, SPACE_ID, operations as any)
}

function opsOf (tx: Tx): Record<string, any> {
  return (tx as TxUpdateDoc<Space>).operations as Record<string, any>
}

const GROUP_ID = 'group-1'

/** A stored space; `groups` defaults to the group with G when G is a member that is not direct. */
const storedSpace = (members: AccountUuid[], directMembers?: AccountUuid[], groups?: string[]): Doc =>
  ({
    _id: SPACE_ID,
    _class: CHANNEL,
    members,
    directMembers,
    groups: groups ?? (members.includes(G) && directMembers?.includes(G) !== true ? [GROUP_ID] : [])
  }) as unknown as Doc

const storedGroup = (members: AccountUuid[], _id = GROUP_ID): Doc =>
  ({ _id, _class: core.class.UserGroup, name: _id, members }) as unknown as Doc

describe('SpaceMembershipMiddleware', () => {
  describe('members writes become directMembers writes', () => {
    it('$push of one account', async () => {
      const { middleware, sent } = await setup()
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ $push: { members: A } })])
      expect(opsOf(sent[0])).toEqual({ $push: { directMembers: A } })
    })

    it('$push $each and $pull $in', async () => {
      const { middleware, sent } = await setup()
      await middleware.tx(sessionCtx(AccountRole.User), [
        spaceUpdate({ $push: { members: { $each: [A, B], $position: 0 } } }),
        spaceUpdate({ $pull: { members: { $in: [A, B] } } })
      ])
      expect(opsOf(sent[0])).toEqual({ $push: { directMembers: { $each: [A, B], $position: 0 } } })
      expect(opsOf(sent[1])).toEqual({ $pull: { directMembers: { $in: [A, B] } } })
    })

    it('keeps other operations of the update', async () => {
      const { middleware, sent } = await setup()
      await middleware.tx(sessionCtx(AccountRole.User), [
        spaceUpdate({ name: 'renamed', $push: { members: A, owners: A } })
      ])
      // No stored space to resolve against: the update keeps its operators.
      expect(opsOf(sent[0])).toEqual({ name: 'renamed', $push: { owners: A, directMembers: A } })
    })

    it('full replacement: removed accounts leave directMembers, group members are not made direct', async () => {
      // G is a member through a group only.
      const { middleware, sent } = await setup([storedSpace([A, B, G], [A, B]), storedGroup([G])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ members: [A, G, C] })])
      expect(opsOf(sent[0])).toEqual({ directMembers: [A, C], members: [A, C, G] })
    })

    it('full replacement that drops a group member keeps it a member', async () => {
      const { middleware, sent } = await setup([storedSpace([A, G], [A]), storedGroup([G])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ members: [A] })])
      expect(opsOf(sent[0])).toEqual({ directMembers: [A] })
    })

    it('full replacement of a space not migrated yet starts from members', async () => {
      const { middleware, sent } = await setup([storedSpace([A, B])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ members: [B, C] })])
      expect(opsOf(sent[0])).toEqual({ directMembers: [B, C], members: [B, C] })
    })

    it('a $push on a space without directMembers writes the whole list from members', async () => {
      // A blind $push would start directMembers from C only and the recompute would drop A and B.
      const { middleware, sent } = await setup([storedSpace([A, B])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ $push: { members: C } })])
      expect(opsOf(sent[0])).toEqual({ directMembers: [A, B, C], members: [A, B, C] })
    })

    it('a direct $pull of directMembers on a space without them writes the whole list', async () => {
      const { middleware, sent } = await setup([storedSpace([A, B])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ $pull: { directMembers: B } })])
      expect(opsOf(sent[0])).toEqual({ directMembers: [A], members: [A] })
    })

    it('a $push on a migrated space stays a $push and changes members in the same update', async () => {
      const { middleware, sent } = await setup([storedSpace([A, B, G], [A, B]), storedGroup([G])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ $push: { members: C } })])
      expect(opsOf(sent[0])).toEqual({ $push: { directMembers: C, members: C } })
    })

    it('a $pull revokes access in the same update', async () => {
      const { middleware, sent } = await setup([storedSpace([A, B], [A, B])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ $pull: { members: B } })])
      expect(opsOf(sent[0])).toEqual({ $pull: { directMembers: B, members: B } })
    })

    it('a $pull of a direct member that a group also gives keeps it in members', async () => {
      const { middleware, sent } = await setup([storedSpace([A, G], [A, G], [GROUP_ID]), storedGroup([G])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ $pull: { members: G } })])
      expect(opsOf(sent[0])).toEqual({ $pull: { directMembers: G } })
    })

    it('a whole directMembers list makes a member through a group a direct one', async () => {
      // The space settings form writes directMembers: G is already a member through a group.
      const { middleware, sent } = await setup([storedSpace([A, G], [A]), storedGroup([G])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ directMembers: [A, G, A] })])
      expect(opsOf(sent[0])).toEqual({ directMembers: [A, G] })
    })

    it('never mixes plain writes and operators in one update', async () => {
      // The storage applies an update with a plain field as plain writes and drops its operators (`isOperator`).
      const { middleware, sent } = await setup([storedSpace([A, B], [A, B]), storedGroup([G])])
      await middleware.tx(sessionCtx(AccountRole.Owner), [
        spaceUpdate({ directMembers: [A] }),
        spaceUpdate({ name: 'renamed', $pull: { members: B } }),
        spaceUpdate({ name: 'renamed', $push: { members: C, owners: C } }),
        spaceUpdate({ groups: [GROUP_ID] })
      ])
      for (const tx of sent) {
        const keys = Object.keys(opsOf(tx))
        expect(keys.every((key) => key.startsWith('$')) || keys.every((key) => !key.startsWith('$'))).toBe(true)
      }
      expect(opsOf(sent[0])).toEqual({ directMembers: [A], members: [A] })
      expect(opsOf(sent[1])).toEqual({ name: 'renamed', directMembers: [A], members: [A] })
      expect(opsOf(sent[2])).toEqual({ name: 'renamed', directMembers: [A, B, C], members: [A, B, C], owners: [C] })
      expect(opsOf(sent[3])).toEqual({ groups: [GROUP_ID], members: [A, B, G] })
    })

    it('rewrites updates inside apply', async () => {
      const { middleware, sent } = await setup()
      const apply = factory.createTxApplyIf(
        core.space.Tx,
        'scope',
        [],
        [],
        [spaceUpdate({ $pull: { members: B } })],
        'apply'
      )
      await middleware.tx(sessionCtx(AccountRole.User), [apply])
      expect(opsOf((sent[0] as any).txes[0])).toEqual({ $pull: { directMembers: B } })
    })

    it('leaves updates without members and documents that are not spaces alone', async () => {
      const { middleware, sent } = await setup()
      const discussion = factory.createTxUpdateDoc(
        DISCUSSION,
        core.space.Space,
        'd-1' as Ref<Doc>,
        {
          members: [A]
        } as any
      )
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ name: 'renamed' }), discussion])
      expect(opsOf(sent[0])).toEqual({ name: 'renamed' })
      expect(opsOf(sent[1])).toEqual({ members: [A] })
    })
  })

  describe('space creation', () => {
    it('copies members to directMembers', async () => {
      const { middleware, sent } = await setup()
      const create = factory.createTxCreateDoc(CHANNEL, core.space.Space, { name: 'c', members: [A, B] } as any)
      await middleware.tx(sessionCtx(AccountRole.User), [create])
      expect((sent[0] as TxCreateDoc<Space>).attributes).toMatchObject({ members: [A, B], directMembers: [A, B] })
    })

    it('keeps explicit directMembers', async () => {
      const { middleware, sent } = await setup()
      const create = factory.createTxCreateDoc(CHANNEL, core.space.Space, {
        name: 'c',
        members: [A, B],
        directMembers: [A]
      } as any)
      await middleware.tx(sessionCtx(AccountRole.User), [create])
      expect((sent[0] as TxCreateDoc<Space>).attributes.directMembers).toEqual([A])
    })
  })

  describe('groups binding and user groups', () => {
    const bind = (_class: Ref<Class<Space>>): Tx => spaceUpdate({ $push: { groups: 'group-1' } }, _class)

    it('a user can not bind groups', async () => {
      const { middleware } = await setup()
      await expect(middleware.tx(sessionCtx(AccountRole.User), [bind(PROJECT)])).rejects.toThrow()
    })

    it('a user can not unset or write nested group bindings', async () => {
      const { middleware } = await setup()
      await expect(
        middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ $unset: { groups: true } })])
      ).rejects.toThrow()
      await expect(middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ 'groups.0': 'g1' })])).rejects.toThrow()
    })

    it('normalizes clearing bindings and membership sources to empty arrays', async () => {
      // Each update is resolved against the same stored space: A direct, G through the group.
      const { middleware, sent } = await setup([storedSpace([A, G], [A]), storedGroup([G])])
      await middleware.tx(sessionCtx(AccountRole.Owner), [
        spaceUpdate({ $unset: { groups: true } }),
        spaceUpdate({ $unset: { directMembers: true } }),
        spaceUpdate({ $unset: { members: true } })
      ])
      expect(sent.map(opsOf)).toEqual([
        { groups: [], members: [A] },
        { directMembers: [], members: [G] },
        { directMembers: [], members: [G] }
      ])
    })

    it('rejects unsupported operators and nested writes of membership arrays', async () => {
      const { middleware } = await setup()
      for (const operations of [
        { 'members.0': A },
        { $update: { directMembers: { $query: A, $update: B } } },
        { $push: { 'groups.0': 'g1' } },
        { $unset: { 'groups.0': true } },
        { members: [], $unset: { members: true } }
      ]) {
        await expect(middleware.tx(sessionCtx(AccountRole.Owner), [spaceUpdate(operations)])).rejects.toThrow()
      }
    })

    it('normalizes clearing user group members and rejects dotted anonymous membership', async () => {
      const { middleware, sent } = await setup()
      const clear = factory.createTxUpdateDoc(core.class.UserGroup, core.space.Workspace, 'g1' as Ref<Doc>, {
        $unset: { members: true }
      })
      await middleware.tx(sessionCtx(AccountRole.Owner), [clear])
      expect(opsOf(sent[0])).toEqual({ members: [] })
      const dottedOperations: Record<string, unknown> = {
        'members.0': readOnlyGuestAccountUuid
      }
      const dotted = factory.createTxUpdateDoc(
        core.class.UserGroup,
        core.space.Workspace,
        'g1' as Ref<Doc>,
        dottedOperations
      )
      await expect(middleware.tx(sessionCtx(AccountRole.Owner), [dotted])).rejects.toThrow()
    })

    it('a maintainer binds groups to typed spaces and channels, not to other spaces', async () => {
      const { middleware, sent } = await setup()
      await middleware.tx(sessionCtx(AccountRole.Maintainer), [bind(PROJECT), bind(CHANNEL)])
      expect(sent).toHaveLength(2)
      await expect(middleware.tx(sessionCtx(AccountRole.Owner), [bind(PERSON_SPACE)])).rejects.toThrow()
    })

    it('only maintainers and owners manage groups', async () => {
      const { middleware, sent } = await setup()
      const create = (): Tx =>
        factory.createTxCreateDoc(core.class.UserGroup, core.space.Workspace, { name: 'g', members: [A] })
      await expect(middleware.tx(sessionCtx(AccountRole.User), [create()])).rejects.toThrow()
      await middleware.tx(sessionCtx(AccountRole.Maintainer), [create()])
      await middleware.tx(sessionCtx(AccountRole.Owner), [create()])
      expect(sent).toHaveLength(2)
    })

    it('a group can not hold the anonymous guest account', async () => {
      const { middleware } = await setup()
      const create = factory.createTxCreateDoc(core.class.UserGroup, core.space.Workspace, {
        name: 'g',
        members: [readOnlyGuestAccountUuid]
      })
      const push = factory.createTxUpdateDoc(core.class.UserGroup, core.space.Workspace, 'g-1' as any, {
        $push: { members: readOnlyGuestAccountUuid }
      })
      await expect(middleware.tx(sessionCtx(AccountRole.Owner), [create])).rejects.toThrow()
      await expect(middleware.tx(sessionCtx(AccountRole.Owner), [push])).rejects.toThrow()
    })
  })

  describe('members follow groups in the same operation', () => {
    const groupUpdate = (operations: Record<string, any>, _id = GROUP_ID): Tx =>
      factory.createTxUpdateDoc(core.class.UserGroup, core.space.Workspace, _id as Ref<Doc>, operations as any)

    it('binding a group adds its members in the same update', async () => {
      const { middleware, sent } = await setup([storedSpace([A], [A], []), storedGroup([G, B])])
      await middleware.tx(sessionCtx(AccountRole.Maintainer), [spaceUpdate({ $push: { groups: GROUP_ID } })])
      expect(opsOf(sent[0])).toEqual({ $push: { groups: GROUP_ID, members: { $each: [G, B], $position: 0 } } })
    })

    it('unbinding a group removes the members it gave, not the direct ones', async () => {
      const { middleware, sent } = await setup([storedSpace([A, G], [A], [GROUP_ID]), storedGroup([A, G])])
      await middleware.tx(sessionCtx(AccountRole.Maintainer), [spaceUpdate({ $pull: { groups: GROUP_ID } })])
      expect(opsOf(sent[0])).toEqual({ $pull: { groups: GROUP_ID, members: G } })
    })

    it('binding a group to a space that is not migrated persists its direct members', async () => {
      const { middleware, sent } = await setup([storedSpace([A], undefined, []), storedGroup([G])])
      await middleware.tx(sessionCtx(AccountRole.Maintainer), [spaceUpdate({ groups: [GROUP_ID] })])
      expect(opsOf(sent[0])).toEqual({ groups: [GROUP_ID], directMembers: [A], members: [A, G] })
    })

    it('a space created with groups gets their members', async () => {
      const { middleware, sent } = await setup([storedGroup([G])])
      const create = factory.createTxCreateDoc(CHANNEL, core.space.Space, {
        name: 'c',
        members: [A],
        groups: [GROUP_ID]
      } as any)
      await middleware.tx(sessionCtx(AccountRole.Maintainer), [create])
      expect((sent[0] as TxCreateDoc<Space>).attributes).toMatchObject({ members: [A, G], directMembers: [A] })
    })

    it('a group change leaves nothing to do when the spaces already follow it', async () => {
      // The recompute trigger ran in the same operation: the stored space matches the stored group.
      const { middleware, sent } = await setup([storedSpace([A, B], [A], [GROUP_ID]), storedGroup([B])])
      await middleware.tx(sessionCtx(AccountRole.Maintainer), [groupUpdate({ members: [B] })])
      expect(sent).toHaveLength(1)
    })

    it('a group change repairs spaces the recompute did not update', async () => {
      // The trigger failed: G left the group, but is still a member of the bound space; B joined it.
      const { middleware, sent } = await setup([storedSpace([A, G], [A], [GROUP_ID]), storedGroup([B])])
      await middleware.tx(sessionCtx(AccountRole.Maintainer), [groupUpdate({ $pull: { members: G } })])
      expect(sent).toHaveLength(2)
      expect((sent[1] as TxUpdateDoc<Space>).objectId).toBe(SPACE_ID)
      expect(opsOf(sent[1])).toEqual({ $push: { members: B }, $pull: { members: G } })
    })

    it('a removed group is unbound and its members leave', async () => {
      const { middleware, sent } = await setup([storedSpace([A, G], [A], [GROUP_ID])])
      const remove = factory.createTxRemoveDoc(core.class.UserGroup, core.space.Workspace, GROUP_ID as Ref<Doc>)
      await middleware.tx(sessionCtx(AccountRole.Maintainer), [remove])
      expect(opsOf(sent[1])).toEqual({ $pull: { members: G, groups: GROUP_ID } })
    })

    it('a rename of a group does not look at spaces', async () => {
      const { middleware, sent } = await setup([storedSpace([A, G], [A], [GROUP_ID])])
      await middleware.tx(sessionCtx(AccountRole.Maintainer), [groupUpdate({ name: 'renamed' })])
      expect(sent).toHaveLength(1)
    })
  })

  describe('guests and user groups', () => {
    const group = { _id: 'group-1', _class: core.class.UserGroup, name: 'g', members: [A] } as unknown as Doc
    const spaceWithLookup = {
      _id: SPACE_ID,
      _class: CHANNEL,
      $lookup: { groups: [group], createdBy: { _id: 'p-1', _class: 'contact:class:Person' } }
    } as unknown as Doc

    it('a guest does not read user groups', async () => {
      const { middleware } = await setup([], [group])
      expect(await middleware.findAll(sessionCtx(AccountRole.Guest), core.class.UserGroup, {})).toHaveLength(0)
      expect(await middleware.findAll(sessionCtx(AccountRole.User), core.class.UserGroup, {})).toHaveLength(1)
    })

    it('a guest gets lookups without user groups', async () => {
      const { middleware } = await setup([], [spaceWithLookup])
      const options = { lookup: { groups: core.class.UserGroup } } as any
      const [asGuest] = await middleware.findAll(sessionCtx(AccountRole.Guest), CHANNEL, {}, options)
      expect((asGuest as any).$lookup).toEqual({
        groups: [],
        createdBy: { _id: 'p-1', _class: 'contact:class:Person' }
      })
      const [asUser] = await middleware.findAll(sessionCtx(AccountRole.User), CHANNEL, {}, options)
      expect((asUser as any).$lookup.groups).toHaveLength(1)
    })

    it('a guest does not find user groups in full-text search', async () => {
      const { middleware } = await setup()
      const docs = [
        { id: 'group-1', doc: { _id: 'group-1', _class: core.class.UserGroup } },
        { id: 'c-1', doc: { _id: 'c-1', _class: CHANNEL } }
      ]
      ;(middleware as any).next.searchFulltext = async () => ({ docs, total: 2 })
      const asGuest = await middleware.searchFulltext(sessionCtx(AccountRole.Guest), { query: 'g' }, {})
      expect(asGuest.docs.map((it) => it.id)).toEqual(['c-1'])
      expect(asGuest.total).toBe(1)
      const asUser = await middleware.searchFulltext(sessionCtx(AccountRole.User), { query: 'g' }, {})
      expect(asUser.docs).toHaveLength(2)
    })

    it('user group transactions are not broadcast to guests', async () => {
      const { middleware } = await setup()
      const ctx = sessionCtx(AccountRole.Owner)
      await middleware.handleBroadcast(ctx)
      const target = ctx.contextData.broadcast.targets.userGroups
      const groupTx = factory.createTxCreateDoc(core.class.UserGroup, core.space.Workspace, { name: 'g', members: [] })
      expect(await target(groupTx)).toEqual({ exclude: [G] })
      expect(await target(spaceUpdate({ name: 'x' }))).toBeUndefined()
    })
  })
})
