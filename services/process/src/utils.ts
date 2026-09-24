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
import { createRestTxOperations } from '@hcengineering/api-client'
import { systemAccountUuid, TxOperations, WorkspaceUuid } from '@hcengineering/core'
import type { MeasureContext } from '@hcengineering/core'
import { generateToken } from '@hcengineering/server-token'
import config from './config'

export const SERVICE_NAME = 'process-service'

const CLIENT_IDLE_TIMEOUT_MS = 60000
const MODEL_MAX_AGE_MS = 60000

interface CachedClient {
  client: Promise<TxOperations>
  users: number
  modelLoadedAt?: number
  idleTimer?: ReturnType<typeof setTimeout>
}

const clients = new Map<WorkspaceUuid, CachedClient>()

export async function getClient (workspaceUuid: WorkspaceUuid, ctx?: MeasureContext): Promise<TxOperations> {
  let entry = clients.get(workspaceUuid)
  // Refresh the model between events even when frequent activity prevents idle eviction.
  if (
    entry !== undefined &&
    entry.users === 0 &&
    entry.modelLoadedAt !== undefined &&
    Date.now() - entry.modelLoadedAt >= MODEL_MAX_AGE_MS
  ) {
    void close(workspaceUuid, entry).catch((err) => {
      console.error(`Failed to close client for ${workspaceUuid}`, err)
    })
    entry = undefined
  }
  if (entry === undefined) {
    ctx?.counter('process_client_cache_misses', 1)
    entry = { client: createClient(workspaceUuid, ctx), users: 0 }
    clients.set(workspaceUuid, entry)
  } else {
    ctx?.counter('process_client_cache_hits', 1)
  }
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer)
    entry.idleTimer = undefined
  }
  entry.users++
  try {
    const client = await entry.client
    entry.modelLoadedAt ??= Date.now()
    return client
  } catch (err) {
    entry.users--
    if (clients.get(workspaceUuid) === entry) {
      clients.delete(workspaceUuid)
    }
    throw err
  }
}

export async function releaseClient (workspaceUuid: WorkspaceUuid): Promise<void> {
  const entry = clients.get(workspaceUuid)
  if (entry === undefined || entry.users === 0) {
    console.warn(`Client for ${workspaceUuid} not in use`)
    return
  }
  entry.users--
  if (entry.users === 0) {
    entry.idleTimer = setTimeout(() => {
      void close(workspaceUuid, entry).catch((err) => {
        console.error(`Failed to close client for ${workspaceUuid}`, err)
      })
    }, CLIENT_IDLE_TIMEOUT_MS)
  }
}

async function close (workspaceUuid: WorkspaceUuid, entry: CachedClient): Promise<void> {
  if (entry.users > 0 || clients.get(workspaceUuid) !== entry) return
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer)
  }
  clients.delete(workspaceUuid)
  const client = await entry.client
  await client.close()
}

async function createClient (workspaceUuid: WorkspaceUuid, ctx?: MeasureContext): Promise<TxOperations> {
  const token = generateToken(systemAccountUuid, workspaceUuid, { service: SERVICE_NAME })
  const accountClient = getAccountClient(config.AccountsUrl, token)

  const login = async (): ReturnType<typeof accountClient.getLoginInfoByToken> =>
    await accountClient.getLoginInfoByToken()
  const wsInfo = ctx === undefined ? await login() : await ctx.with('process.account-login', {}, login)
  if (wsInfo == null || !('endpoint' in wsInfo)) {
    throw new Error('Invalid login info')
  }
  const transactorUrl = wsInfo.endpoint.replace('ws://', 'http://').replace('wss://', 'https://')
  const create = async (): Promise<TxOperations> =>
    await createRestTxOperations(transactorUrl, wsInfo.workspace, wsInfo.token, true)
  const client = ctx === undefined ? await create() : await ctx.with('process.load-client-model', {}, create)
  return client
}
