// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import card from '@hcengineering/card'
import type { AccountUuid } from '@hcengineering/core'
import {
  DefinitionPackageError,
  parseDefinitionPackageRelease,
  serializeDefinitionPackageRelease
} from '@hcengineering/marketplace'
import { getEmbeddedLabel } from '@hcengineering/platform'
import process from '@hcengineering/process'
import cors from 'cors'
import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import type { CatalogAccount } from './auth'
import { CatalogError } from './errors'
import type { CatalogStore } from './store'

export interface CatalogServerOptions {
  store: CatalogStore
  authenticate: (token: string) => Promise<CatalogAccount>
  onError: (error: unknown) => void
}

/** HTTP boundary for catalog discovery and immutable release publication. */
export function createCatalogServer ({ store, authenticate, onError }: CatalogServerOptions): express.Express {
  const app = express()
  app.disable('x-powered-by')
  app.use(
    cors({ methods: ['GET', 'POST'], allowedHeaders: ['Authorization', 'Content-Type', 'X-Marketplace-Contact-Email'] })
  )
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  function route (
    handler: (req: Request, res: Response, account: CatalogAccount) => Promise<void>
  ): express.RequestHandler {
    return (req, res, next) => {
      const token = /^Bearer (\S+)$/i.exec(req.header('Authorization') ?? '')?.[1]
      if (token === undefined) {
        next(new CatalogError(401, 'Authentication required'))
        return
      }
      authenticate(token)
        .then(async (account) => {
          await handler(req, res, account)
        })
        .catch(next)
    }
  }

  app.get(
    '/packages',
    route(async (req, res, account) => {
      res.json(
        await store.list({
          search: text(req.query.search, 'search', true).slice(0, 200),
          author: req.query.mine === 'true' ? account.uuid : undefined,
          offset: integer(req.query.offset, 0, 1000000),
          limit: integer(req.query.limit, 30, 100, 1)
        })
      )
    })
  )
  app.get(
    '/releases',
    route(async (req, res) => {
      res.json(await store.releases(identity(req), integer(req.query.offset, 0, 1000000)))
    })
  )
  app.get(
    '/release',
    route(async (req, res) => {
      const source = await store.download(
        identity(req),
        req.query.version === undefined ? undefined : text(req.query.version, 'version')
      )
      res.type('application/yaml').send(source)
    })
  )

  // Authenticate before reading/compiling the bounded YAML body.
  app.post(
    '/releases',
    route(async (req, res, account) => {
      await new Promise<void>((resolve, reject) => {
        express.text({ type: ['application/yaml', 'text/yaml'], limit: '3mb' })(req, res, (error?: unknown) => {
          if (error !== undefined) reject(error)
          else resolve()
        })
      })
      if (typeof req.body !== 'string') throw new CatalogError(415, 'Send a package as application/yaml')
      const release = await parseDefinitionPackageRelease(req.body)
      if (release.package.author !== account.uuid)
        {throw new CatalogError(403, 'Only the package author can publish releases')}
      if (
        release.package.id.length > 200 ||
        release.package.version.length > 100 ||
        (release.package.description?.length ?? 0) > 10000
      ) {
        throw new CatalogError(400, 'Package metadata is too long')
      }
      const contactEmail = (req.header('X-Marketplace-Contact-Email') ?? '').trim()
      const [local, domain, extra] = contactEmail.split('@')
      if (
        contactEmail.length > 254 ||
        (contactEmail !== '' &&
          (!local ||
            !domain ||
            extra !== undefined ||
            !domain.includes('.') ||
            domain.startsWith('.') ||
            domain.endsWith('.') ||
            /\s/.test(contactEmail)))
      ) {
        throw new CatalogError(400, 'Enter a valid contact email or leave it empty')
      }
      const names = release.definition.docs
        .filter(
          (doc) => doc._class === (release.definition.kind === 'card' ? card.class.MasterTag : process.class.Process)
        )
        .map((doc) => {
          const label = String(doc.name ?? doc.label ?? doc._id)
          const prefix = getEmbeddedLabel('')
          return label.startsWith(prefix) ? label.slice(prefix.length) : label
        })
      res.status(201).json(
        await store.publish({
          id: release.package.id,
          author: account.uuid,
          name: names.join(', ').slice(0, 300) || release.package.id,
          description: release.package.description ?? '',
          kind: release.definition.kind,
          version: release.package.version,
          authorName: account.name,
          ...(contactEmail === '' ? {} : { contactEmail }),
          contentHash: release.contentHash,
          source: serializeDefinitionPackageRelease(release),
          publishedOn: Date.now()
        })
      )
    })
  )

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof CatalogError) {
      res.status(error.status).json({ message: error.message })
      return
    }
    if (error instanceof DefinitionPackageError || (error instanceof Error && error.name === 'ProcessAuthoringError')) {
      res.status(400).json({ message: error.message })
      return
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ message: 'Release artifact exceeds 3 MiB' })
      return
    }
    onError(error)
    res.status(500).json({ message: 'Marketplace request failed' })
  }
  app.use(errorHandler)
  return app
}

function text (value: unknown, field: string, optional = false): string {
  if (optional && (value === undefined || value === '')) return ''
  if (typeof value !== 'string' || value.trim() === '' || value.length > 500)
    {throw new CatalogError(400, `Invalid ${field}`)}
  return value
}

function integer (value: unknown, fallback: number, max: number, min = 0): number {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new CatalogError(400, 'Invalid pagination')
  }
  return Number(value)
}

function identity (req: Request): { id: string, author: AccountUuid } {
  const author = text(req.query.author, 'author')
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(author)) throw new CatalogError(400, 'Invalid author')
  return { id: text(req.query.id, 'id'), author: author as AccountUuid }
}
