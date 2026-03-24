//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { Class, Doc, makeCollabId, Markup, MeasureContext, Ref, Space } from '@hcengineering/core'
import { type Card } from '@hcengineering/card'
import { saveCollabJson } from '@hcengineering/collaboration'
import { buildStorageFromConfig, storageConfigFromEnv } from '@hcengineering/server-storage'
import { htmlToJSON, jsonToMarkup } from '@hcengineering/text'
import { markdownToMarkup } from '@hcengineering/text-markdown'

import cors from 'cors'
import express, { type Express, type NextFunction, type Response } from 'express'
import { type Server } from 'http'

import { type Config } from './config'
import { type RequestWithAuth, errorHandler, keepAlive, withAuthorization } from './middleware'
import { isValidRegulatoryDocument, type RegulatoryDocument } from './types'
import { getClient } from './client'
import { getAttributeMapping } from './attributeMapping'
import { readToken } from '@hcengineering/server-client'

const KEEP_ALIVE_TIMEOUT = 5 // seconds
const KEEP_ALIVE_MAX = 1000

type AsyncRequestHandler = (ctx: MeasureContext, req: RequestWithAuth, res: Response) => Promise<void>

const handleRequest = async (
  ctx: MeasureContext,
  name: string,
  fn: AsyncRequestHandler,
  req: RequestWithAuth,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const source = req.token?.extra?.service ?? 'user'
    await ctx.with(name, { source }, (ctx) => {
      return fn(ctx, req, res)
    })
  } catch (err: unknown) {
    next(err)
  }
}

export async function createServer (ctx: MeasureContext, config: Config): Promise<{ app: Express, close: () => void }> {
  const app = express()

  const storageAdapter = buildStorageFromConfig(storageConfigFromEnv())

  app.use(
    cors({
      maxAge: 86400
    })
  )
  app.use(express.json({ limit: '10mb' }))
  app.use(keepAlive({ timeout: KEEP_ALIVE_TIMEOUT, max: KEEP_ALIVE_MAX }))

  const wrapRequest =
    (ctx: MeasureContext, name: string, fn: AsyncRequestHandler) =>
      (req: RequestWithAuth, res: Response, next: NextFunction) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
        handleRequest(ctx, name, fn, req, res, next)
      }

  const mapping = getAttributeMapping()

  app.put(
    '/v1/document',
    withAuthorization,
    wrapRequest(ctx, 'createDocument', async (ctx, req, res) => {
      const token = readToken(req.headers)
      const document = req.body as RegulatoryDocument

      // Validate document structure
      if (!isValidRegulatoryDocument(document)) {
        res.status(400).json({ message: 'Invalid document structure' })
        return
      }

      const workspace = req.token?.workspace
      if (workspace === undefined) {
        res.status(401).json({ message: 'Workspace not found in token' })
        return
      }

      ctx.info('Received regulatory document', {
        workspace,
        document: {
          uuid: document.uuid,
          title: document.title,
          date: document.date
        }
      })

      let markup: Markup = ''
      switch (document.summary.type) {
        case 'html':
          markup = jsonToMarkup(htmlToJSON(document.summary.content))
          break
        case 'markdown':
          markup = jsonToMarkup(markdownToMarkup(document.summary.content, { refUrl: '', imageUrl: '' }))
          break
      }

      try {
        const objectClass = config.DocumentClass as Ref<Class<Doc>>
        const objectId = document.uuid as Ref<Doc>
        const objectSpace = 'card:space:Default' as Ref<Space>

        // Get workspace client
        const txOps = await getClient(workspace, token)

        const wsIds = { uuid: workspace, url: '' }
        const collabId = makeCollabId(objectClass, objectId, 'description')
        const contentId = await saveCollabJson(ctx, storageAdapter, wsIds, collabId, markup)

        // Convert summary to markup format based on type
        let summaryMarkup = document.summary.content
        if (document.summary.type === 'html') {
          // Keep HTML as-is
          summaryMarkup = document.summary.content
        } else if (document.summary.type === 'markdown') {
          // For markdown, we could convert it to HTML or keep as-is
          // For now, keeping as-is
          summaryMarkup = document.summary.content
        }

        const ops = txOps.apply(document.uuid)

        const current = await ops.findOne(objectClass, { _id: objectId })

        if (current != null) {
          await ops.diffUpdate<Card>(
            current,
            {
              title: document.title,
              content: contentId,
              [mapping.dateAttribute]: new Date(document.date).getTime(),
              [mapping.externalLinkAttribute]: document.externalLink,
              [mapping.qalicoLinkAttribute]: document.qalicoLink,
              [mapping.applicabilityAttribute]: document.applicability
            }
          )
        } else {
          await ops.createDoc<Doc>(
            objectClass,
            objectSpace,
            {
              title: document.title,
              content: contentId,
              [mapping.dateAttribute]: new Date(document.date).getTime(),
              [mapping.externalLinkAttribute]: document.externalLink,
              [mapping.qalicoLinkAttribute]: document.qalicoLink,
              [mapping.applicabilityAttribute]: document.applicability
            },
            objectId
          )
        }

        await ops.commit()

        // Create document in the platform with collaborative summary
        ctx.info('document created', {
          workspace,
          uuid: document.uuid,
          title: document.title
        })

        res.status(201).json({
          message: 'Document created successfully'
        })
      } catch (err: any) {
        ctx.error('Failed to create document', {
          error: err.message,
          stack: err.stack
        })
        res.status(500).json({
          message: 'Failed to create document',
          error: err.message
        })
      }
    })
  )

  app.get('/', (_req, res) => {
    res.send(`
      TraceX&reg; Qalico Service&trade; <a href="https://tracex.co">https://tracex.co</a>
      &copy; 2026 <a href="https://tracex.co">TraceX</a>
    `)
  })

  app.use((req, res) => {
    res.status(404).json({ message: 'Not Found' })
  })

  app.use(errorHandler({ ctx }))

  return {
    app,
    close: () => {}
  }
}

export function listen (e: Express, port: number, host?: string): Server {
  const cb = (): void => {
    console.log(`Qalico Service started at ${host ?? '*'}:${port}`)
  }

  const server = host !== undefined ? e.listen(port, host, cb) : e.listen(port, cb)
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT * 1000 + 1000
  server.headersTimeout = KEEP_ALIVE_TIMEOUT * 1000 + 2000

  return server
}
