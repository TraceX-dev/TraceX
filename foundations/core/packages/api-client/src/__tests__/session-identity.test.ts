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

import { getClient, type AccountClient, type WorkspaceLoginInfo } from '@hcengineering/account-client'
import core, {
  AccountRole,
  Hierarchy,
  ModelDb,
  SocialIdType,
  type AccountUuid,
  type Client,
  type Doc,
  type PersonId,
  type Ref,
  type SocialId,
  type WorkspaceUuid
} from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import { connect } from '../client'
import { loadServerConfig, type ServerConfig } from '../config'
import { getWorkspaceToken, type WorkspaceToken } from '../utils'

jest.mock('@hcengineering/account-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  addLocation: jest.fn(),
  getResource: jest.fn()
}))
jest.mock('../config', () => ({ loadServerConfig: jest.fn() }))
jest.mock('../utils', () => ({ getWorkspaceToken: jest.fn() }))
jest.mock('../markup', () => ({ createMarkupOperations: jest.fn().mockReturnValue({}) }))

const uuid = '00000000-0000-4000-8000-000000000001' as AccountUuid
const workspace = '00000000-0000-4000-8000-000000000002' as WorkspaceUuid
const human = 'human-author' as PersonId
const external = 'external-author' as PersonId

beforeEach(() => {
  jest.clearAllMocks()
})

it.each([human, external])('keeps the primary identity while authoring SDK writes as %s', async (socialId) => {
  const socialIds: SocialId[] = [
    { _id: human, type: SocialIdType.HULY, value: uuid, key: `huly:${uuid}` },
    { _id: external, type: SocialIdType.EXTERNAL, value: `${uuid}:codex`, key: `external:${uuid}:codex` }
  ]
  const info: WorkspaceLoginInfo = {
    account: uuid,
    workspace,
    workspaceUrl: 'ws1',
    endpoint: 'http://transactor.test',
    token: 'private-token',
    role: AccountRole.User,
    socialId
  }
  const accountClient: Partial<AccountClient> = {
    getSocialIds: jest.fn().mockResolvedValue(socialIds),
    selectWorkspace: jest.fn().mockResolvedValue(info)
  }
  jest.mocked(getClient).mockReturnValue(accountClient as AccountClient)
  const config: ServerConfig = {
    ACCOUNTS_URL: 'http://accounts.test',
    COLLABORATOR_URL: '',
    FILES_URL: '',
    UPLOAD_URL: ''
  }
  jest.mocked(loadServerConfig).mockResolvedValue(config)
  const workspaceToken: WorkspaceToken = {
    endpoint: info.endpoint,
    token: info.token,
    workspaceId: workspace,
    info
  }
  jest.mocked(getWorkspaceToken).mockResolvedValue(workspaceToken)
  const hierarchy = new Hierarchy()
  const connection: Partial<Client> = {
    getHierarchy: () => hierarchy,
    getModel: () => new ModelDb(hierarchy),
    tx: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue(undefined)
  }
  jest.mocked(getResource).mockResolvedValue(jest.fn().mockResolvedValue(connection))
  const client = await connect('http://front.test', { workspace: 'ws1', token: 'private-token' })
  expect(await client.getAccount()).toMatchObject({ primarySocialId: human, socialId })
  await client.updateDoc(core.class.Doc, core.space.Workspace, 'document' as Ref<Doc>, {})
  expect(connection.tx).toHaveBeenCalledWith(expect.objectContaining({ modifiedBy: socialId }))
  await client.close()
})
