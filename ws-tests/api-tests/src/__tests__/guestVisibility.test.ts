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
 * `createGuestAccount` below provisions a guest in two steps: (1) `ensurePerson(...,
 * { addGuestEmployee: true })`, which creates the workspace-local `contact.class.Person` +
 * `contact.mixin.Employee` with `role: 'GUEST'`, then (2)
 * `adminAccountClient.updateWorkspaceRoleBySocialKey(...)`, which sets the account's *effective*
 * `AccountRole` for this workspace at the account-service level (the value a session actually
 * authenticates with - see `pods/server/src/rpc.ts`'s `withSession`, which resolves the role from
 * the account service, not from the local Employee mixin).
 *
 * Gotcha: `adminAccountClient`'s token must be scoped to `apiWorkspace1` (not workspace-less).
 * `updateWorkspaceRoleBySocialKey` -> `updateWorkspaceRole` (server/account/src/utils.ts) reads
 * the *caller's own* token to find which workspace to look up the target account's current role
 * in; a workspace-less system token resolves no current role for any workspace and comes back
 * `platform:status:Forbidden`.
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
  buildSocialIdString,
  generateId,
  readOnlyGuestAccountUuid,
  SocialIdType,
  systemAccountUuid,
  type AccountUuid,
  type Ref,
  type Space,
  type TxCreateDoc
} from '@hcengineering/core'
import { type AccountClient, getClient as getAccountClient } from '@hcengineering/account-client'
import contact, { type Person } from '@hcengineering/contact'
import { generateToken } from '@hcengineering/server-token'

describe('guest-visibility (ws api)', () => {
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
    // `updateWorkspaceRoleBySocialKey` looks up the target account's *current* role for the
    // workspace named in the caller's own token (see server/account/src/utils.ts
    // `updateWorkspaceRole`), so this token must be scoped to `apiWorkspace1`, not workspace-less
    // - a workspace-less system token resolves no current role and comes back `Forbidden`.
    adminAccountClient = getAccountClient(
      serverConfig.ACCOUNTS_URL,
      generateToken(systemAccountUuid, apiWorkspace1.workspaceId, { service: 'workspace', admin: 'true' }, 'secret')
    )
  }, 10000)

  function connect (asSystem = false): RestClient {
    const token = asSystem
      ? generateToken(systemAccountUuid, apiWorkspace1.workspaceId, undefined, 'secret')
      : apiWorkspace1.token
    return createRestClient(apiWorkspace1.endpoint, apiWorkspace1.workspaceId, token)
  }

  function connectAs (uuid: AccountUuid): RestClient {
    const token = generateToken(uuid, apiWorkspace1.workspaceId, undefined, 'secret')
    return createRestClient(apiWorkspace1.endpoint, apiWorkspace1.workspaceId, token)
  }

  async function ensureTestPerson (
    label: string,
    asGuest: boolean
  ): Promise<{ uuid: AccountUuid, socialKey: string, personId: Ref<Person> }> {
    const owner = connect()
    const socialValue = `${label}-${generateId()}`
    const socialKey = buildSocialIdString({ type: SocialIdType.TELEGRAM, value: socialValue })
    const { uuid, localPerson } = await owner.ensurePerson(SocialIdType.TELEGRAM, socialValue, label, 'Test', {
      addGuestEmployee: asGuest
    })
    return { uuid: uuid as AccountUuid, socialKey, personId: localPerson as Ref<Person> }
  }

  async function createGuestAccount (label: string): Promise<{ uuid: AccountUuid, personId: Ref<Person> }> {
    const guest = await ensureTestPerson(label, true)
    // See the file-level comment: this is the unverified part of guest provisioning.
    await adminAccountClient.updateWorkspaceRoleBySocialKey(guest.socialKey, AccountRole.Guest)
    return { uuid: guest.uuid, personId: guest.personId }
  }

  async function createSpace (members: AccountUuid[], extra: Partial<Space> = {}): Promise<Ref<Space>> {
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
      objectClass: core.class.Space,
      objectId
    }
    await owner.tx(tx)
    return objectId
  }

  async function waitFor<T> (check: () => Promise<T | undefined>, timeoutMs = 5000, stepMs = 250): Promise<T | undefined> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      const result = await check()
      if (result !== undefined) return result
      await new Promise((resolve) => setTimeout(resolve, stepMs))
    }
    return undefined
  }

  describe('Person visibility', () => {
    let guest: { uuid: AccountUuid, personId: Ref<Person> }
    let visiblePersonId: Ref<Person>
    let hiddenPersonId: Ref<Person>

    beforeAll(async () => {
      guest = await createGuestAccount('guest')
      const visible = await ensureTestPerson('visible', false)
      const hidden = await ensureTestPerson('hidden', false)
      visiblePersonId = visible.personId
      hiddenPersonId = hidden.personId

      // Guest shares a space with `visible`, but never with `hidden`.
      await createSpace([guest.uuid, visible.uuid])
      await createSpace([hidden.uuid])
    }, 20000)

    it('open findAll only returns people from spaces the guest shares (plus self)', async () => {
      const conn = connectAs(guest.uuid)
      const persons = await conn.findAll(contact.class.Person, {})
      const ids = persons.map((p) => p._id)
      expect(ids).toContain(visiblePersonId)
      expect(ids).not.toContain(hiddenPersonId)
    })

    it('a narrow _id query still resolves a person outside shared spaces (bypass for known refs)', async () => {
      const conn = connectAs(guest.uuid)
      const found = await conn.findOne(contact.class.Person, { _id: hiddenPersonId })
      expect(found?._id).toBe(hiddenPersonId)
    })

    it('mention/search picker does not surface people outside shared spaces', async () => {
      const conn = connectAs(guest.uuid)
      const result = await conn.searchFulltext(
        { query: 'hidden', classes: [contact.class.Person] },
        { limit: 10 }
      )
      expect(result.docs.map((d) => d.id)).not.toContain(hiddenPersonId)
    })

    it('mention/search picker surfaces people from shared spaces', async () => {
      const conn = connectAs(guest.uuid)
      const result = await conn.searchFulltext(
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
      const space = await waitFor(async () => {
        const found = await owner.findOne(core.class.Space, { _id: anonymousOnlySpace })
        return found
      })
      expect(space?.members).not.toContain(guest.uuid)
    })

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
    })
  })
})
