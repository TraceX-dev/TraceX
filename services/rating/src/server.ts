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
/* eslint-disable @typescript-eslint/unbound-method */
import type { MeasureContext, Tx } from '@hcengineering/core'

import { setMetadata } from '@hcengineering/platform'
import {
  createPostgreeDestroyAdapter,
  createPostgresAdapter,
  createPostgresTxAdapter,
  setDBExtraOptions,
  shutdownPostgres
} from '@hcengineering/postgres'
import serverClientPlugin from '@hcengineering/server-client'
import { type PlatformQueue } from '@hcengineering/server-core'
import {
  registerAdapterFactory,
  registerDestroyFactory,
  registerServerPlugins,
  registerStringLoaders,
  registerTxAdapterFactory,
  setAdapterSecurity
} from '@hcengineering/server-pipeline'
import serverToken from '@hcengineering/server-token'

import { WorkspaceManager } from './manager'

// Register close on process exit.
process.on('exit', () => {
  shutdownPostgres().catch((err) => {
    console.error(err)
  })
})

export async function startIndexer (
  ctx: MeasureContext,
  opt: {
    queue: PlatformQueue
    model: Tx[]
    dbURL: string
    serverSecret: string
    accountsUrl: string
  }
): Promise<() => void> {
  const usePrepare = (process.env.DB_PREPARE ?? 'true') === 'true'

  setDBExtraOptions({
    prepare: usePrepare // We override defaults
  })

  setMetadata(serverToken.metadata.Secret, opt.serverSecret)
  setMetadata(serverToken.metadata.Service, 'rating')
  setMetadata(serverClientPlugin.metadata.Endpoint, opt.accountsUrl)

  registerTxAdapterFactory('postgresql', createPostgresTxAdapter, true)
  registerAdapterFactory('postgresql', createPostgresAdapter, true)
  registerDestroyFactory('postgresql', createPostgreeDestroyAdapter, true)
  setAdapterSecurity('postgresql', true)

  registerServerPlugins()
  registerStringLoaders()

  const manager = new WorkspaceManager(ctx, opt.model, { ...opt })
  await manager.startRatingCalculator()

  const close = (): void => {
    void manager.shutdown()
    void opt.queue.shutdown()
  }

  return close
}
