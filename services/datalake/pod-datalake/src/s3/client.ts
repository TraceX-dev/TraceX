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

import { S3 } from '@aws-sdk/client-s3'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { Agent as HttpAgent } from 'http'
import { Agent as HttpsAgent } from 'https'
import type { Socket } from 'net'

/**
 * Keep-alive connections are reused for many requests. If one of them is pinned to an unhealthy
 * backend node behind the storage gateway, every request that lands on it keeps failing with 5xx
 * until the process is restarted. To avoid that:
 *  - a connection that has just served a 5xx response is never reused (closed instead of returned to the pool);
 *  - a connection older than MAX_SOCKET_AGE_MS is not reused either, so the pool is refreshed periodically.
 */
const MAX_SOCKET_AGE_MS = 60_000

const CREATED_AT = Symbol('createdAt')
const DISCARD = Symbol('discard')

type TrackedSocket = Socket & { [CREATED_AT]?: number, [DISCARD]?: boolean }

function shouldKeepSocket (socket: TrackedSocket): boolean {
  if (socket[DISCARD] === true) return false
  const createdAt = socket[CREATED_AT]
  return createdAt === undefined || Date.now() - createdAt < MAX_SOCKET_AGE_MS
}

function withSocketExpiry<T extends new (...args: any[]) => HttpAgent> (Base: T): T {
  return class extends Base {
    constructor (...args: any[]) {
      super(...args)
      // Run before the agent can hand the socket to a queued request or return it to the pool.
      this.prependListener('free', (socket: TrackedSocket) => {
        if (!shouldKeepSocket(socket)) {
          socket.destroy()
        }
      })
    }
  }
}

const ExpiringHttpAgent = withSocketExpiry(HttpAgent)
const ExpiringHttpsAgent = withSocketExpiry(HttpsAgent)

class SocketAwareRequestHandler extends NodeHttpHandler {
  async handle (...args: Parameters<NodeHttpHandler['handle']>): ReturnType<NodeHttpHandler['handle']> {
    const result = await super.handle(...args)
    const socket: TrackedSocket | null | undefined = result.response.body?.socket
    if (socket !== undefined && socket !== null) {
      socket[CREATED_AT] ??= Date.now()
      if (result.response.statusCode >= 500) {
        socket[DISCARD] = true
      }
    }
    return result
  }
}

export interface S3Options {
  endpoint?: string
  region?: string
  accessKey: string
  secretKey: string
}

export function createClient (opt: S3Options): S3 {
  return new S3({
    forcePathStyle: true,
    endpoint: opt.endpoint,
    credentials: {
      accessKeyId: opt.accessKey,
      secretAccessKey: opt.secretKey
    },
    region: opt.region ?? 'auto',
    requestHandler: new SocketAwareRequestHandler({
      connectionTimeout: 5000,
      socketTimeout: 120000,
      httpAgent: new ExpiringHttpAgent({ maxSockets: 500, keepAlive: true }),
      httpsAgent: new ExpiringHttpsAgent({ maxSockets: 500, keepAlive: true })
    })
  })
}
