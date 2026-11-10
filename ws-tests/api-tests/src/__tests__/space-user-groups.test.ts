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

/**
 * User groups of spaces against a live server.
 *
 * `Space.members` = unique(directMembers ∪ members of the bound groups) and is computed by the server: writes of
 * `members` change `directMembers`, binding groups and changing their members recompute `members` of every bound
 * space in the same operation. Only workspace maintainers and owners manage groups; guests do not see them.
 *
 * Needs a maintainer in api-tests: user2 (see ws-tests/prepare.sh, `set-user-role user2 api-tests MAINTAINER`).
 * Probe spaces and access helpers: `../spaceAccess.ts`.
 */

import { loadServerConfig, type ServerConfig } from '@hcengineering/api-client'
import { type AccountClient, getClient as getAccountClient } from '@hcengineering/account-client'
import chunter, { type Channel } from '@hcengineering/chunter'
import core, {
  type AccountUuid,
  AccountRole,
  generateId,
  MeasureMetricsContext,
  readOnlyGuestAccountUuid,
  type Ref,
  type UserGroup
} from '@hcengineering/core'
import { type Actor, joinNewAccount, loginActor, SERVER_URL, SpaceProbe, TIMEOUT } from '../spaceAccess'

const MAINTAINER = 'user2'

describe('space-user-groups', () => {
  const testCtx = new MeasureMetricsContext('space-user-groups', {})
  let config: ServerConfig
  let maintainerAccountClient: AccountClient
  let probe: SpaceProbe

  let maintainer: Actor
  let member: Actor
  let other: Actor
  let guest: Actor

  const createdGroups: Array<Ref<UserGroup>> = []

  beforeAll(async () => {
    config = await loadServerConfig(SERVER_URL)
    maintainer = await loginActor(config, MAINTAINER)
    if (maintainer.ws.info.role !== AccountRole.Maintainer && maintainer.ws.info.role !== AccountRole.Owner) {
      throw new Error(
        `${MAINTAINER} must be a maintainer of api-tests, got ${maintainer.ws.info.role}: ` +
          `run ./tool.sh set-user-role ${MAINTAINER} api-tests MAINTAINER`
      )
    }
    maintainerAccountClient = getAccountClient(config.ACCOUNTS_URL, maintainer.ws.token)
    probe = new SpaceProbe(maintainer)

    member = await joinNewAccount(testCtx, config, maintainerAccountClient, 'group-member', AccountRole.User)
    other = await joinNewAccount(testCtx, config, maintainerAccountClient, 'group-other', AccountRole.User)
    guest = await joinNewAccount(testCtx, config, maintainerAccountClient, 'group-guest', AccountRole.Guest)
  }, TIMEOUT * 2)

  afterAll(async () => {
    for (const group of createdGroups) {
      const doc = await maintainer.ops.findOne(core.class.UserGroup, { _id: group })
      if (doc !== undefined) await maintainer.ops.remove(doc)
    }
  }, TIMEOUT)

  // ---------------------------------------------------------------- helpers

  async function createGroup (members: AccountUuid[]): Promise<Ref<UserGroup>> {
    const id = await maintainer.ops.createDoc(core.class.UserGroup, core.space.Workspace, {
      name: `group-${generateId()}`,
      members
    })
    createdGroups.push(id)
    return id
  }

  async function getGroup (group: Ref<UserGroup>): Promise<UserGroup> {
    const doc = await maintainer.ops.findOne(core.class.UserGroup, { _id: group })
    if (doc === undefined) throw new Error(`Group ${group} not found`)
    return doc
  }

  async function bind (space: Ref<Channel>, group: Ref<UserGroup>): Promise<void> {
    await maintainer.ops.update(await probe.getChannel(space), { $push: { groups: group } })
  }

  async function unbind (space: Ref<Channel>, group: Ref<UserGroup>): Promise<void> {
    await maintainer.ops.update(await probe.getChannel(space), { $pull: { groups: group } })
  }

  async function expectAccess (
    space: Ref<Channel>,
    access: Partial<Record<'member' | 'other' | 'guest', boolean>>
  ): Promise<void> {
    await probe.expectAccess(space, { member, other, guest }, access)
  }

  // ---------------------------------------------------------------- binding

  it(
    'a bound group gives its members access, unbinding takes it away',
    async () => {
      const space = await probe.createChannel([maintainer.account])
      const group = await createGroup([member.account, guest.account])
      await expectAccess(space, { member: false, guest: false })

      await bind(space, group)
      await probe.expectMembers(space, [maintainer.account, member.account, guest.account])
      await probe.expectDirectMembers(space, [maintainer.account])
      await expectAccess(space, { member: true, other: false, guest: true })

      await unbind(space, group)
      await probe.expectMembers(space, [maintainer.account])
      await probe.expectDirectMembers(space, [maintainer.account])
      await expectAccess(space, { member: false, guest: false })
    },
    TIMEOUT
  )

  it(
    'a space created with groups gets their members',
    async () => {
      const group = await createGroup([member.account])
      const space = await probe.createChannel([maintainer.account], { groups: [group] })

      await probe.expectMembers(space, [maintainer.account, member.account])
      await probe.expectDirectMembers(space, [maintainer.account])
      await expectAccess(space, { member: true, other: false })
    },
    TIMEOUT
  )

  // ---------------------------------------------------------------- group changes

  it(
    'a change of group members follows in every bound space',
    async () => {
      const group = await createGroup([member.account])
      const first = await probe.createChannel([maintainer.account])
      const second = await probe.createChannel([maintainer.account])
      await bind(first, group)
      await bind(second, group)

      await maintainer.ops.update(await getGroup(group), { $push: { members: guest.account } })
      for (const space of [first, second]) {
        await probe.expectMembers(space, [maintainer.account, member.account, guest.account])
        await expectAccess(space, { member: true, guest: true })
      }

      await maintainer.ops.update(await getGroup(group), { $pull: { members: member.account } })
      for (const space of [first, second]) {
        await probe.expectMembers(space, [maintainer.account, guest.account])
        await expectAccess(space, { member: false, guest: true })
      }

      // A full replacement of the group members.
      await maintainer.ops.update(await getGroup(group), { members: [other.account] })
      for (const space of [first, second]) {
        await probe.expectMembers(space, [maintainer.account, other.account])
        await expectAccess(space, { member: false, other: true, guest: false })
      }
    },
    TIMEOUT
  )

  it(
    'deleting a group unbinds it and takes its access away',
    async () => {
      const group = await createGroup([member.account])
      const space = await probe.createChannel([maintainer.account])
      await bind(space, group)
      await expectAccess(space, { member: true })

      await maintainer.ops.remove(await getGroup(group))
      expect((await probe.storedSpace(space)).groups ?? []).not.toContain(group)
      await probe.expectMembers(space, [maintainer.account])
      await expectAccess(space, { member: false })
    },
    TIMEOUT
  )

  it(
    'two groups with the same account: access stays until the last one is unbound',
    async () => {
      const first = await createGroup([member.account])
      const second = await createGroup([member.account, other.account])
      const space = await probe.createChannel([maintainer.account], { groups: [first, second] })
      await probe.expectMembers(space, [maintainer.account, member.account, other.account])

      await unbind(space, second)
      await probe.expectMembers(space, [maintainer.account, member.account])
      await expectAccess(space, { member: true, other: false })

      await unbind(space, first)
      await probe.expectMembers(space, [maintainer.account])
      await expectAccess(space, { member: false })
    },
    TIMEOUT
  )

  // ---------------------------------------------------------------- direct and group membership together

  it(
    'removing a direct member keeps the access a group gives',
    async () => {
      const group = await createGroup([member.account])
      const space = await probe.createChannel([maintainer.account, member.account], { groups: [group] })
      await probe.expectDirectMembers(space, [maintainer.account, member.account])

      // An old style write of members: the middleware turns it into a change of directMembers.
      await maintainer.ops.update(await probe.getChannel(space), { $pull: { members: member.account } })
      await probe.expectDirectMembers(space, [maintainer.account])
      await probe.expectMembers(space, [maintainer.account, member.account])
      await expectAccess(space, { member: true })

      await unbind(space, group)
      await probe.expectMembers(space, [maintainer.account])
      await expectAccess(space, { member: false })
    },
    TIMEOUT
  )

  it(
    'removing an account from the group keeps its direct access',
    async () => {
      const group = await createGroup([member.account])
      const space = await probe.createChannel([maintainer.account, member.account], { groups: [group] })

      await maintainer.ops.update(await getGroup(group), { $pull: { members: member.account } })
      await probe.expectMembers(space, [maintainer.account, member.account])
      await expectAccess(space, { member: true })
    },
    TIMEOUT
  )

  it(
    'a full replacement of members changes direct members only',
    async () => {
      const group = await createGroup([member.account])
      const space = await probe.createChannel([maintainer.account], { groups: [group] })

      // The list a client sends without the group member: the group member stays.
      await maintainer.ops.update(await probe.getChannel(space), { members: [maintainer.account, other.account] })
      await probe.expectDirectMembers(space, [maintainer.account, other.account])
      await probe.expectMembers(space, [maintainer.account, member.account, other.account])
      await expectAccess(space, { member: true, other: true })
    },
    TIMEOUT
  )

  it(
    'a whole directMembers list makes a group member a direct one',
    async () => {
      const group = await createGroup([member.account])
      const space = await probe.createChannel([maintainer.account], { groups: [group] })

      // The space settings form writes directMembers: member is already a member through the group.
      await maintainer.ops.update(await probe.getChannel(space), {
        directMembers: [maintainer.account, member.account]
      })
      await probe.expectDirectMembers(space, [maintainer.account, member.account])

      await unbind(space, group)
      await probe.expectMembers(space, [maintainer.account, member.account])
      await expectAccess(space, { member: true })
    },
    TIMEOUT
  )

  it(
    'leaving a space keeps the membership a group gives',
    async () => {
      const group = await createGroup([member.account])
      const space = await probe.createChannel([maintainer.account, member.account], {
        private: false,
        groups: [group]
      })
      const asMember = await member.ops.findOne(chunter.class.Channel, { _id: space })
      expect(asMember).toBeDefined()
      if (asMember === undefined) return

      await member.ops.update(asMember, { $pull: { members: member.account } })
      await probe.expectDirectMembers(space, [maintainer.account])
      await probe.expectMembers(space, [maintainer.account, member.account])
    },
    TIMEOUT
  )

  // ---------------------------------------------------------------- who manages groups

  it(
    'a user can not create, change or bind groups',
    async () => {
      const group = await createGroup([member.account])

      await expect(
        member.ops.createDoc(core.class.UserGroup, core.space.Workspace, { name: 'by user', members: [member.account] })
      ).rejects.toThrow()
      await expect(
        member.ops.updateDoc(core.class.UserGroup, core.space.Workspace, group, { $push: { members: other.account } })
      ).rejects.toThrow()
      expect((await getGroup(group)).members).toEqual([member.account])

      // Not even to a space the user owns.
      const own = await member.ops.createDoc(chunter.class.Channel, core.space.Space, {
        name: `own-${generateId()}`,
        description: '',
        topic: '',
        private: true,
        archived: false,
        members: [member.account],
        owners: [member.account]
      })
      const asOwner = await member.ops.findOne(chunter.class.Channel, { _id: own })
      expect(asOwner).toBeDefined()
      if (asOwner === undefined) return
      await expect(member.ops.update(asOwner, { $push: { groups: group } })).rejects.toThrow()
      await expect(member.ops.update(asOwner, { groups: [group] })).rejects.toThrow()
      const stored = await member.ops.findOne(chunter.class.Channel, { _id: own })
      expect(stored?.groups ?? []).toEqual([])
    },
    TIMEOUT
  )

  it(
    'the anonymous guest can not be a group member',
    async () => {
      await expect(
        maintainer.ops.createDoc(core.class.UserGroup, core.space.Workspace, {
          name: `anonymous-${generateId()}`,
          members: [readOnlyGuestAccountUuid]
        })
      ).rejects.toThrow()

      const group = await createGroup([member.account])
      await expect(
        maintainer.ops.update(await getGroup(group), { $push: { members: readOnlyGuestAccountUuid } })
      ).rejects.toThrow()
      expect((await getGroup(group)).members).toEqual([member.account])
    },
    TIMEOUT
  )

  // ---------------------------------------------------------------- guests

  it(
    'a guest does not see groups, also the ones it is a member of',
    async () => {
      const group = await createGroup([guest.account])
      const space = await probe.createChannel([maintainer.account], { groups: [group] })
      await expectAccess(space, { guest: true })

      expect(await guest.rest.findAll(core.class.UserGroup, {})).toHaveLength(0)
      expect(await guest.rest.findAll(core.class.UserGroup, { _id: group })).toHaveLength(0)
      expect(await member.rest.findAll(core.class.UserGroup, { _id: group })).toHaveLength(1)
    },
    TIMEOUT
  )
})
