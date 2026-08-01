//
// Copyright © 2026 TraceX.
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
 * Real REST/WS integration tests for guest visibility restrictions, run against a live
 * transactor + account service (see ws-tests/docker-compose.yaml), following the conventions of
 * rest.test.ts in this package.
 *
 * `provisionAccount` reproduces the real account -> workspace-member -> local-employee pipeline,
 * since two earlier, cheaper attempts turned out to skip real steps of it:
 *
 * - `ensurePerson` (server/account/src/operations.ts) only inserts a `db.person` + `db.socialId`
 *   row - no `db.account` row at all - so `assignWorkspace`/`updateWorkspaceRoleBySocialKey`
 *   (which both resolve the target through `db.account`) fail with `AccountNotFound`/`Forbidden`.
 * - `signUp` + `assignWorkspace` alone creates a real account with a workspace role, but never
 *   touches the workspace's own document DB, so no `contact.class.Person`/`contact.mixin.Employee`
 *   gets created there and `OnEmployeeCreate` never fires - `ensureEmployee` (the same helper
 *   rest.test.ts uses for its own two seed accounts) is what actually creates that local record,
 *   deriving the Employee's `role` ('GUEST' vs 'USER') from the account's real `AccountRole`.
 */

import {
  createRestClient,
  getWorkspaceToken,
  loadServerConfig,
  type RestClient,
  type ServerConfig,
  type WorkspaceToken
} from '@hcengineering/api-client'
import core, {
  AccountRole,
  generateId,
  MeasureMetricsContext,
  pickPrimarySocialId,
  readOnlyGuestAccountUuid,
  systemAccountUuid,
  type Account,
  type AccountUuid,
  type Class,
  type ModulePermissionGroup,
  type Ref,
  type Space,
  type TxCreateDoc,
  type TxRemoveDoc
} from '@hcengineering/core'
import { type AccountClient, getClient as getAccountClient } from '@hcengineering/account-client'
import chunter from '@hcengineering/chunter'
import contact, { ensureEmployee, type Person } from '@hcengineering/contact'
import { generateToken } from '@hcengineering/server-token'

