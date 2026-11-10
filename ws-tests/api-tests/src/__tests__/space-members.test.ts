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
 * Characterization tests for Space.members.
 *
 * They pin the current contract of `members` (how every kind of write changes the stored list and
 * what a member / non-member can read afterwards) before user groups turn `members` into a
 * server-computed field. They must pass unchanged before and after that change.
 *
 * Probe space and access helpers: `../spaceAccess.ts`.
 */

import { getWorkspaceToken, loadServerConfig, type ServerConfig } from '@hcengineering/api-client'
import { type AccountClient, getClient as getAccountClient } from '@hcengineering/account-client'
import chunter, { type Channel } from '@hcengineering/chunter'
import { type AccountUuid, AccountRole, MeasureMetricsContext, type Ref, type Space } from '@hcengineering/core'
import {
  type Actor,
  joinNewAccount as joinAccount,
  PASSWORD,
  SERVER_URL,
  SpaceProbe,
  TIMEOUT,
  toActor,
  WS_NAME
} from '../spaceAccess'

describe('space-members', () => {
  const testCtx = new MeasureMetricsContext('space-members', {})
  let config: ServerConfig
  let ownerAccountClient: AccountClient
  let probe: SpaceProbe

  let owner: Actor
  let member: Actor
  let guest: Actor

  beforeAll(async () => {
    config = await loadServerConfig(SERVER_URL)
    const ownerWs = await getWorkspaceToken(
      SERVER_URL,
      { email: 'user1', password: PASSWORD, workspace: WS_NAME },
      config
    )
    ownerAccountClient = getAccountClient(config.ACCOUNTS_URL, ownerWs.token)
    owner = await toActor(ownerWs)
    probe = new SpaceProbe(owner)

    member = await joinNewAccount('member', AccountRole.User)
    guest = await joinNewAccount('guest', AccountRole.Guest)
  }, TIMEOUT)

  // ---------------------------------------------------------------- helpers

  async function joinNewAccount (prefix: string, role: AccountRole): Promise<Actor> {
    return await joinAccount(testCtx, config, ownerAccountClient, prefix, role)
  }

  async function createChannel (members: AccountUuid[], extra: Partial<Channel> = {}): Promise<Ref<Channel>> {
    return await probe.createChannel(members, extra)
  }

  async function storedMembers (space: Ref<Space>): Promise<AccountUuid[]> {
    return await probe.storedMembers(space)
  }

  async function expectMembers (space: Ref<Space>, expected: AccountUuid[]): Promise<void> {
    await probe.expectMembers(space, expected)
  }

  async function canRead (actor: Actor, space: Ref<Space>): Promise<boolean> {
    return await probe.canRead(actor, space)
  }

  async function expectAccess (space: Ref<Space>, access: { member: boolean, guest: boolean }): Promise<void> {
    await probe.expectAccess(space, { member, guest }, access)
  }

  async function getChannel (space: Ref<Channel>): Promise<Channel> {
    return await probe.getChannel(space)
  }

  // ---------------------------------------------------------------- writes by an admin

  it(
    'create with members grants access to them only',
    async () => {
      const space = await createChannel([owner.account, member.account])

      await expectMembers(space, [owner.account, member.account])
      await expectAccess(space, { member: true, guest: false })
      expect(await canRead(owner, space)).toBe(true)
    },
    TIMEOUT
  )

  it(
    '$push / $pull of a single account grants and revokes access',
    async () => {
      const space = await createChannel([owner.account])
      await expectAccess(space, { member: false, guest: false })

      await owner.ops.update(await getChannel(space), { $push: { members: member.account } })
      await expectMembers(space, [owner.account, member.account])
      await expectAccess(space, { member: true, guest: false })

      await owner.ops.update(await getChannel(space), { $pull: { members: member.account } })
      await expectMembers(space, [owner.account])
      await expectAccess(space, { member: false, guest: false })
    },
    TIMEOUT
  )

  it(
    '$push $each / $pull $in change several accounts at once',
    async () => {
      const space = await createChannel([owner.account])

      await owner.ops.update(await getChannel(space), {
        $push: { members: { $each: [member.account, guest.account], $position: 0 } }
      })
      await expectMembers(space, [owner.account, member.account, guest.account])
      await expectAccess(space, { member: true, guest: true })

      await owner.ops.update(await getChannel(space), {
        $pull: { members: { $in: [member.account, guest.account] } }
      })
      await expectMembers(space, [owner.account])
      await expectAccess(space, { member: false, guest: false })
    },
    TIMEOUT
  )

  it(
    'full replacement of members grants and revokes by diff',
    async () => {
      const space = await createChannel([owner.account, guest.account])
      await expectAccess(space, { member: false, guest: true })

      await owner.ops.update(await getChannel(space), { members: [owner.account, member.account] })
      await expectMembers(space, [owner.account, member.account])
      await expectAccess(space, { member: true, guest: false })

      await owner.ops.update(await getChannel(space), { members: [owner.account] })
      await expectMembers(space, [owner.account])
      await expectAccess(space, { member: false, guest: false })
    },
    TIMEOUT
  )

  it(
    'member changes inside apply() behave like direct updates',
    async () => {
      const space = await createChannel([owner.account])

      const add = owner.ops.apply(`members-add-${space}`)
      await add.update(await getChannel(space), { $push: { members: member.account } })
      await add.update(await getChannel(space), { $push: { members: guest.account } })
      expect((await add.commit()).result).toBe(true)
      await expectMembers(space, [owner.account, member.account, guest.account])
      await expectAccess(space, { member: true, guest: true })

      const remove = owner.ops.apply(`members-remove-${space}`)
      await remove.update(await getChannel(space), { $pull: { members: { $in: [member.account, guest.account] } } })
      expect((await remove.commit()).result).toBe(true)
      await expectMembers(space, [owner.account])
      await expectAccess(space, { member: false, guest: false })
    },
    TIMEOUT
  )

  it(
    'repeated $push does not duplicate an account and one $pull removes it',
    async () => {
      const space = await createChannel([owner.account, member.account])

      await owner.ops.update(await getChannel(space), { $push: { members: member.account } })
      const afterPush = await storedMembers(space)
      expect(afterPush.filter((it) => it === member.account).length).toBeGreaterThanOrEqual(1)

      await owner.ops.update(await getChannel(space), { $pull: { members: member.account } })
      await expectMembers(space, [owner.account])
      await expectAccess(space, { member: false, guest: false })
    },
    TIMEOUT
  )

  // ---------------------------------------------------------------- self join / leave

  it(
    'a user joins and leaves a public space by changing own membership',
    async () => {
      const space = await createChannel([owner.account], { private: false })
      const asMember = await member.ops.findOne(chunter.class.Channel, { _id: space })
      expect(asMember).toBeDefined()
      if (asMember === undefined) return

      await member.ops.update(asMember, { $push: { members: member.account } })
      await expectMembers(space, [owner.account, member.account])

      await member.ops.update(asMember, { $pull: { members: member.account } })
      await expectMembers(space, [owner.account])
    },
    TIMEOUT
  )

  // ---------------------------------------------------------------- guest restrictions

  it(
    'membership does not let a guest manage members',
    async () => {
      const space = await createChannel([owner.account, guest.account])
      const asGuest = await guest.ops.findOne(chunter.class.Channel, { _id: space })
      expect(asGuest).toBeDefined()
      if (asGuest === undefined) return

      await expect(guest.ops.update(asGuest, { $push: { members: member.account } })).rejects.toThrow()
      await expectMembers(space, [owner.account, guest.account])
      await expectAccess(space, { member: false, guest: true })
    },
    TIMEOUT
  )

  // ---------------------------------------------------------------- auto-join

  it(
    'autoJoin adds a new user, autoJoinForRoles adds a new guest',
    async () => {
      const forEveryone = await createChannel([owner.account], { private: false, autoJoin: true })
      const forGuests = await createChannel([owner.account], { autoJoinForRoles: [AccountRole.Guest] })

      const newUser = await joinNewAccount('autojoin-user', AccountRole.User)
      const newGuest = await joinNewAccount('autojoin-guest', AccountRole.Guest)

      // Users join autoJoin spaces only; guests join only spaces with auto-join for their role.
      expect(await storedMembers(forEveryone)).toEqual(expect.arrayContaining([newUser.account]))
      expect(await storedMembers(forEveryone)).not.toContain(newGuest.account)
      expect(await storedMembers(forGuests)).toEqual(expect.arrayContaining([newGuest.account]))
      expect(await storedMembers(forGuests)).not.toContain(newUser.account)

      expect(await canRead(newGuest, forGuests)).toBe(true)
      expect(await canRead(newUser, forGuests)).toBe(false)
    },
    TIMEOUT * 2
  )
})
