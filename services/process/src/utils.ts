//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { getClient as getAccountClient } from '@hcengineering/account-client'
import { NodeWebSocketFactory } from '@hcengineering/api-client'
import clientPlugin from '@hcengineering/client'
import clientResources from '@hcengineering/client-resources'
import core, { ClientConnectEvent, systemAccountUuid, TxOperations } from '@hcengineering/core'
import type { MeasureContext, WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import { generateToken } from '@hcengineering/server-token'
import config from './config'

export const SERVICE_NAME = 'process-service'

interface CachedClient {
  client: Promise<TxOperations>
  users: number
  invalidated: boolean
  idleTimer?: ReturnType<typeof setTimeout>
}

const clients = new Map<WorkspaceUuid, CachedClient>()
let lifecycleContext: MeasureContext | undefined

/** Use the service context for connection lifetime telemetry, never an event context. */
export function configureClients (ctx: MeasureContext): void {
  lifecycleContext = ctx
}

function reportSize (): void {
  lifecycleContext?.gauge('process_cached_clients', clients.size)
}

function touch (workspace: WorkspaceUuid, entry: CachedClient): void {
  clients.delete(workspace)
  clients.set(workspace, entry)
}

function closeInBackground (workspace: WorkspaceUuid, entry: CachedClient): void {
  void close(workspace, entry).catch((error: unknown) => {
    if (lifecycleContext !== undefined) {
      lifecycleContext.error('Failed to close process client', { workspace, error })
    } else {
      console.error(`Failed to close client for ${workspace}`, error)
    }
  })
}

function trimClients (): void {
  for (const [workspace, entry] of clients) {
    if (clients.size <= config.ClientCacheMaxSize) break
    if (entry.users === 0) closeInBackground(workspace, entry)
  }
}

export async function getClient (workspace: WorkspaceUuid, ctx?: MeasureContext): Promise<TxOperations> {
  let entry = clients.get(workspace)
  if (entry?.invalidated === true) {
    if (entry.users > 0) throw new Error('Process client model upgrade is still in progress')
    closeInBackground(workspace, entry)
    entry = undefined
  }
  if (entry === undefined) {
    ctx?.counter('process_client_cache_misses', 1)
    const created: CachedClient = {
      client: Promise.resolve().then(async () => await createClient(workspace, created, ctx)),
      users: 0,
      invalidated: false
    }
    entry = created
    clients.set(workspace, entry)
    reportSize()
  } else {
    ctx?.counter('process_client_cache_hits', 1)
  }
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }
  entry.users++
  touch(workspace, entry)
  trimClients()
  try {
    return await entry.client
  } catch (error) {
    entry.users--
    if (clients.get(workspace) === entry) {
      clients.delete(workspace)
      reportSize()
    }
    throw error
  }
}

export async function releaseClient (workspace: WorkspaceUuid): Promise<void> {
  const entry = clients.get(workspace)
  if (entry === undefined || entry.users === 0) {
    console.warn(`Client for ${workspace} not in use`)
    return
  }
  entry.users--
  if (entry.users === 0) {
    touch(workspace, entry)
    if (entry.invalidated) {
      closeInBackground(workspace, entry)
    } else {
      entry.idleTimer = setTimeout(() => { closeInBackground(workspace, entry) }, config.ClientIdleTimeoutMs)
      trimClients()
    }
  }
}

async function close (workspace: WorkspaceUuid, entry: CachedClient, force: boolean = false): Promise<void> {
  if ((!force && entry.users > 0) || clients.get(workspace) !== entry) return
  if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer)
  clients.delete(workspace)
  reportSize()
  const client = await entry.client
  await client.close()
  lifecycleContext?.counter('process_clients_closed', 1)
}

/** Close connections after the consumer has finished processing its messages. */
export async function closeClients (): Promise<void> {
  const results = await Promise.allSettled(Array.from(clients, async ([workspace, entry]) => {
    await close(workspace, entry, true)
  }))
  for (const result of results) {
    if (result.status === 'rejected') {
      lifecycleContext?.error('Failed to close process client during shutdown', { error: result.reason })
    }
  }
}

async function createClient (
  workspace: WorkspaceUuid, entry: CachedClient, ctx?: MeasureContext
): Promise<TxOperations> {
  const token = generateToken(systemAccountUuid, workspace, { service: SERVICE_NAME })
  const accountClient = getAccountClient(config.AccountsUrl, token)
  const login = async (): ReturnType<typeof accountClient.getLoginInfoByToken> =>
    await accountClient.getLoginInfoByToken()
  const wsInfo = ctx === undefined ? await login() : await ctx.with('process.account-login', {}, login)
  if (wsInfo == null || !('endpoint' in wsInfo)) throw new Error('Invalid login info')

  // Process method and trigger implementations require the unfiltered server model.
  setMetadata(clientPlugin.metadata.FilterModel, 'none')
  const factory = (await clientResources()).function.GetClient
  const create = async (): Promise<TxOperations> => {
    const connection = await factory(wsInfo.token, wsInfo.endpoint, {
      ctx: lifecycleContext,
      socketFactory: NodeWebSocketFactory,
      useBinaryProtocol: true,
      useProtocolCompression: true,
      connectionTimeout: config.ClientConnectionTimeoutMs,
      onConnect: async (event) => {
        if (event !== ClientConnectEvent.Connected && event !== ClientConnectEvent.Maintenance) {
          lifecycleContext?.counter('process_client_reconnects', 1)
        }
      },
      onUpgrade: () => {
        entry.invalidated = true
        lifecycleContext?.counter('process_client_model_upgrades', 1)
        if (entry.users === 0) closeInBackground(workspace, entry)
      }
    })
    lifecycleContext?.counter('process_clients_opened', 1)
    return new TxOperations(connection, core.account.System)
  }
  return ctx === undefined ? await create() : await ctx.with('process.load-client-model', {}, create)
}
