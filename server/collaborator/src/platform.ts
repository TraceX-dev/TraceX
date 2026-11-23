//
// Copyright © 2023 Hardcore Engineering Inc.
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
  Client,
  PersonId,
  pickPrimarySocialId,
  systemAccountUuid,
  TxOperations,
  WorkspaceUuid
} from '@hcengineering/core'
import { createClient, getTransactorEndpoint } from '@hcengineering/server-client'
import { Token, generateToken } from '@hcengineering/server-token'
import { getClient as getAccountClient } from '@hcengineering/account-client'

import config from './config'

async function connect (token: string): Promise<Client> {
  const endpoint = await getTransactorEndpoint(token)
  return await createClient(endpoint, token)
}

async function getTxOperations (
  client: Client,
  rawToken: string,
  token: Token,
  isDerived: boolean = false
): Promise<TxOperations> {
  let socialId: PersonId

  if (token.account === systemAccountUuid) {
    socialId = core.account.System
  } else {
    const info = await getAccountClient(config.AccountsUrl, rawToken).getLoginWithWorkspaceInfo()
    socialId = info.socialId ?? pickPrimarySocialId(info.socialIds)._id
  }

  return new TxOperations(client, socialId, isDerived)
}

/**
 * @public
 */
export interface ClientFactoryParams {
  derived: boolean
}

/**
 * @public
 */
export type ClientFactory = (params?: ClientFactoryParams) => Promise<TxOperations>

/** Build a visibility-checking client using the actual caller token. */
export function userClientFactory (rawToken: string, token: Token): ClientFactory {
  return async (params?: ClientFactoryParams) => {
    const client = await connect(rawToken)
    try {
      return await getTxOperations(client, rawToken, token, params?.derived ?? false)
    } catch (error: unknown) {
      await client.close()
      throw error
    }
  }
}

/**
 * @public
 */
export function simpleClientFactory (rawToken: string, token: Token): ClientFactory {
  return async (params?: ClientFactoryParams) => {
    const derived = params?.derived ?? false
    const client = await connect(generateToken(systemAccountUuid, token.workspace, { service: 'collaborator' }))
    try {
      return await getTxOperations(client, rawToken, token, derived)
    } catch (error: unknown) {
      await client.close()
      throw error
    }
  }
}

/**
 * @public
 */
export function reusableClientFactory (rawToken: string, token: Token, controller: Controller): ClientFactory {
  return async (params?: ClientFactoryParams) => {
    const derived = params?.derived ?? false
    const workspaceClient = await controller.get(token.workspace)
    return await getTxOperations(workspaceClient.client, rawToken, token, derived)
  }
}

/**
 * @public
 */
export class Controller {
  private readonly workspaces: Map<WorkspaceUuid, WorkspaceClient> = new Map<WorkspaceUuid, WorkspaceClient>()

  async get (workspace: WorkspaceUuid): Promise<WorkspaceClient> {
    let client = this.workspaces.get(workspace)
    if (client === undefined) {
      client = await WorkspaceClient.create(workspace)
      this.workspaces.set(workspace, client)
    }

    return client
  }

  async close (): Promise<void> {
    for (const workspace of this.workspaces.values()) {
      await workspace.close()
    }
    this.workspaces.clear()
  }
}

/**
 * @public
 */
export class WorkspaceClient {
  private constructor (
    readonly workspace: WorkspaceUuid,
    readonly client: Client
  ) {}

  static async create (workspace: WorkspaceUuid): Promise<WorkspaceClient> {
    const token = generateToken(systemAccountUuid, workspace, { service: 'collaborator' })
    const client = await connect(token)
    return new WorkspaceClient(workspace, client)
  }

  async close (): Promise<void> {
    await this.client.close()
  }
}
