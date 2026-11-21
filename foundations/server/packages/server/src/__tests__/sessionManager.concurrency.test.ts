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

// Deterministic concurrency scenarios for workspace connect/disconnect lifecycle.
// Real TSessionManager + real Workspace; transport, account service, queue and pipelines are fakes
// driven by jest fake timers (see ./concurrency/harness.ts).
//
// The 'regressions' block reproduces lifecycle bugs found by these tests and fixed afterwards.

import { type WorkspaceUuid } from '@hcengineering/core'
import { Analytics } from '@hcengineering/analytics'
import { setMetadata } from '@hcengineering/platform'
import serverToken from '@hcengineering/server-token'

import { Harness, HANG_SESSION_MS, RECONNECT_TIMEOUT_S, SOFT_SHUTDOWN_MS, TICK_MS } from './concurrency/harness'

jest.mock('@hcengineering/account-client', () => ({
  getClient: jest.fn(() => ({
    getWorkspaceInfo: jest.fn(),
    updateLastVisit: jest.fn(),
    updateAccountsLastVisit: jest.fn(),
    getLoginWithWorkspaceInfo: jest.fn()
  }))
}))
jest.mock('@hcengineering/analytics', () => ({
  Analytics: { handleError: jest.fn(), handleEvent: jest.fn() }
}))
jest.mock('../client', () => ({
  ClientSession: jest
    .fn()
    .mockImplementation((...args: any[]) => require('./concurrency/mocks').createFakeClientSession(...args))
}))
jest.mock('../utils', () => ({ sendResponse: jest.fn().mockResolvedValue(undefined) }))

const WS = '3f2b8a52-9c1e-4d6a-8b7f-0a1b2c3d4e5f' as WorkspaceUuid

