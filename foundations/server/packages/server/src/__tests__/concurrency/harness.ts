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

// Test harness that drives a real TSessionManager + real Workspace with a fake transport,
// fake account service, fake queue and fake pipelines. Everything is time-controlled through
// jest fake timers, so interleavings are reproducible.
//
// The fake socket mimics pods/server/src/server_http.ts: when the socket closes, the transport
// calls sessionManager.close() unless the session was marked `workspaceClosed` by doCloseAll.

import core, {
  AccountRole,
  MeasureMetricsContext,
  SocialIdType,
  type AccountUuid,
  type WorkspaceUuid
} from '@hcengineering/core'
import type { ConnectionSocket } from '@hcengineering/server-core'
import type { Token } from '@hcengineering/server-token'

import { TSessionManager } from '../../sessionManager'

export const TICK_MS = 50
export const RECONNECT_TIMEOUT_S = 3
export const SOFT_SHUTDOWN_MS = 15_000
export const HANG_SESSION_MS = 60_000
const PING_INTERVAL_MS = 5_000

export interface FakePipeline {
  id: number
  wsId: WorkspaceUuid
  closed: boolean
  closeCalls: number
  closedSessions: string[]
  usedAfterClose: string[]
  context: { lastTx: string, lastHash: string, modelDb: any }
  findAll: (...args: any[]) => Promise<any[]>
  tx: (...args: any[]) => Promise<any>
  handleBroadcast: (...args: any[]) => Promise<void>
  closeSession: (ctx: any, sessionId: string) => Promise<void>
  close: () => Promise<void>
}

export interface FakeSocket extends ConnectionSocket {
  closed: boolean
  session?: any
  sentMessages: any[]
  pendingSession?: Promise<void>
}

