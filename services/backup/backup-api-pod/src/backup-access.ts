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

import type { AccountClient } from '@hcengineering/account-client'
import { AccountRole, type WorkspaceIds } from '@hcengineering/core'
import { ApiError, accountLookupError, type AuditScope } from '@hcengineering/server-core'
import type { BackupStorage } from '@hcengineering/server-backup'
import type { Token } from '@hcengineering/server-token'
import type { IncomingHttpHeaders, ServerResponse } from 'http'

/**
 * Resolve the workspace whose backups the caller may read: only owners (or instance admins).
 * The cache is keyed by account and workspace: an entry proves that this account passed the owner check.
 * Keying by workspace alone would let any member reuse the owner's successful lookup.
 */
export async function authorizeBackupAccess (
  token: Token,
  accountClient: Pick<AccountClient, 'getLoginWithWorkspaceInfo' | 'getWorkspaceInfo'>,
  cache: Map<string, WorkspaceIds>
): Promise<WorkspaceIds> {
  const workspaceId = token.workspace
  const cacheKey = `${token.account}:${workspaceId}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) return cached

  const lookup = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call()
    } catch (err) {
      throw accountLookupError(err)
    }
  }
  const info = await lookup(async () => await accountClient.getLoginWithWorkspaceInfo())
  if (token.extra?.admin !== 'true') {
    const winfo = info.workspaces[workspaceId]
    if (winfo === undefined) {
      throw new ApiError(401, 'Invalid workspace', { reason: 'not_workspace_member' })
    }
    if (winfo.role !== AccountRole.Owner) {
      throw new ApiError(403, 'Not an owner of workspace', { reason: 'not_workspace_owner' })
    }
  }
  const wsInfo = await lookup(async () => await accountClient.getWorkspaceInfo())
  const result: WorkspaceIds = { url: wsInfo.url, dataId: wsInfo.dataId, uuid: workspaceId }
  cache.set(cacheKey, result)
  return result
}

/**
 * Stream a backup file and resolve when the transfer ends, so an abandoned download is detected by the audit
 * layer. A revalidation answered with 304 transferred no data and is not recorded as a download.
 */
export async function sendBackupFile (
  storage: Pick<BackupStorage, 'statInfo' | 'load'>,
  file: string,
  headers: IncomingHttpHeaders,
  res: ServerResponse,
  audit: AuditScope
): Promise<void> {
  const fileInfo = await storage.statInfo(file)
  if (fileInfo == null) {
    throw new ApiError(404, 'Not found', { reason: 'not_found' })
  }
  audit.set({ fileSize: fileInfo.size })

  const responseHeaders = {
    'content-type': fileInfo.contentType ?? 'application/octet-stream',
    'content-length': fileInfo.size.toString(),
    etag: fileInfo.etag,
    'last-modified': new Date(fileInfo.lastModified).toUTCString()
  }

  // Node lower-cases incoming header names.
  const ifNoneMatch = headers['if-none-match']
  const ifModifiedSince = headers['if-modified-since']
  if (
    ifNoneMatch === fileInfo.etag ||
    (ifModifiedSince !== undefined && fileInfo.lastModified <= parseInt(ifModifiedSince))
  ) {
    audit.skip()
    res.writeHead(304, responseHeaders).end()
    return
  }

  const stream = await storage.load(file)
  res.writeHead(200, responseHeaders)
  await new Promise<void>((resolve, reject) => {
    let streamError: unknown
    stream.once('error', (err) => {
      streamError = err
      res.destroy()
    })
    res.once('close', () => {
      stream.destroy()
      if (streamError !== undefined) reject(streamError)
      else resolve()
    })
    stream.pipe(res)
  })
}
