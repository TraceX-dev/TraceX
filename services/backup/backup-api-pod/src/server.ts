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

import { Analytics } from '@hcengineering/analytics'
import {
  MeasureContext,
  metricsAggregate,
  type WorkspaceDataId,
  type WorkspaceIds,
  type WorkspaceUuid
} from '@hcengineering/core'
import {
  ApiError,
  auditActorFromToken,
  getCPUInfo,
  getMemoryInfo,
  sendApiError,
  withAuditedResponse,
  type AuditScope
} from '@hcengineering/server-core'
import { decodeToken, readToken, Token, TokenError } from '@hcengineering/server-token'

import cors from 'cors'
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { type Server } from 'http'
import morgan from 'morgan'

import { getClient } from '@hcengineering/account-client'
import { createStorageBackupStorage, type BackupInfo, type BackupStorage } from '@hcengineering/server-backup'
import { createStorageFromConfig, storageConfigFromEnv } from '@hcengineering/server-storage'
import { gunzipSync } from 'zlib'
import { Config } from './config'
import { authorizeBackupAccess, sendBackupFile } from './backup-access'

import { clearInterval } from 'timers'

const KEEP_ALIVE_TIMEOUT = 5 // seconds
const KEEP_ALIVE_MAX = 1000

const cacheControlNoCache = 'public, no-store, no-cache, must-revalidate, max-age=0'

export const keepAlive = (options: { timeout: number, max: number }): RequestHandler => {
  const { timeout, max } = options
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('Keep-Alive', `timeout=${timeout}, max=${max}`)
    next()
  }
}

async function traverseBackup (
  ctx: MeasureContext,
  storage: BackupStorage,
  snapshot: (date: number) => void,
  addFile: (name: string, size?: number) => void,
  addBlobInfo: (info: Record<string, [string, number]>) => void
): Promise<BackupInfo | undefined> {
  const infoFile = 'backup.json.gz'
  const sizeFile = 'backup.size.gz'
  const blobInfoFile = 'blob-info.json.gz'

  const backupInfoFile = await storage.loadFile(infoFile)

  if (backupInfoFile == null) {
    return
  }
  const backupInfo: BackupInfo = JSON.parse(gunzipSync(backupInfoFile).toString())
  console.log('workspace:', backupInfo.workspace ?? '', backupInfo.version)

  let sizeInfo: Record<string, number> = {}
  try {
    const backupSizeFile = await storage.loadFile(sizeFile)
    if (backupSizeFile != null) {
      sizeInfo = JSON.parse(gunzipSync(backupSizeFile).toString())
    }
  } catch (err: any) {
    console.error('failed to load size file', err)
  }

  let blobInfo: Record<string, [string, number]> = {}
  try {
    const blobInfoData = await storage.loadFile(blobInfoFile)
    if (blobInfoData != null) {
      blobInfo = JSON.parse(gunzipSync(blobInfoData).toString())
    }
  } catch (err: any) {
    console.error('failed to load size file', err)
  }

  const addFileSize = async (file: string | undefined | null): Promise<void> => {
    if (file != null) {
      addFile(file, sizeInfo?.[file])
    }
  }

  // Let's calculate data size for backup
  for (const sn of backupInfo.snapshots) {
    for (const [, d] of Object.entries(sn.domains)) {
      snapshot(sn.date)
      await addFileSize(d.snapshot)
      for (const snp of d.snapshots ?? []) {
        await addFileSize(snp)
      }
      for (const snp of d.storage ?? []) {
        await addFileSize(snp)
      }
    }
  }
  sizeInfo[infoFile] = backupInfoFile.length
  await addFileSize(infoFile)
  addBlobInfo(blobInfo)
  return backupInfo
}

