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

// Seeded fuzz of the workspace connect/disconnect lifecycle. Each seed plays a random sequence of
// connects, browser reconnects (same sessionId), network drops, half-open sockets, forceClose,
// forceMaintenance, slow/failing pipeline builds, slow closes and slow queue publishes, all on
// fake time, and checks invariants after every step and after a final drain.
//
// Knobs (env):
//   FUZZ_SEEDS=200       number of seeds (default 20; use more before a release)
//   FUZZ_STEPS=300       steps per seed (default 120)
//   FUZZ_SEED_BASE=777   start of the seed range (e.g. the build number, to explore new seeds)
//   FUZZ_SEED=1234       replay a single seed
//   FUZZ_STRICT=true     also fail on invariants listed in KNOWN_BUG_INVARIANTS

import { type WorkspaceUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverToken from '@hcengineering/server-token'

import { type Client, Harness, prng } from './concurrency/harness'

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

const WORKSPACES = [
  '3f2b8a52-9c1e-4d6a-8b7f-0a1b2c3d4e5f',
  '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  'a3bb189e-8bf9-4888-9912-ace4e6543002'
] as WorkspaceUuid[]
const USERS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']

// Invariants broken by known, not yet fixed bugs. Add an entry (with a comment and a reproducing
// test in sessionManager.concurrency.test.ts) only as a temporary measure; FUZZ_STRICT ignores it.
const KNOWN_BUG_INVARIANTS = new Set<string>([])

const STRICT = process.env.FUZZ_STRICT === 'true'
const STEPS = parseInt(process.env.FUZZ_STEPS ?? '120')
const SEEDS: number[] =
  process.env.FUZZ_SEED !== undefined
    ? [parseInt(process.env.FUZZ_SEED)]
    : Array.from(
        { length: parseInt(process.env.FUZZ_SEEDS ?? '20') },
        (_, i) => parseInt(process.env.FUZZ_SEED_BASE ?? '1000') + i * 7919
      )

interface Violation {
  invariant: string
  step: number
  detail: string
}

class Checker {
  readonly violations = new Map<string, Violation>()
  step = 0

  check (invariant: string, ok: boolean, detail: () => string): void {
    if (!ok && !this.violations.has(invariant)) {
      this.violations.set(invariant, { invariant, step: this.step, detail: detail() })
    }
  }

  failing (): Violation[] {
    return [...this.violations.values()].filter((v) => STRICT || !KNOWN_BUG_INVARIANTS.has(v.invariant))
  }
}

function checkAlways (h: Harness, c: Checker): void {
  for (const p of h.pipelines) {
    c.check('pipeline-closed-at-most-once', p.closeCalls <= 1, () => `pipeline #${p.id} closed ${p.closeCalls} times`)
    c.check(
      'no-pipeline-use-after-close',
      p.usedAfterClose.length === 0,
      () => `pipeline #${p.id} used after close: ${p.usedAfterClose.join(',')}`
    )
  }
  for (const cl of h.clients) {
    if (cl.state !== 'connected' || cl.socket === undefined || cl.socket.closed) continue
    if (cl.session?.workspaceClosed === true) continue
    c.check(
      'live-client-registered',
      h.registeredSession(cl) === cl.session,
      () => `${cl.user}/${cl.sessionId} has an open socket but is not registered in workspace ${cl.ws}`
    )
  }
  // At most one pipeline per workspace may be alive once nothing is closing it.
  for (const ws of WORKSPACES) {
    const live = h.livePipelines(ws).filter((p) => p.closeCalls === 0)
    c.check('live-pipeline-per-workspace', live.length <= 1, () => `${live.length} open pipelines for ${ws}`)
  }
  // A workspace object in the map must never be one whose close already finished.
  for (const [ws, w] of h.sm.workspaces) {
    const p: any = (w as any).pipeline
    if (p !== undefined && !(p instanceof Promise) && !w.maintenance) {
      c.check(
        'active-workspace-has-open-pipeline',
        p.closed !== true,
        () => `workspace ${ws} serves closed pipeline #${p.id}`
      )
    }
  }
}

async function drainAndCheck (h: Harness, c: Checker): Promise<void> {
  h.buildDelayMs = 0
  h.closeDelayMs = 0
  h.loginDelayMs = 0
  h.logoutPublishDelayMs = 0
  h.failNextBuilds = 0

  // forceClose may wait for a cold build, so keep fake time moving while it runs.
  const drain = { closed: false }
  void Promise.all(
    WORKSPACES.filter((ws) => h.sm.maintenanceWorkspaces.has(ws) || h.sm.workspaces.get(ws)?.maintenance === true).map(
      async (ws) => {
        await h.sm.forceClose(ws).catch(() => {})
      }
    )
  ).then(() => {
    drain.closed = true
  })
  for (let i = 0; i < 300 && !drain.closed; i++) await h.advance(1000)
  c.check('force-close-completes', drain.closed, () => 'forceClose did not complete')
  await h.settleConnections()
  c.check(
    'every-connect-completes',
    h.clients.every((cl) => cl.state !== 'connecting'),
    () => `${h.clients.filter((cl) => cl.state === 'connecting').length} connects never completed`
  )
  for (const cl of h.clients) h.drop(cl)
  // reconnect timeout + soft shutdown + hang detector for anything orphaned.
  await h.advance(180_000)
  checkAlways(h, c)

  c.check('no-sessions-left', h.sm.sessions.size === 0, () => `${h.sm.sessions.size} sessions left`)
  c.check('no-workspaces-left', h.sm.workspaces.size === 0, () => `${h.sm.workspaces.size} workspaces left`)
  c.check(
    'no-pipeline-leak',
    h.livePipelines().length === 0,
    () =>
      `live pipelines: ${h
        .livePipelines()
        .map((p) => `#${p.id}@${p.wsId}`)
        .join(', ')}`
  )
  c.check('no-reconnect-ids-left', h.sm.reconnectIds.size === 0, () => `${h.sm.reconnectIds.size} reconnectIds left`)
}

async function runScenario (seed: number, h: Harness): Promise<{ checker: Checker, log: string[] }> {
  const r = prng(seed)
  const pick = <T>(arr: T[]): T => arr[Math.floor(r() * arr.length)]
  const c = new Checker()
  const log: string[] = []
  const open = (): Client[] => h.clients.filter((cl) => cl.socket !== undefined && !cl.socket.closed)
  const gone = (): Client[] => h.clients.filter((cl) => cl.state === 'closed' || cl.state === 'rejected')

  for (let step = 0; step < STEPS; step++) {
    c.step = step
    const x = r()
    if (x < 0.25) {
      const user = pick(USERS)
      const ws = pick(WORKSPACES)
      h.connect(user, ws)
      log.push(`${step}: connect ${user}@${ws.slice(0, 4)}`)
    } else if (x < 0.37) {
      const cl = gone()
      if (cl.length > 0) {
        const t = pick(cl)
        h.reconnect(t)
        log.push(`${step}: reconnect ${t.user}/${t.sessionId ?? 'new'}`)
      }
    } else if (x < 0.55) {
      const cl = open()
      if (cl.length > 0) {
        const t = pick(cl)
        h.drop(t)
        log.push(`${step}: drop ${t.user}/${t.sessionId ?? '?'}`)
      }
    } else if (x < 0.58) {
      // Half-open: the browser abandons the socket and reconnects before the server notices.
      const cl = h.clients.filter((it) => it.state === 'connected' && it.socket !== undefined && !it.socket.closed)
      if (cl.length > 0) {
        const t = pick(cl)
        ;(t.socket as any).closed = true
        h.reconnect(t)
        log.push(`${step}: half-open reconnect ${t.user}/${t.sessionId ?? '?'}`)
      }
    } else if (x < 0.8) {
      const ms = pick([0, 10, 50, 300, 1000, 2500, 4000, 8000, 16_000, 30_000])
      log.push(`${step}: advance ${ms}ms`)
      await h.advance(ms)
    } else if (x < 0.83) {
      const ws = pick(WORKSPACES)
      log.push(`${step}: forceClose ${ws.slice(0, 4)}`)
      // server_http.ts fires these with `void ...catch(log)`.
      void h.sm.forceClose(ws).catch(() => {})
    } else if (x < 0.85) {
      const ws = pick(WORKSPACES)
      log.push(`${step}: forceMaintenance ${ws.slice(0, 4)}`)
      void h.sm.forceMaintenance(h.ctx, ws).catch(() => {})
    } else {
      const kind = pick(['build', 'close', 'login', 'logout', 'fail'])
      switch (kind) {
        case 'build':
          h.buildDelayMs = pick([0, 0, 500, 5000, 20_000])
          log.push(`${step}: buildDelay=${h.buildDelayMs}`)
          break
        case 'close':
          h.closeDelayMs = pick([0, 0, 1000, 8000])
          log.push(`${step}: closeDelay=${h.closeDelayMs}`)
          break
        case 'login':
          h.loginDelayMs = pick([0, 0, 200, 4000])
          log.push(`${step}: loginDelay=${h.loginDelayMs}`)
          break
        case 'logout':
          h.logoutPublishDelayMs = pick([0, 0, 0, 100, 2000, 20_000])
          log.push(`${step}: logoutDelay=${h.logoutPublishDelayMs}`)
          break
        default:
          h.failNextBuilds++
          log.push(`${step}: failNextBuild`)
      }
    }
    await h.advance(0)
    checkAlways(h, c)
  }
  c.step = STEPS
  await drainAndCheck(h, c)
  return { checker: c, log }
}

describe('TSessionManager lifecycle fuzz', () => {
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

  it.each(SEEDS)(
    'seed %i keeps lifecycle invariants',
    async (seed: number) => {
      const { checker, log } = await runScenario(seed, h)
      const failing = checker.failing()
      if (failing.length > 0) {
        const first = Math.min(...failing.map((v) => v.step))
        const trail = log.filter((l) => parseInt(l) <= first).slice(-40)
        throw new Error(
          `Invariant violation for seed ${seed} (replay: FUZZ_SEED=${seed} FUZZ_STEPS=${STEPS})\n` +
            failing.map((v) => `  [${v.invariant}] at step ${v.step}: ${v.detail}`).join('\n') +
            `\nLast operations:\n  ${trail.join('\n  ')}`
        )
      }
    },
    120_000
  )
})
