//
// Copyright © 2026 TraceX SAS.
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

import { getClient, type AccountClient } from '@hcengineering/account-client'
import { createRestTxOperations } from '@hcengineering/api-client'
import { getClient as getCollaborator } from '@hcengineering/collaborator-client'
import contact, { type Employee, type SocialIdentity, type SocialIdentityRef } from '@hcengineering/contact'
import {
  AccountRole,
  MeasureMetricsContext,
  SocialIdType,
  TxOperations,
  type Account,
  type AccountUuid,
  type Client,
  type DocumentQuery,
  type Doc,
  type PersonId,
  type Ref,
  type SocialId,
  type Tx,
  type TxCreateDoc,
  type WorkspaceUuid
} from '@hcengineering/core'
import type { StorageAdapter } from '@hcengineering/server-core'
import { WorkspaceManager } from '../workspace'
import type { McpConfig } from '../config'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/api-client', () => ({ createRestTxOperations: jest.fn() }))
jest.mock('@hcengineering/collaborator-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({ decodeToken: (value: string) => JSON.parse(value) }))

const accountId = '00000000-0000-4000-8000-000000000001' as AccountUuid
const workspaceId = '00000000-0000-4000-8000-000000000002' as WorkspaceUuid
const humanId = 'human-author' as SocialIdentityRef
const externalId = 'external-author' as SocialIdentityRef
const personRef = 'ben-liden' as Ref<Employee>
const human: SocialId = {
  _id: humanId,
  type: SocialIdType.HULY,
  value: accountId,
  key: `huly:${accountId}`,
  verifiedOn: 1
}
const external: SocialId = {
  _id: externalId,
  type: SocialIdType.EXTERNAL,
  value: `${accountId}:codex`,
  key: `external:${accountId}:codex`,
  verifiedOn: 1
}
const me: Account = {
  uuid: accountId,
  role: AccountRole.User,
  primarySocialId: humanId,
  socialId: externalId,
  socialIds: [humanId, externalId],
  fullSocialIds: [human, external]
}
const person: Partial<Employee> = {
  _id: personRef,
  _class: contact.class.Person,
  space: contact.space.Contacts,
  name: 'Liden,Ben',
  personUuid: accountId,
  active: true,
  role: 'USER'
}
const employee = Object.assign({}, person, { [contact.mixin.Employee]: {} })
const humanIdentity: SocialIdentity = {
  ...human,
  _id: humanId,
  _class: contact.class.SocialIdentity,
  attachedTo: personRef,
  attachedToClass: contact.class.Person,
  collection: 'socialIds',
  space: contact.space.Contacts,
  modifiedBy: humanId,
  modifiedOn: 1
}
const claims: Record<string, string> = {
  externalSource: 'codex',
  externalSocialId: externalId,
  externalConnectionId: 'connection'
}
const accountToken = JSON.stringify({ account: accountId, extra: claims })
const workspaceToken = JSON.stringify({ account: accountId, workspace: workspaceId, extra: claims })
const config: McpConfig = {
  AccountsURL: 'http://accounts.test',
  ServerSecret: 'test-only',
  CollaboratorURL: 'http://collaborator.test',
  Port: 4020,
  ServiceID: 'test',
  WorkspaceClientCacheMs: 0,
  OAuthIssuerURL: 'https://auth.test',
  OAuthInternalURL: 'http://auth.test',
  OAuthResourceURL: 'https://mcp.test/mcp',
  OAuthAllowHttp: false
}

function fixture (): {
  manager: WorkspaceManager
  identities: Map<PersonId, SocialIdentity>
  operations: TxOperations
  accountClient: Partial<AccountClient>
} {
  const identities = new Map<PersonId, SocialIdentity>([[humanId, humanIdentity]])
  const accountClient: Partial<AccountClient> = {
    selectWorkspace: jest.fn().mockResolvedValue({
      workspace: workspaceId,
      workspaceName: 'ws1',
      workspaceAvailable: true,
      workspaceUrl: 'ws1',
      token: workspaceToken,
      endpoint: 'http://transactor.test'
    }),
    getPerson: jest.fn().mockResolvedValue({ uuid: accountId, firstName: 'Ben', lastName: 'Liden' })
  }
  const workspaceClient: Partial<Client> = {
    findOne: jest.fn().mockImplementation(async (requestedClass: string, query: DocumentQuery<Doc>) => {
      if (requestedClass === contact.class.Person) return person
      if (requestedClass === contact.mixin.Employee) return employee
      return [...identities.values()].find((identity) => identity._id === query._id)
    }),
    findAll: jest.fn().mockImplementation(async () => [...identities.values()]),
    tx: jest.fn().mockImplementation(async (tx: Tx) => {
      const create = tx as TxCreateDoc<SocialIdentity>
      if (create.objectClass !== contact.class.SocialIdentity || create.objectId !== externalId) {
        throw new Error('Unexpected identity bootstrap transaction')
      }
      const identity: SocialIdentity = {
        ...create.attributes,
        _id: externalId,
        _class: create.objectClass,
        space: create.objectSpace,
        modifiedBy: create.modifiedBy,
        modifiedOn: create.modifiedOn
      }
      identities.set(identity._id, identity)
      return {}
    }),
    close: jest.fn().mockResolvedValue(undefined)
  }
  const operations = Object.assign(new TxOperations(workspaceClient as Client, externalId), { account: me })
  jest.mocked(getClient).mockReturnValue(accountClient as AccountClient)
  jest.mocked(createRestTxOperations).mockResolvedValue(operations)
  const collaborator: Partial<ReturnType<typeof getCollaborator>> = {}
  jest.mocked(getCollaborator).mockReturnValue(collaborator as ReturnType<typeof getCollaborator>)
  const storage: Partial<StorageAdapter> = {}
  return {
    manager: new WorkspaceManager(config, new MeasureMetricsContext('test', {}), storage as StorageAdapter),
    identities,
    operations,
    accountClient
  }
}

beforeEach(() => {
  jest.clearAllMocks()
})

it('materializes the external author on the existing person before exposing an MCP connection', async () => {
  const { manager, identities, operations } = fixture()
  expect(identities.has(externalId)).toBe(false)
  const connection = await manager.getConnection(accountToken, 'ws1')
  expect(identities.get(externalId)).toMatchObject({
    attachedTo: personRef,
    type: SocialIdType.EXTERNAL,
    value: external.value
  })
  expect(connection.client.user).toBe(externalId)
  expect(operations.client.tx).toHaveBeenCalledTimes(1)
  await connection.close()
})

it('does not duplicate the author identity on subsequent MCP requests', async () => {
  const { manager, identities, operations } = fixture()
  const first = await manager.getConnection(accountToken, 'ws1')
  await first.close()
  const second = await manager.getConnection(accountToken, 'ws1')
  expect(identities.size).toBe(2)
  expect(operations.client.tx).toHaveBeenCalledTimes(1)
  await second.close()
})

it('closes the client and refuses the connection if author synchronization fails', async () => {
  const { manager, operations, accountClient } = fixture()
  jest.mocked(accountClient.getPerson!).mockRejectedValue(new Error('Account lookup failed'))
  await expect(manager.getConnection(accountToken, 'ws1')).rejects.toThrow('Account lookup failed')
  expect(operations.client.close).toHaveBeenCalledTimes(1)
})