export async function createServer (ctx: MeasureContext, config: Config): Promise<{ app: Express, close: () => void }> {
  const backupStorageConfig = storageConfigFromEnv(config.Storage)
  const storageAdapter = createStorageFromConfig(backupStorageConfig.storages[0])

  const app = express()
  app.disable('x-powered-by')
  app.use(cors({}))
  app.use(express.json({ limit: '50mb' }))
  app.use(keepAlive({ timeout: KEEP_ALIVE_TIMEOUT, max: KEEP_ALIVE_MAX }))

  const childLogger = ctx.logger.childLogger?.('requests', { enableConsole: 'true' })
  const requests = ctx.newChild('requests', {}, { logger: childLogger, span: false })
  class LogStream {
    write (text: string): void {
      requests.info(text)
    }
  }

  app.use(morgan('short', { stream: new LogStream() }))

  // See authorizeBackupAccess: keyed by account and workspace.
  const wsInfoCache = new Map<string, WorkspaceIds>()

  const wsInfoCacheInterval = setInterval(
    () => {
      wsInfoCache.clear()
    },
    15 * 60 * 1000
  )

  async function handleBackup (
    request: Request<any>,
    res: Response<any>,
    token: string,
    decodedToken: Token,
    audit: AuditScope
  ): Promise<void> {
    const headers = request.headers
    const workspace = request.params.workspace ?? ''
    const file: string | undefined = request.params.file

    const wsInfo = await authorizeBackupAccess(decodedToken, getClient(config.AccountsUrl, token), wsInfoCache)

    const dataId = wsInfo.dataId ?? (wsInfo.uuid as unknown as WorkspaceDataId)
    const storage = await createStorageBackupStorage(
      ctx,
      storageAdapter,
      {
        uuid: config.Bucket as WorkspaceUuid,
        url: config.Bucket,
        dataId: config.Bucket as WorkspaceDataId
      },
      dataId,
      false
    )

    if (file === undefined || file === '' || file === 'index.html') {
      audit.skip()
      let backupInfoHTML = `Backup info for workspace ${workspace}.<br/>`
      let data: BackupInfo | undefined
      try {
        data = await traverseBackup(
          ctx,
          storage,
          (snapshot) => {
            backupInfoHTML += `<h2>Snapshot: ${new Date(snapshot).toString()} </h2></br>`
          },
          (name, size) => {
            backupInfoHTML += `<span><a href="${name}">${name}</a> Size: ${size ?? 'unknown'}  <a href="${
              name + '.hash'
            }">etag</a><br/></span>\n`
          },
          (info) => {}
        )
      } catch (err: any) {
        backupInfoHTML += `Error: ${err.message}`
      }
      res
        .status(200)
        .set({
          'content-type': 'text/html',
          etag: data?.lastTxId ?? ''
        })
        .end(backupInfoHTML)
      return
    }
    if (file === 'index.json') {
      audit.skip()
      const jsonData: {
        files: { name: string, size?: number }[]
        extraBlobs: { name: string, size: number, contentType: string }[]
        extraBlobsTotal: number
        error?: string
        info?: BackupInfo
      } = {
        files: [],
        extraBlobs: [],
        extraBlobsTotal: 0
      }

      try {
        jsonData.info = await traverseBackup(
          ctx,
          storage,
          (snapshot) => {},
          (name, size) => {
            jsonData.files.push({ name, size })
          },
          (info) => {
            for (const [name, [contentType, size]] of Object.entries(info)) {
              jsonData.extraBlobsTotal += 1
              if (contentType !== undefined && !contentType.includes('video/mp2t')) {
                jsonData.extraBlobs.push({ name, size, contentType })
                if (jsonData.extraBlobs.length > 11000) {
                  jsonData.extraBlobs.sort((a, b) => b.size - a.size)
                  jsonData.extraBlobs = jsonData.extraBlobs.slice(0, 10000)
                }
              }
            }
          }
        )
      } catch (err: any) {
        console.error(err)
        jsonData.error = `Error: ${err.message}`
      }

      res
        .status(200)
        .set({
          'content-type': 'application/json',
          etag: jsonData.info?.lastTxId ?? ''
        })
        .end(JSON.stringify(jsonData))
      return
    }

    if (file.endsWith('.hash')) {
      audit.skip()
      const fileInfo = await storage.statInfo(file.slice(0, file.length - 5))
      if (fileInfo == null) {
        throw new ApiError(404, 'Not found')
      }
      res.status(200).set({ 'content-type': 'text/plain' }).end(fileInfo.etag)
      return
    }

    await sendBackupFile(storage, file, headers, res, audit)
  }

  /** Backup access is audited in one place: downloads and every denial, never the listings. */
  async function handleAuditedBackup (request: Request<any>, res: Response<any>): Promise<void> {
    let token: string | undefined
    let decodedToken: Token | undefined
    try {
      token = readToken(request.headers)
      if (token !== undefined) {
        decodedToken = decodeToken(token)
      }
    } catch {}
    if (token === undefined || decodedToken === undefined) {
      // No verified caller: nothing to attribute the attempt to.
      throw new ApiError(401, 'Unauthorized')
    }
    const verifiedToken = token
    const verified = decodedToken
    const event = {
      event: 'workspace.backup.download',
      ...auditActorFromToken(verifiedToken),
      targetType: 'backup',
      fileName: request.params.file ?? ''
    } as const
    await withAuditedResponse(ctx, event, res, async (audit) => {
      try {
        await handleBackup(request, res, verifiedToken, verified, audit)
      } catch (err: unknown) {
        if (err instanceof ApiError) throw err
        throw new ApiError(500, 'Backup request failed', { cause: err })
      }
    })
  }

  app.get('/api/backup/:workspace/:file(*)', (req, res) => {
    void handleAuditedBackup(req, res).catch((err) => {
      if (!(err instanceof ApiError) || err.code >= 500) console.error('request error', err)
      sendApiError(err, res)
    })
  })

  app.get('/', (req, res) => {
    res.send(`Huly&reg; Backup&trade; <a href="https://huly.io">https://huly.io</a>
      &copy; 2024 <a href="https://hulylabs.com">Huly Labs</a>`)
  })

  const sendErrorToAnalytics = (err: any): boolean => {
    const ignoreMessages = [
      'Unexpected end of form', // happens when the client closes the connection before the upload is complete
      'Premature close', // happens when the client closes the connection before the upload is complete
      'File too large' // happens when the file exceeds the limit set by express-fileupload
    ]

    return !ignoreMessages.includes(err.message)
  }

  app.use((err: any, _req: any, res: any, _next: any) => {
    ctx.error(err.message, { code: err.code, message: err.message })
    if (err instanceof ApiError) {
      res.status(err.code).send({ code: err.code, message: err.message })
      return
    }

    // do not send some errors to analytics
    if (sendErrorToAnalytics(err)) {
      Analytics.handleError(err)
    }

    res.status(500).json({ message: err.message?.length > 0 ? err.message : 'Internal Server Error' })
  })

  app.get('/api/v1/statistics', (req, res) => {
    try {
      const token = req.query.token as string
      const payload = decodeToken(token)
      const admin = payload.extra?.admin === 'true'
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('Keep-Alive', 'timeout=5')
      res.setHeader('Cache-Control', cacheControlNoCache)

      const json = JSON.stringify({
        metrics: metricsAggregate((ctx as any).metrics),
        statistics: {
          cpu: getCPUInfo(),
          memory: getMemoryInfo()
        },
        admin
      })
      res.status(200).send(json)
    } catch (err: any) {
      if (err instanceof TokenError) {
        res.status(401).send()
        return
      }
      ctx.error('statistics error', { err })
      Analytics.handleError(err)
      res.status(404).send()
    }
  })

  app.get('/', (_req, res) => {
    res.send(`
      Huly® Datalake™ <a href="https://huly.io">https://huly.io</a>
      © 2025 <a href="https://hulylabs.com">Huly Labs</a>
    `)
  })

  app.use((_req, res) => {
    res.status(404).json({ message: 'Not Found' })
  })

  return {
    app,
    close: () => {
      clearInterval(wsInfoCacheInterval)
    }
  }
}

export function listen (e: Express, port: number, host?: string): Server {
  const cb = (): void => {
    console.log(`Service started at ${host ?? '*'}:${port}`)
  }

  const server = host !== undefined ? e.listen(port, host, cb) : e.listen(port, cb)
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT * 1000 + 1000
  server.headersTimeout = KEEP_ALIVE_TIMEOUT * 1000 + 2000

  return server
}