describe('TSessionManager concurrency: workspace connect/disconnect lifecycle', () => {
  let h: Harness

  beforeAll(() => {
    setMetadata(serverToken.metadata.Secret, 'secret')
  })

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
    h = new Harness()
  })

  afterEach(async () => {
    await h.dispose()
    jest.useRealTimers()
  })

  it('cold-start storm: many simultaneous connects build exactly one pipeline and all get hello', async () => {
    h.buildDelayMs = 2000
    const clients = Array.from({ length: 50 }, (_, i) => h.connect(`u${i % 10}`, WS))

    await h.settleConnections()

    expect(h.pipelinesOf(WS)).toHaveLength(1)
    expect(h.sm.workspaces.size).toBe(1)
    expect(h.sm.sessions.size).toBe(50)
    for (const c of clients) {
      expect(c.state).toBe('connected')
      expect(c.helloOk).toBe(true)
      expect(h.registeredSession(c)).toBe(c.session)
    }
    expect(h.published.wsOpen).toBe(1)
  })

  it('last user leaves: workspace is unloaded only after the soft-shutdown window', async () => {
    const c = h.connect('u1', WS)
    await h.settleConnections()
    h.drop(c)

    await h.advance(SOFT_SHUTDOWN_MS - 2000)
    expect(h.sm.workspaces.has(WS)).toBe(true)
    expect(h.livePipelines(WS)).toHaveLength(1)

    await h.advance(5000)
    expect(h.sm.workspaces.has(WS)).toBe(false)
    expect(h.livePipelines(WS)).toHaveLength(0)
    expect(h.pipelinesOf(WS)[0].closeCalls).toBe(1)
    expect(h.sm.sessions.size).toBe(0)
    expect(h.sm.reconnectIds.size).toBe(0)
  })

  it('a user coming back inside the soft-shutdown window reuses the warm pipeline', async () => {
    const c1 = h.connect('u1', WS)
    await h.settleConnections()
    h.drop(c1)
    await h.advance(SOFT_SHUTDOWN_MS / 2)

    const c2 = h.connect('u2', WS)
    await h.settleConnections()
    await h.advance(SOFT_SHUTDOWN_MS * 2)

    expect(c2.helloOk).toBe(true)
    expect(h.pipelinesOf(WS)).toHaveLength(1)
    expect(h.livePipelines(WS)).toHaveLength(1)
  })

  it('connect while the workspace is closing waits for the close and gets a fresh pipeline', async () => {
    h.closeDelayMs = 10_000
    const c1 = h.connect('u1', WS)
    await h.settleConnections()
    h.drop(c1)
    await h.advance(SOFT_SHUTDOWN_MS + 1000) // close started, blocked in pipeline.close()
    expect(h.sm.workspaces.get(WS)?.closing).toBeDefined()

    const c2 = h.connect('u2', WS)
    await h.advance(2000)
    expect(c2.state).toBe('connecting') // waits for the close

    await h.settleConnections()
    const [oldP, newP] = h.pipelinesOf(WS)
    expect(oldP.closed).toBe(true)
    expect(oldP.closeCalls).toBe(1)
    expect(oldP.usedAfterClose).toEqual([])
    expect(newP).toBeDefined()
    expect(newP.closed).toBe(false)
    expect(c2.helloOk).toBe(true)
    expect(h.registeredSession(c2)).toBe(c2.session)
  })

  it('soft close while the cold build is still running waits for the build and closes the pipeline', async () => {
    h.buildDelayMs = 30_000
    const c = h.connect('u1', WS)
    await h.advance(1000) // session added, hello waits for the build
    expect(c.state).toBe('connected')
    h.drop(c)

    await h.advance(60_000)
    expect(h.sm.workspaces.has(WS)).toBe(false)
    expect(h.pipelinesOf(WS)).toHaveLength(1)
    expect(h.livePipelines(WS)).toHaveLength(0)
  })

  it('cold build failure is not cached: the next connect rebuilds the pipeline', async () => {
    h.failNextBuilds = 1
    const c1 = h.connect('u1', WS)
    await h.settleConnections()
    expect(c1.helloOk).toBe(false)

    const c2 = h.connect('u2', WS)
    await h.settleConnections()
    expect(c2.helloOk).toBe(true)
    expect(h.pipelinesOf(WS)).toHaveLength(1)
  })

  it('reconnect with the same sessionId inside reconnectTimeout keeps the pipeline session', async () => {
    const c = h.connect('u1', WS)
    await h.settleConnections()
    const sid = c.sessionId

    h.drop(c)
    await h.advance(1000)
    h.reconnect(c)
    await h.settleConnections()
    await h.advance(RECONNECT_TIMEOUT_S * 1000 * 3)

    expect(c.sessionId).toBe(sid)
    expect(h.registeredSession(c)).toBe(c.session)
    expect(h.pipelinesOf(WS)[0].closedSessions).toEqual([])
  })

  it('a client gone longer than reconnectTimeout has its pipeline session closed exactly once', async () => {
    const keep = h.connect('u-keep', WS) // keeps the workspace open
    const c = h.connect('u1', WS)
    await h.settleConnections()

    h.drop(c)
    await h.advance(RECONNECT_TIMEOUT_S * 1000 + 500)

    expect(h.pipelinesOf(WS)[0].closedSessions).toEqual([c.sessionId])
    expect(h.sm.reconnectIds.has(c.sessionId as string)).toBe(false)
    expect(h.registeredSession(keep)).toBe(keep.session)
  })

  it('socket close racing with the hang detector closes the session once', async () => {
    const keep = h.connect('u-keep', WS)
    const c = h.connect('u1', WS)
    await h.settleConnections()
    const logoutsBefore = h.published.logout

    // The client stops pinging but its socket is still "open" -> hang detector fires,
    // and at the same moment the transport reports the close.
    c.socket!.checkState = () => false
    c.session.lastRequest = Date.now() - HANG_SESSION_MS - 1000
    const sock = c.socket!
    ;(sock as any).closed = true // stop pings from the harness
    await h.advance(TICK_MS * 25)
    void h.sm.close(h.ctx, sock, WS)
    await h.advance(TICK_MS * 5)

    expect(h.published.logout - logoutsBefore).toBe(1)
    expect(h.sm.sessions.size).toBe(1)
    expect(h.registeredSession(keep)).toBe(keep.session)
  })

  it('forceClose disconnects everybody with an upgrade, and reconnects get a fresh pipeline', async () => {
    const clients = Array.from({ length: 5 }, (_, i) => h.connect(`u${i}`, WS))
    await h.settleConnections()

    await h.sm.forceClose(WS)
    for (const c of clients) {
      expect(h.upgradeSent(c)).toBe(true)
      expect(c.socket?.closed).toBe(true)
    }
    expect(h.pipelinesOf(WS)[0].closed).toBe(true)

    for (const c of clients) h.reconnect(c)
    await h.settleConnections()
    expect(h.pipelinesOf(WS)).toHaveLength(2)
    expect(h.livePipelines(WS)).toHaveLength(1)
    for (const c of clients) {
      expect(c.helloOk).toBe(true)
      expect(h.registeredSession(c)).toBe(c.session)
    }
  })

  describe('regressions', () => {
    // performWorkspaceCloseCheck() awaited workspace.close() and then did workspaces.delete(uuid)
    // by id. If forceClose() removed that Workspace meanwhile and a user opened a new one, the stale
    // soft close deletes the NEW workspace: its pipeline is never closed (leak), its sessions get
    // "Workspace is closing" forever, and the next connect builds yet another pipeline.
    it('a slow soft close does not unload a newer workspace instance created after forceClose', async () => {
      const c1 = h.connect('u1', WS)
      await h.settleConnections()
      h.drop(c1)
      h.closeDelayMs = 30_000
      await h.advance(SOFT_SHUTDOWN_MS + 1000) // soft close running, blocked in pipeline.close()

      void h.sm.forceClose(WS).catch(() => {}) // e.g. workspace service after an upgrade/restore
      await h.advance(0)
      h.closeDelayMs = 0
      const c2 = h.connect('u2', WS)
      await h.advance(1000)
      expect(c2.helloOk).toBe(true)

      await h.advance(40_000) // the stale soft close finishes
      expect(h.registeredSession(c2)).toBe(c2.session)
      expect(h.livePipelines(WS)).toHaveLength(1)

      const c3 = h.connect('u3', WS)
      await h.settleConnections()
      expect(h.livePipelines(WS)).toHaveLength(1)
      expect(h.registeredSession(c3)).toBe(c3.session)
    })

    // doCloseAll() cleared workspace.sessions and marked sessions workspaceClosed, so the transport
    // never called sessionManager.close() for them and they stayed in the global `sessions` map.
    // ~60s later the hang detector "closes" the orphan, and close() removes the entry with the
    // same sessionId from the NEW workspace — which is the browser that already reconnected with
    // the sessionId it keeps in sessionStorage. That client silently stops receiving broadcasts.
    it('after forceClose, a client reconnected with the same sessionId stays registered', async () => {
      const keep = h.connect('u-keep', WS)
      const c = h.connect('u1', WS)
      await h.settleConnections()

      await h.sm.forceClose(WS)
      h.reconnect(keep)
      h.reconnect(c)
      await h.settleConnections()
      expect(h.registeredSession(c)).toBe(c.session)

      await h.advance(HANG_SESSION_MS + 5000)

      expect(c.socket?.closed).toBe(false)
      expect(h.registeredSession(c)).toBe(c.session)
      expect(h.pipelinesOf(WS)[1].closedSessions).not.toContain(c.sessionId)
    })

    it('after forceClose, orphaned sessions do not stay in the global sessions map', async () => {
      Array.from({ length: 5 }, (_, i) => h.connect(`u${i}`, WS))
      await h.settleConnections()

      const logoutsBefore = h.published.logout
      await h.sm.forceClose(WS)
      await h.advance(1000)

      expect(h.sm.sessions.size).toBe(0)
      expect(h.published.logout - logoutsBefore).toBe(5) // login/logout stay paired
    })

    // addSession() with a reused sessionId awaits close(oldSocket), which awaits the logout publish.
    // If that takes longer than the soft-shutdown window, the workspace is unloaded meanwhile and the
    // new session is attached to the dead Workspace object, which is no longer in `workspaces`.
    it('a reconnect with a slow logout publish is not attached to an unloaded workspace', async () => {
      const c = h.connect('u1', WS)
      await h.settleConnections()

      // Old socket is still registered on the server (half-open connection), browser reconnects.
      h.logoutPublishDelayMs = SOFT_SHUTDOWN_MS + 5000
      const stale = c.socket!
      ;(stale as any).closed = true // the browser abandoned it; the server hasn't noticed yet
      h.reconnect(c)
      await h.settleConnections()

      expect(c.state).toBe('connected')
      expect(h.sm.workspaces.get(WS)).toBeDefined()
      expect(h.registeredSession(c)).toBe(c.session)
    })

    // close() leaves the sessionId in reconnectIds and relies on a tick handler of the Workspace
    // to remove it after reconnectTimeout. forceClose() drops the Workspace (and its tick handlers)
    // from the map, so ids of clients that left shortly before stay in reconnectIds forever and a
    // later connect with that sessionId is reported as `reconnect: true`.
    it('forceClose right after a disconnect does not leak reconnectIds', async () => {
      h.connect('u-keep', WS)
      const c = h.connect('u1', WS)
      await h.settleConnections()

      h.drop(c)
      await h.advance(500)
      await h.sm.forceClose(WS)
      await h.advance(60_000)

      expect(h.sm.reconnectIds.has(c.sessionId as string)).toBe(false)
    })

    // close() scheduled `void workspace.with(pipeline.closeSession)` after reconnectTimeout without
    // a catch, so a failing cold build there was an unhandled rejection.
    it('a failing cold build in the reconnect tick handler is reported, not left unhandled', async () => {
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason)
      }
      process.on('unhandledRejection', onUnhandled)
      try {
        h.failNextBuilds = 2 // hello's build and the tick handler's build
        const c = h.connect('u1', WS)
        await h.settleConnections()
        h.drop(c)
        await h.advance(RECONNECT_TIMEOUT_S * 1000 + 500)
        await h.dispose()
        jest.useRealTimers()
        await new Promise((resolve) => setImmediate(resolve))
        expect(unhandled).toEqual([])
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(Analytics.handleError).toHaveBeenCalledWith(
          expect.objectContaining({ message: expect.stringContaining('build failed') })
        )
      } finally {
        process.off('unhandledRejection', onUnhandled)
      }
    })

    it('forceClose during a slow soft close closes the pipeline once', async () => {
      const c1 = h.connect('u1', WS)
      await h.settleConnections()
      h.drop(c1)
      h.closeDelayMs = 10_000
      await h.advance(SOFT_SHUTDOWN_MS + 1000)

      void h.sm.forceClose(WS).catch(() => {})
      await h.advance(20_000)

      expect(h.pipelinesOf(WS)[0].closeCalls).toBe(1)
      expect(h.sm.workspaces.has(WS)).toBe(false)
    })

    // A connect that waited (slow account service) on a socket the browser already dropped used
    // to replace the newer connection registered under the same sessionId, evicting the live client.
    it('a stale connect on a dropped socket does not evict the newer connection with the same sessionId', async () => {
      const c = h.connect('u1', WS)
      await h.settleConnections()

      h.drop(c)
      await h.advance(100)
      h.loginDelayMs = 5000
      h.reconnect(c) // socket A waits for the account service
      const socketA = c.socket!
      await h.advance(100)
      socketA.close() // network drops again
      h.loginDelayMs = 0
      h.reconnect(c) // socket B
      await h.advance(100)
      expect(h.registeredSession(c)).toBe(c.session)

      await h.advance(10_000) // A's addSession resumes
      expect(c.socket?.closed).toBe(false)
      expect(h.registeredSession(c)).toBe(c.session)
    })

    // addSession() gives up on a socket dropped during setup; the Workspace it created for that first
    // connect must still be unloaded (soft close requires workspaceInitCompleted).
    it('an abandoned first connect does not keep the workspace loaded', async () => {
      h.loginDelayMs = 1000
      const c = h.connect('u1', WS)
      await h.advance(100)
      h.drop(c)
      await h.advance(2000)
      expect(c.state).toBe('rejected') // the server gave up on the dead socket
      expect(h.sm.sessions.size).toBe(0)

      await h.advance(SOFT_SHUTDOWN_MS * 2)
      expect(h.sm.workspaces.size).toBe(0)
    })

    // close() awaits the logout publish before scheduling reconnect bookkeeping; a forceClose in
    // between left that bookkeeping on the dropped Workspace and leaked the sessionId.
    it('forceClose while a disconnect is publishing logout does not leak reconnectIds', async () => {
      h.connect('u-keep', WS)
      const c = h.connect('u1', WS)
      await h.settleConnections()

      h.logoutPublishDelayMs = 2000
      h.drop(c)
      await h.advance(100)
      await h.sm.forceClose(WS)
      await h.advance(60_000)

      expect(h.sm.reconnectIds.size).toBe(0)
    })

    // forceMaintenance() closes the pipeline but keeps the Workspace in the map with the closed
    // pipeline; a following forceClose() (the usual end of an upgrade) used to close it again.
    it('forceMaintenance followed by forceClose closes the pipeline once', async () => {
      h.connect('u1', WS)
      await h.settleConnections()

      await h.sm.forceMaintenance(h.ctx, WS)
      await h.sm.forceClose(WS)

      expect(h.pipelinesOf(WS)[0].closeCalls).toBe(1)
    })
  })
})
