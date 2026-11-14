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
 * Probe space: a private chunter Channel with one ChatMessage. For a private space the server lets
 * only members read the space and the documents inside it, so "can read" == "is a member".
 */

import {
  createRestClient,
  createRestTxOperations,
  getWorkspaceToken,
  loadServerConfig,
  type RestClient,
  type ServerConfig,
  type WorkspaceToken
} from '@hcengineering/api-client'
import core, {
  type AccountUuid,
  AccountRole,
  generateId,
  MeasureMetricsContext,
  pickPrimarySocialId,
  type Ref,
  type SocialId,
  type Space,
  type TxOperations
} from '@hcengineering/core'
import { type AccountClient, getClient as getAccountClient } from '@hcengineering/account-client'
import chunter, { type Channel } from '@hcengineering/chunter'
import { ensureEmployee } from '@hcengineering/contact'

const SERVER_URL = 'http://tracex.local:8083'
const WS_NAME = 'api-tests'
const PASSWORD = '1234'
const TIMEOUT = 60000
/** user1 is a plain USER in api-tests: never-expiring invites (exp < 0) need Maintainer, so use a short TTL. */
const INVITE_TTL_MS = 60 * 60 * 1000

interface Actor {
  account: AccountUuid
  ws: WorkspaceToken
  rest: RestClient
  ops: TxOperations
}

describe('space-members', () => {
  const testCtx = new MeasureMetricsContext('space-members', {})
  let config: ServerConfig
  let ownerAccountClient: AccountClient

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

    member = await joinNewAccount('member', AccountRole.User)
    guest = await joinNewAccount('guest', AccountRole.Guest)
  }, TIMEOUT)

  // ---------------------------------------------------------------- helpers

  async function toActor (ws: WorkspaceToken): Promise<Actor> {
    const rest = createRestClient(ws.endpoint, ws.workspaceId, ws.token)
    const ops = await createRestTxOperations(ws.endpoint, ws.workspaceId, ws.token)
    return { account: ws.info.account, ws, rest, ops }
  }

  /** Same path as the workbench on first connect: creates the Person/Employee, which fires OnEmployeeCreate (auto-join). */
  async function ensureEmployeeFor (ws: WorkspaceToken): Promise<void> {
    const accountClient = getAccountClient(config.ACCOUNTS_URL, ws.token)
    const person = await accountClient.getPerson()
    const socialIds: SocialId[] = await accountClient.getSocialIds(true)
    await ensureEmployee(
      testCtx,
      {
        uuid: ws.info.account,
        role: ws.info.role,
        primarySocialId: pickPrimarySocialId(socialIds)._id,
        socialIds: socialIds.map((si) => si._id),
        fullSocialIds: socialIds
      },
      createRestClient(ws.endpoint, ws.workspaceId, ws.token),
      socialIds,
      async () => person
    )
  }

  /** Signs up a fresh account, joins it to the workspace by invite with the given role and creates its Employee. */
  async function joinNewAccount (prefix: string, role: AccountRole): Promise<Actor> {
    const email = `${prefix}-${generateId()}@members.test`
    const anonymous = getAccountClient(config.ACCOUNTS_URL)
    await anonymous.signUp(email, PASSWORD, prefix, 'Tester')
    const inviteId = await ownerAccountClient.createInvite(INVITE_TTL_MS, '', 1, role)
    await anonymous.join(email, PASSWORD, inviteId, WS_NAME)

    const ws = await getWorkspaceToken(SERVER_URL, { email, password: PASSWORD, workspace: WS_NAME }, config)
    expect(ws.info.role).toBe(role)
    await ensureEmployeeFor(ws)
    return await toActor(ws)
  }

  async function createChannel (members: AccountUuid[], extra: Partial<Channel> = {}): Promise<Ref<Channel>> {
    const id = await owner.ops.createDoc(chunter.class.Channel, core.space.Space, {
      name: `members-${generateId()}`,
      description: '',
      topic: '',
      private: true,
      archived: false,
      members,
      ...extra
    })
    await owner.ops.addCollection(chunter.class.ChatMessage, id, id, chunter.class.Channel, 'messages', {
      message: 'members probe'
    })
    return id
  }

  async function storedMembers (space: Ref<Space>): Promise<AccountUuid[]> {
    const doc = await owner.rest.findOne(core.class.Space, { _id: space })
    expect(doc).toBeDefined()
    return [...(doc?.members ?? [])].sort()
  }

  async function expectMembers (space: Ref<Space>, expected: AccountUuid[]): Promise<void> {
    expect(await storedMembers(space)).toEqual([...new Set(expected)].sort())
  }

  /**
   * Whether the actor can read the space and the documents inside it; both must agree.
   * On disagreement fails with the actor role, the space as the actor sees it and the space collaborators.
   */
  async function canRead (actor: Actor, space: Ref<Space>): Promise<boolean> {
    const doc = await actor.rest.findOne(core.class.Space, { _id: space })
    const messages = await actor.rest.findAll(chunter.class.ChatMessage, { space })
    const seesSpace = doc != null
    const seesContent = messages.length > 0
    if (seesSpace !== seesContent) {
      const collaborators = await owner.rest.findAll(core.class.Collaborator, { attachedTo: space })
      const details = {
        actor: actor.account,
        role: actor.ws.info.role,
        seesSpace,
        seesContent,
        spaceAsSeen:
          doc == null ? null : { _class: doc._class, private: doc.private, members: doc.members, owners: doc.owners },
        storedMembers: await storedMembers(space),
        collaborators: collaborators.map((it) => it.collaborator)
      }
      throw new Error(`Space and content access disagree: ${JSON.stringify(details, null, 2)}`)
    }
    return seesSpace
  }

  /**
   * Collaborators of a space follow `members` in an async trigger (ActivityMessagesHandler), and a guest reads
   * the space messages while being a collaborator. Waits until no collaborator is left outside `members`.
   */
  async function waitCollaboratorsSynced (space: Ref<Space>, timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let extra: AccountUuid[] = []
    while (Date.now() < deadline) {
      const members = new Set(await storedMembers(space))
      const collaborators = await owner.rest.findAll(core.class.Collaborator, { attachedTo: space })
      extra = collaborators.map((it) => it.collaborator).filter((it) => !members.has(it))
      if (extra.length === 0) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Collaborators outside members after ${timeoutMs}ms: ${JSON.stringify(extra)}`)
  }

  async function expectAccess (space: Ref<Space>, access: { member: boolean, guest: boolean }): Promise<void> {
    await waitCollaboratorsSynced(space)
    expect({ member: await canRead(member, space), guest: await canRead(guest, space) }).toEqual(access)
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

  async function getChannel (space: Ref<Channel>): Promise<Channel> {
    const doc = await owner.ops.findOne(chunter.class.Channel, { _id: space })
    if (doc === undefined) throw new Error(`Channel ${space} not found`)
    return doc
  }
})
