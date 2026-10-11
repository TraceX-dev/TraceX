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
import { Analytics } from '@hcengineering/analytics'
import type {
  Class,
  Doc,
  DocumentQuery,
  MeasureContext,
  Ref,
  SearchOptions,
  SearchQuery,
  Tx
} from '@hcengineering/core'

import { setMetadata } from '@hcengineering/platform'
import {
  createPostgreeDestroyAdapter,
  createPostgresAdapter,
  createPostgresTxAdapter,
  setDBExtraOptions,
  shutdownPostgres
} from '@hcengineering/postgres'
import serverClientPlugin from '@hcengineering/server-client'
import serverCore, { workspaceEvents, type PlatformQueue, type StorageAdapter } from '@hcengineering/server-core'
import { searchFulltext, type FulltextDBConfiguration } from '@hcengineering/server-indexer'
import {
  registerAdapterFactory,
  registerDestroyFactory,
  registerServerPlugins,
  registerStringLoaders,
  registerTxAdapterFactory,
  setAdapterSecurity
} from '@hcengineering/server-pipeline'
import serverToken, { decodeToken } from '@hcengineering/server-token'
import cors from '@koa/cors'
import Koa from 'koa'
import bodyParser from 'koa-bodyparser'
import Router from 'koa-router'

import { WorkspaceManager } from './manager'

interface IndexDocuments {
  token: string
  requests: {
    _class: Ref<Class<Doc>>
    _id: Ref<Doc>
  }[]
}

interface FulltextSearch {
  token: string
  query: SearchQuery
  options: SearchOptions
}

interface Search {
  token: string
  _classes: Ref<Class<Doc>>[]
  query: DocumentQuery<Doc>
  fullTextLimit: number
}

interface Reindex {
  token: string
  onlyDrop?: boolean
}
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
    hulylakeUrl: string
    config: FulltextDBConfiguration
    externalStorage: StorageAdapter
    elasticIndexName: string
    port: number
    serverSecret: string
    accountsUrl: string
  }
): Promise<() => void> {
  const usePrepare = (process.env.DB_PREPARE ?? 'true') === 'true'

  setDBExtraOptions({
    prepare: usePrepare // We override defaults
  })

  setMetadata(serverToken.metadata.Secret, opt.serverSecret)
  setMetadata(serverToken.metadata.Service, 'fulltext')
  setMetadata(serverCore.metadata.ElasticIndexName, opt.elasticIndexName)
  setMetadata(serverClientPlugin.metadata.Endpoint, opt.accountsUrl)

  registerTxAdapterFactory('postgresql', createPostgresTxAdapter, true)
  registerAdapterFactory('postgresql', createPostgresAdapter, true)
  registerDestroyFactory('postgresql', createPostgreeDestroyAdapter, true)
  setAdapterSecurity('postgresql', true)

  registerServerPlugins()
  registerStringLoaders()

  const app = new Koa()
  const router = new Router()

  const manager = new WorkspaceManager(ctx, opt.model, { ...opt })
  await manager.startIndexer()
  app.use(
    cors({
      credentials: true
    })
  )
  app.use(bodyParser())

  router.put('/api/v1/search', async (req, res) => {
    try {
      const request = req.request.body as Search
      const token = request.token ?? req.headers.authorization?.split(' ')[1]
      const decoded = decodeToken(token) // Just to be safe

      await ctx.with(
        'search',
        {},
        async (ctx) => {
          req.body = await manager.fulltextAdapter.search(
            ctx,
            decoded.workspace,
            request._classes,
            request.query,
            request.fullTextLimit
          )
        },
        {
          workspace: decoded.workspace,
          classes: request._classes
        }
      )
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      req.res.writeHead(404, {})
      req.res.end()
    }
  })

  router.put('/api/v1/full-text-search', async (req, res) => {
    try {
      const request = req.request.body as FulltextSearch
      const token = request.token ?? req.headers.authorization?.split(' ')[1]
      const decoded = decodeToken(token) // Just to be safe
      await ctx.with(
        'full-text-search',
        {},
        async (ctx) => {
          const searched = await manager.withIndexer(ctx, decoded.workspace, token, true, async (indexer) => {
            indexer.lastUpdate = Date.now()
            req.body = await searchFulltext(
              ctx,
              decoded.workspace,
              indexer.fulltext.hierarchy,
              manager.fulltextAdapter,
              request.query,
              request.options
            )
          })
          if (!searched) {
            throw new Error('Failed to initialize workspace search indexer')
          }
        },
        {
          workspace: decoded.workspace
        }
      )
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      req.res.writeHead(404, {})
      req.res.end()
    }
  })

  router.put('/api/v1/close', async (req, res) => {
    try {
      const request = req.request.body as IndexDocuments
      const token = request.token ?? req.headers.authorization?.split(' ')[1]
      const decoded = decodeToken(token) // Just to be safe
      req.body = {}

      ctx.info('close', { workspace: decoded.workspace })
      await manager.closeWorkspace(decoded.workspace)
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      req.res.writeHead(404, {})
      req.res.end()
    }
  })

  router.put('/api/v1/index-documents', async (req, res) => {
    try {
      const request = req.request.body as IndexDocuments
      const token = request.token ?? req.headers.authorization?.split(' ')[1]
      const decoded = decodeToken(token) // Just to be safe

      await manager.withIndexer(ctx, decoded.workspace, token, false, async (indexer) => {
        indexer.lastUpdate = Date.now()
      })
      req.body = {}
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      req.res.writeHead(404, {})
      req.res.end()
    }
  })

  router.put('/api/v1/reindex', async (req, res) => {
    try {
      const request = req.request.body as Reindex
      const token = request.token ?? req.headers.authorization?.split(' ')[1]
      const decoded = decodeToken(token) // Just to be safe
      req.body = {}

      ctx.info('reindex', { workspace: decoded.workspace })
      await ctx.with(
        'reindex',
        {},
        async (ctx) => {
          await manager.withIndexer(ctx, decoded.workspace, token, true, async (indexer) => {
            indexer.lastUpdate = Date.now()
            if (request?.onlyDrop ?? false) {
              await manager.fulltextProducer.send(ctx, decoded.workspace, [workspaceEvents.clearIndex()])
            } else {
              await manager.fulltextProducer.send(ctx, decoded.workspace, [workspaceEvents.fullReindex()])
            }
          })
        },
        {},
        {
          span: 'inherit'
        }
      )
    } catch (err: any) {
      Analytics.handleError(err)
      console.error(err)
      req.res.writeHead(404, {})
      req.res.end()
    }
  })

  app.use(router.routes()).use(router.allowedMethods())

  const server = app.listen(opt.port, () => {
    console.log(`server started on port ${opt.port}`)
  })

  const close = (): void => {
    void manager.shutdown()
    void opt.queue.shutdown()
    server.close()
  }

  return close
}
