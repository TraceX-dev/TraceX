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
import {
  Hierarchy,
  ModelDb,
  systemAccountUuid,
  type MeasureMetricsContext,
  type WorkspaceIds,
  type WorkspaceUuid
} from '@hcengineering/core'
import {
  BroadcastMiddleware,
  DBAdapterInitMiddleware,
  DBAdapterMiddleware,
  DomainFindMiddleware,
  DomainTxMiddleware,
  FullTextMiddleware,
  LowLevelMiddleware,
  ModelMiddleware,
  QueryJoinMiddleware,
  QueueMiddleware,
  TxMiddleware
} from '@hcengineering/middleware'
import {
  createDummyStorageAdapter,
  createPipeline,
  type MiddlewareCreator,
  type Pipeline,
  type PipelineContext,
  type PlatformQueue
} from '@hcengineering/server-core'
import {
  createEmptyBroadcastOps,
  getConfig,
  registerAdapterFactory,
  registerDestroyFactory,
  registerServerPlugins,
  registerStringLoaders,
  registerTxAdapterFactory,
  setAdapterSecurity
} from '@hcengineering/server-pipeline'
import serverToken, { generateToken } from '@hcengineering/server-token'
import { randomUUID } from 'crypto'

/* eslint-disable @typescript-eslint/unbound-method */

import { setMetadata } from '@hcengineering/platform'
import {
  createPostgreeDestroyAdapter,
  createPostgresAdapter,
  createPostgresTxAdapter,
  setDBExtraOptions
} from '@hcengineering/postgres'
import serverClientPlugin from '@hcengineering/server-client'
import serverCore from '@hcengineering/server-core'

import { createElasticAdapter } from '@hcengineering/elastic'
import type { FulltextDBConfiguration } from '@hcengineering/server-indexer'
import { genMinModel } from './minmodel'
export const model = genMinModel()

export async function preparePipeline (
  toolCtx: MeasureMetricsContext,
  queue: PlatformQueue,
  useBroadcast: boolean = true // If not passed wll not do broadcast so queue will not be triggered.
): Promise<{ pipeline: Pipeline, wsIds: WorkspaceIds }> {
  const wsId: WorkspaceUuid = randomUUID().toString() as WorkspaceUuid
  const wsIds: WorkspaceIds = {
    uuid: wsId,
    url: wsId
  }
  const storage = createDummyStorageAdapter()
  const conf = getConfig(toolCtx, dbUrl, toolCtx, {
    externalStorage: storage,
    disableTriggers: true,
    usePassedCtx: true
  })

  const middlewares: MiddlewareCreator[] = [
    TxMiddleware.create, // Store tx into transaction domain
    FullTextMiddleware.create('', generateToken(systemAccountUuid, wsIds.uuid, { service: 'fulltext' })),
    LowLevelMiddleware.create,
    QueryJoinMiddleware.create,
    DomainFindMiddleware.create,
    DomainTxMiddleware.create,
    QueueMiddleware.create(queue),
    DBAdapterInitMiddleware.create,
    ModelMiddleware.create(model),
    DBAdapterMiddleware.create(conf), // Configure DB adapters
    ...(useBroadcast ? [BroadcastMiddleware.create(createEmptyBroadcastOps())] : [])
  ]

  const hierarchy = new Hierarchy()
  const modelDb = new ModelDb(hierarchy)
  const context: PipelineContext = {
    workspace: wsIds,
    branding: null,
    modelDb,
    hierarchy,
    storageAdapter: storage,
    contextVars: {}
  }
  const pipeline = await createPipeline(toolCtx, middlewares, context)
  return { pipeline, wsIds }
}

export const fullTextDbURL = 'http://localhost:9201'
export const dbUrl = 'postgresql://postgres:postgres@localhost:5433/postgres'
export const elasticIndexName = 'testing'

export function prepare (): void {
  setDBExtraOptions({
    prepare: true // We override defaults
  })

  setMetadata(serverToken.metadata.Secret, 'secret')
  setMetadata(serverCore.metadata.ElasticIndexName, elasticIndexName)
  setMetadata(serverClientPlugin.metadata.Endpoint, 'http://localhost:3003')

  registerTxAdapterFactory('postgresql', createPostgresTxAdapter, true)
  registerAdapterFactory('postgresql', createPostgresAdapter, true)
  registerDestroyFactory('postgresql', createPostgreeDestroyAdapter, true)
  setAdapterSecurity('postgresql', true)

  registerServerPlugins()
  registerStringLoaders()
}

export const dbConfig: FulltextDBConfiguration = {
  fulltextAdapter: {
    factory: createElasticAdapter,
    url: fullTextDbURL
  },
  contentAdapters: {
    Rekoni: {
      factory: async (url) => ({
        content: async () => ''
      }),
      contentType: '*',
      url: ''
    }
  },
  defaultContentAdapter: 'Rekoni'
}