export interface Client {
  user: string
  ws: WorkspaceUuid
  sessionId?: string
  socket?: FakeSocket
  session?: any
  state: 'connecting' | 'connected' | 'rejected' | 'closed'
  helloOk: boolean
  done?: Promise<void>
}

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return
  await new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export class Harness {
  readonly ctx = new MeasureMetricsContext('test', {})
  readonly sm: TSessionManager
  readonly pipelines: FakePipeline[] = []
  readonly clients: Client[] = []

  // Adverse conditions, can be changed at any time.
  buildDelayMs = 0
  failNextBuilds = 0
  closeDelayMs = 0
  loginDelayMs = 0
  logoutPublishDelayMs = 0

  readonly published = { login: 0, logout: 0, wsOpen: 0, wsDown: 0 }
  private socketSeq = 0
  private pipelineSeq = 0
  private readonly pingTimer: any

  constructor () {
    const usersProducer = {
      send: jest.fn(async (_ctx: any, _ws: any, msgs: any[]) => {
        for (const m of msgs) {
          if (m.type === 'logout') {
            this.published.logout++
            await sleep(this.logoutPublishDelayMs)
          } else if (m.type === 'login') {
            this.published.login++
          }
        }
      }),
      close: jest.fn()
    }
    const workspaceProducer = {
      send: jest.fn(async (_ctx: any, _ws: any, msgs: any[]) => {
        for (const m of msgs) {
          if (m.type === 'up') this.published.wsOpen++
          if (m.type === 'down') this.published.wsDown++
        }
      }),
      close: jest.fn()
    }
    const queue = {
      getProducer: jest.fn((_ctx: any, topic: string) => (topic === 'users' ? usersProducer : workspaceProducer)),
      createConsumer: jest.fn().mockReturnValue({ close: jest.fn() })
    }

    this.sm = new TSessionManager(
      this.ctx,
      { pingTimeout: 10_000, reconnectTimeout: RECONNECT_TIMEOUT_S },
      {},
      undefined,
      'http://account',
      false,
      true,
      queue as any,
      async (_ctx, wsIds) => await this.buildPipeline(wsIds.uuid)
    )

    // Fake account service: rawToken is `${user}|${workspace}`.
    jest.spyOn(this.sm, 'getLoginWithWorkspaceInfo').mockImplementation(async (_ctx, rawToken) => {
      await sleep(this.loginDelayMs)
      const [user, ws] = rawToken.split('|')
      return {
        account: user as AccountUuid,
        name: user,
        socialIds: [
          { _id: `sid-${user}`, type: SocialIdType.HULY, value: user, key: `huly:${user}`, verifiedOn: 1 } as any
        ],
        workspaces: {
          [ws]: {
            url: `url-${ws}`,
            mode: 'active',
            dataId: undefined,
            version: { versionMajor: 0, versionMinor: 7, versionPatch: 0 },
            role: AccountRole.User,
            endpoint: { externalUrl: '', internalUrl: '', region: '' },
            progress: 100
          }
        }
      } as any
    })

    // Live browser clients ping regularly; closed sockets do not.
    this.pingTimer = setInterval(() => {
      for (const c of this.clients) {
        if (c.socket !== undefined && !c.socket.closed && c.session !== undefined) {
          c.session.lastRequest = Date.now()
        }
      }
    }, PING_INTERVAL_MS)
  }

  async dispose (): Promise<void> {
    clearInterval(this.pingTimer)
    clearInterval(this.sm.checkInterval)
    clearTimeout(this.sm.maintenanceTimer)
  }

  private async buildPipeline (wsId: WorkspaceUuid): Promise<any> {
    await sleep(this.buildDelayMs)
    if (this.failNextBuilds > 0) {
      this.failNextBuilds--
      throw new Error(`build failed for ${wsId}`)
    }
    const p: FakePipeline = {
      id: ++this.pipelineSeq,
      wsId,
      closed: false,
      closeCalls: 0,
      closedSessions: [],
      usedAfterClose: [],
      context: { lastTx: '', lastHash: '', modelDb: {} },
      findAll: async () => {
        if (p.closed) p.usedAfterClose.push('findAll')
        return []
      },
      tx: async () => {
        if (p.closed) p.usedAfterClose.push('tx')
        return {}
      },
      handleBroadcast: async () => {},
      closeSession: async (_ctx, sessionId) => {
        if (p.closed) p.usedAfterClose.push('closeSession')
        p.closedSessions.push(sessionId)
      },
      close: async () => {
        p.closeCalls++
        await sleep(this.closeDelayMs)
        p.closed = true
      }
    }
    this.pipelines.push(p)
    return p
  }

  private makeSocket (client: Client): FakeSocket {
    const socket: FakeSocket = {
      id: `socket-${++this.socketSeq}`,
      closed: false,
      get isClosed () {
        return socket.closed
      },
      sentMessages: [],
      data: () => ({}),
      isBackpressure: () => false,
      checkState: () => !socket.closed,
      readRequest: (buffer: any) => buffer,
      sendPong: jest.fn(),
      backpressure: async () => {},
      send: jest.fn(async (_ctx: any, msg: any) => {
        socket.sentMessages.push(msg)
      }),
      close: () => {
        if (socket.closed) return
        socket.closed = true
        if (client.socket === socket) client.state = 'closed'
        // Like server_http.ts: the 'close' event is async and waits for the session to be resolved.
        setTimeout(() => {
          void (socket.pendingSession ?? Promise.resolve()).then(() => {
            const s = socket.session
            if (s !== undefined && !(s.workspaceClosed ?? false)) {
              void this.sm.close(this.ctx, socket, client.ws)
            }
          })
        }, 0)
      }
    }
    return socket
  }

  /** Start a connection (does not wait). Pass `sessionId` to emulate a browser reconnect. */
  connect (user: string, ws: WorkspaceUuid, sessionId?: string): Client {
    const client: Client = { user, ws, sessionId, state: 'connecting', helloOk: false }
    this.clients.push(client)
    this.startConnection(client)
    return client
  }

  /** Reconnect an existing client the way the browser does: new socket, same sessionId. */
  reconnect (client: Client): void {
    this.startConnection(client)
  }

  private startConnection (client: Client): void {
    const socket = this.makeSocket(client)
    client.socket = socket
    client.session = undefined
    client.helloOk = false
    client.state = 'connecting'
    const token: Token = { account: client.user as AccountUuid, workspace: client.ws, extra: {} }
    let resolveSession: () => void = () => {}
    socket.pendingSession = new Promise<void>((resolve) => {
      resolveSession = resolve
    })
    client.done = (async () => {
      try {
        const res: any = await this.sm.addSession(
          this.ctx,
          socket,
          token,
          `${client.user}|${client.ws}`,
          client.sessionId
        )
        if (res?.session === undefined) {
          if (client.socket === socket) client.state = 'rejected'
          return
        }
        socket.session = res.session
        resolveSession()
        if (client.socket !== socket) return
        client.session = res.session
        client.sessionId = res.session.sessionId
        if (!socket.closed) client.state = 'connected'
        await this.sm.handleRequest(
          this.ctx,
          res.session,
          socket,
          { id: -1, method: 'hello', params: [] } as any,
          client.ws
        )
        client.helloOk = socket.sentMessages.some((m) => m?.result === 'hello')
      } finally {
        resolveSession()
      }
    })()
  }

  /** Network drop: the socket goes away, the transport notices it. */
  drop (client: Client): void {
    client.socket?.close()
  }

  async advance (ms: number): Promise<void> {
    await jest.advanceTimersByTimeAsync(ms)
  }

  /** Run until all started connections finished (or the budget is exhausted). */
  async settleConnections (budgetMs = 300_000): Promise<void> {
    let spent = 0
    while (spent < budgetMs) {
      let pending = 0
      await Promise.all(
        this.clients.map(async (c) => {
          const marker = Symbol('pending')
          const r = await Promise.race([c.done, Promise.resolve(marker)])
          if (r === marker) pending++
        })
      )
      if (pending === 0) return
      await this.advance(1000)
      spent += 1000
    }
  }

  pipelinesOf (ws: WorkspaceUuid): FakePipeline[] {
    return this.pipelines.filter((p) => p.wsId === ws)
  }

  livePipelines (ws?: WorkspaceUuid): FakePipeline[] {
    return this.pipelines.filter((p) => !p.closed && (ws === undefined || p.wsId === ws))
  }

  /** The session the server would deliver broadcasts to for this client, if any. */
  registeredSession (client: Client): any {
    if (client.sessionId === undefined) return undefined
    return this.sm.workspaces.get(client.ws)?.sessions.get(client.sessionId)?.session
  }

  upgradeSent (client: Client): boolean {
    return (client.socket?.sentMessages ?? []).some((m) => m?.result?._class === core.class.TxModelUpgrade)
  }
}

/** Small deterministic PRNG (mulberry32). */
export function prng (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
