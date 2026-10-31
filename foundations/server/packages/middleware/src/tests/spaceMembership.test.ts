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

async function setup (stored: Doc[] = [], found: Doc[] = []): Promise<Setup> {
  const sent: Tx[] = []
  const next = {
    tx: async (_ctx: MeasureContext, txes: Tx[]) => {
      sent.push(...txes)
      return {}
    },
    findAll: async (_ctx: MeasureContext, _class: Ref<Class<Doc>>, query: any) =>
      toFindResult(query._id !== undefined ? stored.filter((it) => it._id === query._id) : found),
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

const storedSpace = (members: AccountUuid[], directMembers?: AccountUuid[]): Doc =>
  ({ _id: SPACE_ID, _class: CHANNEL, members, directMembers }) as unknown as Doc

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
      expect(opsOf(sent[0])).toEqual({ name: 'renamed', $push: { owners: A, directMembers: A } })
    })

    it('full replacement: removed accounts leave directMembers, group members are not made direct', async () => {
      // G is a member through a group only.
      const { middleware, sent } = await setup([storedSpace([A, B, G], [A, B])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ members: [A, G, C] })])
      expect(opsOf(sent[0])).toEqual({ directMembers: [A, C] })
    })

    it('full replacement that drops a group member keeps directMembers', async () => {
      const { middleware, sent } = await setup([storedSpace([A, G], [A])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ members: [A] })])
      expect(opsOf(sent[0])).toEqual({ directMembers: [A] })
    })

    it('full replacement of a space not migrated yet starts from members', async () => {
      const { middleware, sent } = await setup([storedSpace([A, B])])
      await middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ members: [B, C] })])
      expect(opsOf(sent[0])).toEqual({ directMembers: [B, C] })
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
      await expect(middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ $unset: { groups: true } })])).rejects.toThrow()
      await expect(middleware.tx(sessionCtx(AccountRole.User), [spaceUpdate({ 'groups.0': 'g1' })])).rejects.toThrow()
    })

    it('normalizes clearing bindings and membership sources to empty arrays', async () => {
      const { middleware, sent } = await setup([storedSpace([A, G], [A])])
      await middleware.tx(sessionCtx(AccountRole.Owner), [
        spaceUpdate({ $unset: { groups: true } }),
        spaceUpdate({ $unset: { directMembers: true } }),
        spaceUpdate({ $unset: { members: true } })
      ])
      expect(sent.map(opsOf)).toEqual([{ groups: [] }, { directMembers: [] }, { directMembers: [] }])
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
      const dotted = factory.createTxUpdateDoc(core.class.UserGroup, core.space.Workspace, 'g1' as Ref<Doc>, dottedOperations)
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
