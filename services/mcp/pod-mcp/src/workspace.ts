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

import { createRestTxOperations } from '@hcengineering/api-client'
import { getClient as getAccountClient } from '@hcengineering/account-client'
import { getClient as getCollaboratorClient, type CollaboratorClient } from '@hcengineering/collaborator-client'
import { ensureEmployee } from '@hcengineering/contact'
import {
  type MeasureContext,
  type TxOperations,
  type WorkspaceDataId,
  type WorkspaceIds,
  type WorkspaceUuid
} from '@hcengineering/core'
import { type StorageAdapter } from '@hcengineering/server-core'
import { decodeToken, type Token } from '@hcengineering/server-token'

import type { McpConfig } from './config'

export interface WorkspaceConnection {
  token: Token
  rawToken: string
  client: TxOperations
  storage: StorageAdapter
  collaborator: CollaboratorClient
  workspace: WorkspaceUuid
  workspaceName: string
  workspaceUrl: string
  workspaceIds?: WorkspaceIds
  close: () => Promise<void>
}

interface CachedConnection {
  connection: Promise<WorkspaceConnection>
  rawToken: string
  expiresAt: number
}

export class WorkspaceManager {
  private readonly clients = new Map<string, CachedConnection>()

  constructor (
    private readonly config: McpConfig,
    private readonly ctx: MeasureContext,
    private readonly storage: StorageAdapter
  ) {}

  async getWorkspaces (
    accountToken: string,
    workspaceId: string | null = null
  ): Promise<Array<{ name: string, url: string }>> {
    const workspaces = await getAccountClient(this.config.AccountsURL, accountToken).getUserWorkspaces()
    return workspaces
      .filter((workspace) => workspaceId === null || workspace.uuid === workspaceId)
      .map((workspace) => ({ name: workspace.name, url: workspace.url }))
  }

  async getConnection (
    accountToken: string,
    workspaceUrl: string,
    allowedWorkspaceId: string | null = null
  ): Promise<WorkspaceConnection> {
    // Check current membership before using a cached workspace client.
    const login = await getAccountClient(this.config.AccountsURL, accountToken).selectWorkspace(
      workspaceUrl,
      'byregion',
      process.env.EXTERNAL_REGIONS?.split(';') ?? []
    )
    if (typeof login.token !== 'string' || typeof login.workspace !== 'string' || login.workspaceUrl !== workspaceUrl) {
      throw new Error('Workspace token exchange failed')
    }
    if (allowedWorkspaceId !== null && login.workspace !== allowedWorkspaceId) {
      throw new Error('Workspace is not authorized by this MCP connection.')
    }
    const rawToken = login.token
    const accountClaims = decodeToken(accountToken, true, this.config.ServerSecret)
    const token = decodeToken(rawToken, true, this.config.ServerSecret)
    if (
      token.account !== accountClaims.account ||
      token.workspace !== login.workspace ||
      token.extra?.externalSocialId !== accountClaims.extra?.externalSocialId ||
      token.extra?.externalConnectionId !== accountClaims.extra?.externalConnectionId
    ) {
      throw new Error('Workspace token exchange returned a different account or workspace')
    }
    if (login.workspaceAvailable !== true) throw new Error('Workspace is not available')
    if (typeof login.workspaceName !== 'string') throw new Error('Workspace token exchange returned no workspace name')
    const workspace = { name: login.workspaceName, url: login.workspaceUrl }
    if (this.config.WorkspaceClientCacheMs <= 0) {
      return await this.createConnection(token, rawToken, login.endpoint, workspace, login.workspaceDataId)
    }

    const key = `${token.workspace}:${token.account}:${token.extra?.externalConnectionId ?? ''}`
    const now = Date.now()
    const cached = this.clients.get(key)
    if (cached !== undefined && cached.rawToken === rawToken && cached.expiresAt > now) {
      return await cached.connection
    }

    if (cached !== undefined) {
      this.closeCached(cached).catch((err) => {
        this.ctx.error('Failed to close expired workspace client', {
          workspace: token.workspace,
          error: err instanceof Error ? err.message : String(err)
        })
      })
    }

    const connection = this.createConnection(token, rawToken, login.endpoint, workspace, login.workspaceDataId)
    this.clients.set(key, {
      connection,
      rawToken,
      expiresAt: now + this.config.WorkspaceClientCacheMs
    })
    return await connection
  }

  async close (): Promise<void> {
    await Promise.all(
      [...this.clients.values()].map(async (cached) => {
        await this.closeCached(cached)
      })
    )
    this.clients.clear()
  }

  private async closeCached (cached: CachedConnection): Promise<void> {
    const result = await Promise.resolve(cached.connection).then(
      (connection) => ({ status: 'fulfilled' as const, value: connection }),
      (reason) => ({ status: 'rejected' as const, reason })
    )
    if (result.status === 'fulfilled') {
      await result.value.close()
    }
  }

  private async createConnection (
    token: Token,
    rawToken: string,
    transactorUrl: string,
    workspace: { name: string, url: string },
    dataId?: WorkspaceDataId
  ): Promise<WorkspaceConnection> {
    const client = await createRestTxOperations(transactorUrl, token.workspace, rawToken, true)
    try {
      const account = client.account
      const accountClient = getAccountClient(this.config.AccountsURL, rawToken)
      const person = await ensureEmployee(
        this.ctx,
        account,
        client,
        account.fullSocialIds,
        async () => await accountClient.getPerson()
      )
      if (person === null) throw new Error('Workspace author identity synchronization failed')
    } catch (error: unknown) {
      await client.close()
      throw error
    }
    const collaborator = getCollaboratorClient(token.workspace, rawToken, this.config.CollaboratorURL)

    return {
      token,
      rawToken,
      client,
      storage: this.storage,
      collaborator,
      workspace: token.workspace,
      workspaceName: workspace.name,
      workspaceUrl: workspace.url,
      workspaceIds: { uuid: token.workspace, url: workspace.url, dataId },
      close: async () => {
        await client.close()
      }
    }
  }
}
