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
 * Shared helpers of the space access tests (space-members, space-user-groups).
 *
 * Probe space: a private chunter Channel with one ChatMessage. For a private space the server lets
 * only members read the space and the documents inside it, so "can read" == "is a member".
 */

import {
  createRestClient,
  createRestTxOperations,
  getWorkspaceToken,
  type RestClient,
  type ServerConfig,
  type WorkspaceToken
} from '@hcengineering/api-client'
import { type AccountClient, getClient as getAccountClient } from '@hcengineering/account-client'
import chunter, { type Channel } from '@hcengineering/chunter'
import { ensureEmployee } from '@hcengineering/contact'
import core, {
  type AccountRole,
  type AccountUuid,
  generateId,
  type MeasureContext,
  pickPrimarySocialId,
  type Ref,
  type SocialId,
  type Space,
  type TxOperations
} from '@hcengineering/core'

export const SERVER_URL = 'http://tracex.local:8083'
export const WS_NAME = 'api-tests'
export const PASSWORD = '1234'
export const TIMEOUT = 60000
/** user1 is a plain USER in api-tests: never-expiring invites (exp < 0) need Maintainer, so use a short TTL. */
const INVITE_TTL_MS = 60 * 60 * 1000

export interface Actor {
  account: AccountUuid
  ws: WorkspaceToken
  rest: RestClient
  ops: TxOperations
}

export async function toActor (ws: WorkspaceToken): Promise<Actor> {
  const rest = createRestClient(ws.endpoint, ws.workspaceId, ws.token)
  const ops = await createRestTxOperations(ws.endpoint, ws.workspaceId, ws.token)
  return { account: ws.info.account, ws, rest, ops }
}

export async function loginActor (config: ServerConfig, email: string): Promise<Actor> {
  return await toActor(await getWorkspaceToken(SERVER_URL, { email, password: PASSWORD, workspace: WS_NAME }, config))
}

/** Same path as the workbench on first connect: creates the Person/Employee, which fires OnEmployeeCreate (auto-join). */
export async function ensureEmployeeFor (ctx: MeasureContext, config: ServerConfig, ws: WorkspaceToken): Promise<void> {
  const accountClient = getAccountClient(config.ACCOUNTS_URL, ws.token)
  const person = await accountClient.getPerson()
  const socialIds: SocialId[] = await accountClient.getSocialIds(true)
  await ensureEmployee(
    ctx,
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

/**
 * Signs up a fresh account, joins it to the workspace by an invite of `inviter` with the given role and creates
 * its Employee.
 */
export async function joinNewAccount (
  ctx: MeasureContext,
  config: ServerConfig,
  inviter: AccountClient,
  prefix: string,
  role: AccountRole
): Promise<Actor> {
  const email = `${prefix}-${generateId()}@members.test`
  const anonymous = getAccountClient(config.ACCOUNTS_URL)
  await anonymous.signUp(email, PASSWORD, prefix, 'Tester')
  const inviteId = await inviter.createInvite(INVITE_TTL_MS, '', 1, role)
  await anonymous.join(email, PASSWORD, inviteId, WS_NAME)

  const ws = await getWorkspaceToken(SERVER_URL, { email, password: PASSWORD, workspace: WS_NAME }, config)
  expect(ws.info.role).toBe(role)
  await ensureEmployeeFor(ctx, config, ws)
  return await toActor(ws)
}

/**
 * Reads spaces as `reader` (a member of every probe space) and checks what other actors can read.
 */
export class SpaceProbe {
  constructor (private readonly reader: Actor) {}

  async createChannel (members: AccountUuid[], extra: Partial<Channel> = {}): Promise<Ref<Channel>> {
    const ops = this.reader.ops
    const id = await ops.createDoc(chunter.class.Channel, core.space.Space, {
      name: `members-${generateId()}`,
      description: '',
      topic: '',
      private: true,
      archived: false,
      members,
      ...extra
    })
    await ops.addCollection(chunter.class.ChatMessage, id, id, chunter.class.Channel, 'messages', {
      message: 'members probe'
    })
    return id
  }

  async getChannel (space: Ref<Channel>): Promise<Channel> {
    const doc = await this.reader.ops.findOne(chunter.class.Channel, { _id: space })
    if (doc === undefined) throw new Error(`Channel ${space} not found`)
    return doc
  }

  async storedSpace (space: Ref<Space>): Promise<Space> {
    const doc = await this.reader.rest.findOne(core.class.Space, { _id: space })
    if (doc == null) throw new Error(`Space ${space} not found`)
    return doc
  }

  async storedMembers (space: Ref<Space>): Promise<AccountUuid[]> {
    return [...((await this.storedSpace(space)).members ?? [])].sort()
  }

  async storedDirectMembers (space: Ref<Space>): Promise<AccountUuid[]> {
    return [...((await this.storedSpace(space)).directMembers ?? [])].sort()
  }

  async expectMembers (space: Ref<Space>, expected: AccountUuid[]): Promise<void> {
    expect(await this.storedMembers(space)).toEqual([...new Set(expected)].sort())
  }

  async expectDirectMembers (space: Ref<Space>, expected: AccountUuid[]): Promise<void> {
    expect(await this.storedDirectMembers(space)).toEqual([...new Set(expected)].sort())
  }

  /**
   * Whether the actor can read the space and the documents inside it; both must agree.
   * On disagreement fails with the actor role, the space as the actor sees it and the space collaborators.
   */
  async canRead (actor: Actor, space: Ref<Space>): Promise<boolean> {
    const doc = await actor.rest.findOne(core.class.Space, { _id: space })
    const messages = await actor.rest.findAll(chunter.class.ChatMessage, { space })
    const seesSpace = doc != null
    const seesContent = messages.length > 0
    if (seesSpace !== seesContent) {
      const collaborators = await this.reader.rest.findAll(core.class.Collaborator, { attachedTo: space })
      const details = {
        actor: actor.account,
        role: actor.ws.info.role,
        seesSpace,
        seesContent,
        spaceAsSeen:
          doc == null ? null : { _class: doc._class, private: doc.private, members: doc.members, owners: doc.owners },
        storedMembers: await this.storedMembers(space),
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
  async waitCollaboratorsSynced (space: Ref<Space>, timeoutMs = 10000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let extra: AccountUuid[] = []
    while (Date.now() < deadline) {
      const members = new Set(await this.storedMembers(space))
      const collaborators = await this.reader.rest.findAll(core.class.Collaborator, { attachedTo: space })
      extra = collaborators.map((it) => it.collaborator).filter((it) => !members.has(it))
      if (extra.length === 0) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Collaborators outside members after ${timeoutMs}ms: ${JSON.stringify(extra)}`)
  }

  /** Reads access of every actor of `access` after collaborators are synced. */
  async expectAccess (space: Ref<Space>, actors: Record<string, Actor>, access: Record<string, boolean>): Promise<void> {
    await this.waitCollaboratorsSynced(space)
    const actual: Record<string, boolean> = {}
    for (const name of Object.keys(access)) {
      actual[name] = await this.canRead(actors[name], space)
    }
    expect(actual).toEqual(access)
  }
}