describe('guest-visibility (ws api)', () => {
  const testCtx = new MeasureMetricsContext('test', {})
  const wsName = 'api-tests'
  const serverUrl = 'http://tracex.local:8083'

  let serverConfig: ServerConfig
  let apiWorkspace1: WorkspaceToken
  let adminAccountClient: AccountClient

  beforeAll(async () => {
    serverConfig = await loadServerConfig(serverUrl)
    apiWorkspace1 = await getWorkspaceToken(
      serverUrl,
      { email: 'user1', password: '1234', workspace: wsName },
      serverConfig
    )
    adminAccountClient = getAccountClient(
      serverConfig.ACCOUNTS_URL,
      generateToken(systemAccountUuid, apiWorkspace1.workspaceId, { service: 'workspace', admin: 'true' }, 'secret')
    )
  }, 10000)

  function connect (): RestClient {
    return createRestClient(apiWorkspace1.endpoint, apiWorkspace1.workspaceId, apiWorkspace1.token)
  }

  async function provisionAccount (
    label: string,
    role: AccountRole
  ): Promise<{ uuid: AccountUuid, personId: Ref<Person>, conn: RestClient }> {
    const email = `${label}-${generateId()}@guest-visibility.test`
    const password = 'guest-visibility-1234'

    await adminAccountClient.signUp(email, password, label, 'Test')
    await adminAccountClient.assignWorkspace(email, apiWorkspace1.workspaceId, role)

    const login = await getWorkspaceToken(serverUrl, { email, password, workspace: wsName }, serverConfig)
    const conn = createRestClient(login.endpoint, login.workspaceId, login.token)
    const loggedInAccountClient = getAccountClient(serverConfig.ACCOUNTS_URL, login.token)

    const person = await loggedInAccountClient.getPerson()
    const socialIds = await loggedInAccountClient.getSocialIds(true)

    const account: Account = {
      uuid: login.info.account,
      role: login.info.role,
      primarySocialId: pickPrimarySocialId(socialIds)._id,
      socialIds: socialIds.map((si) => si._id),
      fullSocialIds: socialIds
    }

    const personId = await ensureEmployee(testCtx, account, conn, socialIds, async () => person)
    if (personId === null) {
      throw new Error(`Failed to provision local person for ${email}`)
    }

    return { uuid: login.info.account, personId, conn }
  }

  async function createGuestAccount (
    label: string
  ): Promise<{ uuid: AccountUuid, personId: Ref<Person>, conn: RestClient }> {
    return await provisionAccount(label, AccountRole.Guest)
  }

  async function createSpace (
    members: AccountUuid[],
    extra: Partial<Space> = {},
    objectClass: Ref<Class<Space>> = core.class.Space
  ): Promise<Ref<Space>> {
    const owner = connect()
    const ownerAccount = await owner.getAccount()
    const objectId: Ref<Space> = generateId()
    const tx: TxCreateDoc<Space> = {
      _class: core.class.TxCreateDoc,
      space: core.space.Tx,
      _id: generateId(),
      objectSpace: core.space.Model,
      modifiedBy: ownerAccount.primarySocialId,
      modifiedOn: Date.now(),
      attributes: {
        name: `guest-visibility-${generateId()}`,
        description: '',
        private: false,
        archived: false,
        members,
        autoJoin: false,
        ...extra
      },
      objectClass,
      objectId
    }
    await owner.tx(tx)
    return objectId
  }

  async function waitFor<T> (
    check: () => Promise<T | undefined>,
    timeoutMs = 5000,
    stepMs = 250
  ): Promise<T | undefined> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const result = await check()
      if (result !== undefined) return result
      await new Promise((resolve) => setTimeout(resolve, stepMs))
    }
    return undefined
  }

  describe('Person visibility', () => {
    let guest: { uuid: AccountUuid, personId: Ref<Person>, conn: RestClient }
    let visiblePersonId: Ref<Person>
    let hiddenPersonId: Ref<Person>

    beforeAll(async () => {
      guest = await createGuestAccount('guest')
      const visible = await provisionAccount('visible', AccountRole.User)
      const hidden = await provisionAccount('hidden', AccountRole.User)
      visiblePersonId = visible.personId
      hiddenPersonId = hidden.personId

      // Guest shares a space with `visible`, but never with `hidden`.
      await createSpace([guest.uuid, visible.uuid])
      await createSpace([hidden.uuid])

      // Fulltext indexing is asynchronous (a separate indexer consumes the tx queue), unlike
      // `findAll`, which reads the primary DB directly. Without waiting for the index to catch up,
      // the "does not surface `hidden`" assertion below would trivially pass for the wrong reason
      // (nothing indexed yet at all) while the "surfaces `visible`" assertion would be flaky.
      await waitFor(
        async () => {
          const result = await guest.conn.searchFulltext(
            { query: 'visible', classes: [contact.class.Person] },
            { limit: 10 }
          )
          return result.docs.some((d) => d.id === visiblePersonId) ? true : undefined
        },
        20000,
        500
      )
    }, 40000)

    it('open findAll only returns people from spaces the guest shares (plus self)', async () => {
      const persons = await guest.conn.findAll(contact.class.Person, {})
      const ids = persons.map((p) => p._id)
      expect(ids).toContain(visiblePersonId)
      expect(ids).not.toContain(hiddenPersonId)
    })

    it('a narrow _id query still resolves a person outside shared spaces (bypass for known refs)', async () => {
      const found = await guest.conn.findOne(contact.class.Person, { _id: hiddenPersonId })
      expect(found?._id).toBe(hiddenPersonId)
    })

    it('mention/search picker does not surface people outside shared spaces', async () => {
      const result = await guest.conn.searchFulltext(
        { query: 'hidden', classes: [contact.class.Person] },
        { limit: 10 }
      )
      expect(result.docs.map((d) => d.id)).not.toContain(hiddenPersonId)
    })

    it('mention/search picker surfaces people from shared spaces', async () => {
      const result = await guest.conn.searchFulltext(
        { query: 'visible', classes: [contact.class.Person] },
        { limit: 10 }
      )
      expect(result.docs.map((d) => d.id)).toContain(visiblePersonId)
    })
  })

  describe('OnEmployeeCreate guest space provisioning', () => {
    it('does not auto-join a space that is only visible to the anonymous read-only account', async () => {
      const anonymousOnlySpace = await createSpace([readOnlyGuestAccountUuid])
      const guest = await createGuestAccount('anon-check')

      const owner = connect()
      const space = await waitFor(async () => await owner.findOne(core.class.Space, { _id: anonymousOnlySpace }))
      expect(space?.members).not.toContain(guest.uuid)
    }, 15000)

    it('auto-joins a space with autoJoinForRoles including Guest', async () => {
      const extra: Partial<Space> = { autoJoinForRoles: [AccountRole.Guest] }
      const guestAutoJoinSpace = await createSpace([], extra)
      const guest = await createGuestAccount('autojoin-check')

      const owner = connect()
      const joined = await waitFor(async () => {
        const found = await owner.findOne(core.class.Space, { _id: guestAutoJoinSpace })
        return found?.members.includes(guest.uuid) === true ? found : undefined
      })
      expect(joined?.members).toContain(guest.uuid)
    }, 15000)
  })

  describe('Disabled-module exclusion (findAll + search)', () => {
    // Uses chunter.class.Channel as the "disabled module" space class: it's a plain Space
    // subclass (no extra required attributes beyond Space's own), so it's just as easy to create
    // as the generic test spaces above, but - unlike core.class.Space itself - disabling it only
    // affects Channel spaces, not every space created elsewhere in this file.
    let groupId: Ref<ModulePermissionGroup>

    beforeAll(async () => {
      const owner = connect()
      const ownerAccount = await owner.getAccount()
      groupId = generateId()
      const createGroupTx: TxCreateDoc<ModulePermissionGroup> = {
        _class: core.class.TxCreateDoc,
        space: core.space.Tx,
        _id: generateId(),
        objectSpace: core.space.Model,
        modifiedBy: ownerAccount.primarySocialId,
        modifiedOn: Date.now(),
        attributes: {
          application: generateId(),
          role: AccountRole.Guest,
          permissions: [],
          enabled: false,
          spaceClass: chunter.class.Channel
        },
        objectClass: core.class.ModulePermissionGroup,
        objectId: groupId
      }
      await owner.tx(createGroupTx)
    }, 15000)

    afterAll(async () => {
      // Don't leave Channels permanently disabled for every guest in this workspace.
      //
      // Note: `RestClient.remove()` posts to `/api/v1/remove`, which requires a system-account
      // token (`ensureSystemAccount` in pods/server/src/rpc.ts) - a regular user token like
      // `apiWorkspace1`'s gets a 403 there even though the same user can create/remove the doc
      // fine through the normal `tx` pipeline (as the `beforeAll` above already does for create).
      // So build the `TxRemoveDoc` by hand and send it through `tx`, not `remove()`.
      const owner = connect()
      const group = await owner.findOne(core.class.ModulePermissionGroup, { _id: groupId })
      if (group !== undefined) {
        const removeTx: TxRemoveDoc<ModulePermissionGroup> = {
          _class: core.class.TxRemoveDoc,
          space: core.space.Tx,
          _id: generateId(),
          objectId: group._id,
          objectClass: group._class,
          objectSpace: group.space,
          modifiedBy: (await owner.getAccount()).primarySocialId,
          modifiedOn: Date.now()
        }
        await owner.tx(removeTx)
      }
    }, 15000)

    it('findAll does not return a disabled-module space even though the guest is a member', async () => {
      const guest = await createGuestAccount('module-disabled')
      const channelId = await createSpace([guest.uuid], {}, chunter.class.Channel)

      const found = await guest.conn.findOne(chunter.class.Channel, { _id: channelId })
      expect(found).toBeUndefined()
    }, 20000)

    it('a plain (non-disabled) space the guest is a member of remains visible', async () => {
      const guest = await createGuestAccount('module-disabled-control')
      const spaceId = await createSpace([guest.uuid])

      const found = await guest.conn.findOne(core.class.Space, { _id: spaceId })
      expect(found?._id).toBe(spaceId)
    }, 20000)

    it('a User (role not targeted by the disabled group) still sees the channel', async () => {
      const user = await provisionAccount('module-disabled-user', AccountRole.User)
      const channelId = await createSpace([user.uuid], {}, chunter.class.Channel)

      const found = await user.conn.findOne(chunter.class.Channel, { _id: channelId })
      expect(found?._id).toBe(channelId)
    }, 20000)

    it('mention/search does not surface a disabled-module space', async () => {
      const guest = await createGuestAccount('module-disabled-search')
      const channelName = `disabled-channel-${generateId()}`
      const channelId = await createSpace([guest.uuid], { name: channelName }, chunter.class.Channel)

      const controlName = `control-channel-${generateId()}`
      const controlId = await createSpace([guest.uuid], { name: controlName }, chunter.class.Channel)

      // Wait for the fulltext indexer to catch up on the *visible* control channel before
      // asserting the disabled one is absent - otherwise the negative assertion below could
      // trivially pass because nothing has been indexed yet at all (see the Person-visibility
      // beforeAll above for the same issue).
      await waitFor(
        async () => {
          const result = await guest.conn.searchFulltext(
            { query: controlName, classes: [chunter.class.Channel] },
            { limit: 10 }
          )
          return result.docs.some((d) => d.id === controlId) ? true : undefined
        },
        20000,
        500
      )

      const result = await guest.conn.searchFulltext(
        { query: channelName, classes: [chunter.class.Channel] },
        { limit: 10 }
      )
      expect(result.docs.map((d) => d.id)).not.toContain(channelId)
    }, 30000)
  })
})
