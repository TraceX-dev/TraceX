/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { createHash, timingSafeEqual } from 'crypto'
import { NextFunction, Request, RequestHandler, Response } from 'express'

function safeEqual (a: string, b: string): boolean {
  // Hash both values so the comparison is constant-time regardless of length
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function extractToken (req: Request): string | undefined {
  const header = req.headers.authorization
  if (typeof header === 'string') {
    const value = header.trim()
    if (value.slice(0, 7).toLowerCase() === 'bearer ') {
      const token = value.slice(7).trim()
      if (token !== '') return token
    }
  }
  // Legacy: token passed in JSON body as `apiKey`
  const bodyKey = (req.body as Record<string, unknown> | undefined)?.apiKey
  if (typeof bodyKey === 'string' && bodyKey !== '') {
    return bodyKey
  }
  return undefined
}

/**
 * Fail-closed authentication middleware.
 * If no token is configured, every request is rejected.
 */
export function requireAuth (expectedToken: string | undefined): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (expectedToken === undefined || expectedToken === '') {
      res.status(401).send({ err: 'Unauthorized: mail service auth token is not configured' })
      return
    }
    const token = extractToken(req)
    if (token === undefined || !safeEqual(token, expectedToken)) {
      res.status(401).send({ err: 'Unauthorized' })
      return
    }
    next()
  }
}
