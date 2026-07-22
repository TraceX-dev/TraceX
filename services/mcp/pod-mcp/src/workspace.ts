//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { createRestTxOperations } from '@hcengineering/api-client'
import { getClient as getCollaboratorClient, type CollaboratorClient } from '@hcengineering/collaborator-client'
import { type MeasureContext, type TxOperations, type WorkspaceUuid } from '@hcengineering/core'
import { getTransactorEndpoint } from '@hcengineering/server-client'
import { type StorageAdapter } from '@hcengineering/server-core'
import type { Token } from '@hcengineering/server-token'

import type { McpConfig } from './config'

export interface WorkspaceConnection {
  token: Token
  rawToken: string
  client: TxOperations
  storage: StorageAdapter
  collaborator: CollaboratorClient
  workspace: WorkspaceUuid
  close: () => Promise<void>
}

interface CachedConnection {
  connection: Promise<WorkspaceConnection>
  expiresAt: number
}

export class WorkspaceManager {
  private readonly clients = new Map<string, CachedConnection>()

  constructor (
    private readonly config: McpConfig,
    private readonly ctx: MeasureContext,
    private readonly storage: StorageAdapter
  ) {}

  async getConnection (token: Token, rawToken: string): Promise<WorkspaceConnection> {
    if (this.config.WorkspaceClientCacheMs <= 0) {
      return await this.createConnection(token, rawToken)
    }

    const key = `${token.workspace}:${token.account}:${rawToken}`
    const now = Date.now()
    const cached = this.clients.get(key)
    if (cached !== undefined && cached.expiresAt > now) {
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

    const connection = this.createConnection(token, rawToken)
    this.clients.set(key, {
      connection,
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

  private async createConnection (token: Token, rawToken: string): Promise<WorkspaceConnection> {
    const transactorUrl = await getTransactorEndpoint(rawToken)
    const client = await createRestTxOperations(transactorUrl, token.workspace, rawToken, true)
    const collaborator = getCollaboratorClient(token.workspace, rawToken, this.config.CollaboratorURL)

    return {
      token,
      rawToken,
      client,
      storage: this.storage,
      collaborator,
      workspace: token.workspace,
      close: async () => {
        await client.close()
      }
    }
  }
}
