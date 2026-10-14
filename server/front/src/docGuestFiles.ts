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

import core, { docGuestAccountUuid, type Blob, type Client, type Ref, type WorkspaceIds } from '@hcengineering/core'
import { decodeToken } from '@hcengineering/server-token'

/** Public link a shared-link (DocGuest) token is bound to, `undefined` for any other token. */
export function getDocGuestLinkId (token: string): string | undefined {
  try {
    const payload = decodeToken(token)
    if (payload.account !== docGuestAccountUuid) return undefined
    // A DocGuest token without a link is bound to nothing.
    return typeof payload.extra?.linkId === 'string' ? payload.extra.linkId : ''
  } catch {
    return undefined
  }
}

/** Guest and read-only tokens must not change stored files. */
export function canTokenWriteFiles (token: string): boolean {
  try {
    const payload = decodeToken(token)
    return (
      payload.account !== docGuestAccountUuid && payload.extra?.guest !== 'true' && payload.extra?.readonly !== 'true'
    )
  } catch {
    return false
  }
}

export interface DocGuestFileCheckerOptions {
  /** Transactor endpoint of the workspace. */
  resolveEndpoint: (wsIds: WorkspaceIds) => Promise<string>
  connect: (endpoint: string, token: string) => Promise<Pick<Client, 'findOne' | 'close'>>
  allowedTtlMs?: number
  deniedTtlMs?: number
  now?: () => number
}

export interface DocGuestFileChecker {
  canRead: (wsIds: WorkspaceIds, token: string, file: string) => Promise<boolean>
}

/**
 * Lets a DocGuest read only files of the document its public link points to.
 *
 * The decision is made by the transactor: the file is readable if the guest's own session can read its `Blob`,
 * and `DocGuestMiddleware` exposes only blobs referenced from the linked document and its attachments.
 */
export function createDocGuestFileChecker (options: DocGuestFileCheckerOptions): DocGuestFileChecker {
  const allowedTtl = options.allowedTtlMs ?? 60_000
  const deniedTtl = options.deniedTtlMs ?? 5_000
  const now = options.now ?? Date.now
  const cache = new Map<string, { allowed: boolean, until: number }>()

  return {
    async canRead (wsIds, token, file) {
      const linkId = getDocGuestLinkId(token)
      if (linkId === undefined || linkId === '') return false

      const key = `${wsIds.uuid}:${linkId}:${file}`
      const cached = cache.get(key)
      if (cached !== undefined && cached.until > now()) return cached.allowed

      let allowed = false
      try {
        const client = await options.connect(await options.resolveEndpoint(wsIds), token)
        try {
          allowed = (await client.findOne(core.class.Blob, { _id: file as Ref<Blob> })) !== undefined
        } finally {
          await client.close()
        }
      } catch {
        // Unknown means no access; the failure is not cached.
        return false
      }

      if (cache.size > 5000) cache.clear()
      cache.set(key, { allowed, until: now() + (allowed ? allowedTtl : deniedTtl) })
      return allowed
    }
  }
}
