//
// Copyright © TraceX SAS 2026
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

import { generateUuid, type AccountUuid, type MeasureContext, type WorkspaceUuid } from '@hcengineering/core'
import { decodeToken } from '@hcengineering/server-token'
import type { AccountDB, ActiveSession, SecurityLoginEvent } from '../types'
import {
  accessTokenOptions,
  classifySecurityEventType,
  createActiveSession,
  isActiveSessionRevoked,
  listActiveSessions,
  mintRefreshToken,
  purgeRevokedActiveSessions,
  revokeActiveSession,
  rotateSessionRefresh,
  setSessionRevokeNotifier,
  touchActiveSession
} from '../utils'

// ---- Minimal in-memory AccountDB collection ----------------------------------

function matches (row: Record<string, any>, query: Record<string, any>): boolean {
  for (const [key, cond] of Object.entries(query)) {
    const value = row[key]
    if (cond === null) {
      if (value != null) return false
    } else if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond && !(cond.$in as any[]).includes(value)) return false
      if ('$gte' in cond && !(value >= cond.$gte)) return false
      if ('$lte' in cond && !(value <= cond.$lte)) return false
      if ('$gt' in cond && !(value > cond.$gt)) return false
      if ('$lt' in cond && !(value < cond.$lt)) return false
      if ('$ne' in cond && value === cond.$ne) return false
    } else if (value !== cond) {
      return false
    }
  }
  return true
}

class InMemoryCollection<T extends Record<string, any>> {
  rows: T[] = []

  async insertOne (data: Partial<T>): Promise<any> {
    this.rows.push({ ...(data as T) })
    return {}
  }

  async insertMany (data: Array<Partial<T>>): Promise<any> {
    for (const d of data) await this.insertOne(d)
    return {}
  }

  async findOne (query: any): Promise<T | null> {
    return this.rows.find((r) => matches(r, query)) ?? null
  }

  async find (query: any, sort?: any, limit?: number): Promise<T[]> {
    let res = this.rows.filter((r) => matches(r, query))
    if (sort != null) {
      const [key, dir] = Object.entries(sort)[0] as [string, string]
      res = [...res].sort((a, b) => {
        const av = a[key]
        const bv = b[key]
        const cmp = av > bv ? 1 : av < bv ? -1 : 0
        return dir === 'descending' ? -cmp : cmp
      })
    }
    return limit != null ? res.slice(0, limit) : res
  }

  async update (query: any, ops: any): Promise<void> {
    for (const row of this.rows) {
      if (!matches(row, query)) continue
      const set = ops.$set ?? ops
      for (const [k, v] of Object.entries(set)) {
        if (k === '$set' || k === '$inc') continue
        ;(row as any)[k] = v
      }
    }
  }

  async deleteMany (query: any): Promise<void> {
    this.rows = this.rows.filter((r) => !matches(r, query))
  }

  async exists (query: any): Promise<boolean> {
    return (await this.findOne(query)) != null
  }
}

function makeDb (): {
  db: AccountDB
  activeSession: InMemoryCollection<ActiveSession>
  securityLoginEvent: InMemoryCollection<SecurityLoginEvent>
} {
  const activeSession = new InMemoryCollection<ActiveSession>()
  const securityLoginEvent = new InMemoryCollection<SecurityLoginEvent>()
  const db = { activeSession, securityLoginEvent } as unknown as AccountDB
  return { db, activeSession, securityLoginEvent }
}

const ctx = { warn: jest.fn(), error: jest.fn(), info: jest.fn() } as unknown as MeasureContext

const ACC = 'acc-0000-0000-0000-000000000001' as AccountUuid
const OTHER = 'acc-0000-0000-0000-000000000002' as AccountUuid
const WS = 'ws-0000-0000-0000-000000000001' as WorkspaceUuid

afterEach(() => {
  setSessionRevokeNotifier(undefined)
})

describe('classifySecurityEventType', () => {
  it('maps interactive auth to login', () => {
    expect(classifySecurityEventType('password')).toBe('login')
    expect(classifySecurityEventType('otp')).toBe('login')
    expect(classifySecurityEventType('token')).toBe('login')
  })

  it('maps session churn to refresh and unknown to session', () => {
    expect(classifySecurityEventType('session')).toBe('refresh')
    expect(classifySecurityEventType('unknown')).toBe('session')
  })
})

describe('createActiveSession', () => {
  it('inserts a session and returns its id', async () => {
    const { db, activeSession } = makeDb()
    const sessionId = await createActiveSession(ctx, db, {
      accountUuid: ACC,
      workspaceUuid: WS,
      authMethod: 'password',
      ip: '1.2.3.4',
      userAgent: 'UA'
    })
    expect(sessionId).toBeDefined()
    expect(activeSession.rows).toHaveLength(1)
    const row = activeSession.rows[0]
    expect(row.sessionId).toBe(sessionId)
    expect(row.accountUuid).toBe(ACC)
    expect(row.workspaceUuid).toBe(WS)
    expect(row.revokedOn).toBeUndefined()
    expect(row.createdOn).toBe(row.lastSeen)
    expect(row.refreshGeneration).toBe(0)
  })
})

describe('rotateSessionRefresh', () => {
  it('bumps the generation when the presented generation matches', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password', refreshGeneration: 2 }
    ] as ActiveSession[]

    const res = await rotateSessionRefresh(ctx, db, ACC, 's1', 2)
    expect(res).toEqual({ newGen: 3 })
    expect(activeSession.rows[0].refreshGeneration).toBe(3)
  })

  it('revokes the session on replay of an older generation (reuse detection)', async () => {
    const { db, activeSession, securityLoginEvent } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password', refreshGeneration: 5 }
    ] as ActiveSession[]

    const res = await rotateSessionRefresh(ctx, db, ACC, 's1', 3)
    expect(res).toEqual({ error: 'reuse' })
    expect(activeSession.rows[0].revokedOn).toBeDefined()
    expect(activeSession.rows[0].revokedReason).toBe('reuse')
    const logout = securityLoginEvent.rows.find((e) => e.eventType === 'logout')
    expect(logout).toBeDefined()
    expect(logout?.reason).toBe('session_revoked_reuse')
  })

  it('rejects a revoked or unknown session', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password', refreshGeneration: 0, revokedOn: 9 }
    ] as ActiveSession[]

    expect(await rotateSessionRefresh(ctx, db, ACC, 's1', 0)).toEqual({ error: 'revoked' })
    expect(await rotateSessionRefresh(ctx, db, ACC, 'nope', 0)).toEqual({ error: 'revoked' })
  })

  it('rejects a generation newer than stored as invalid', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password', refreshGeneration: 1 }
    ] as ActiveSession[]

    expect(await rotateSessionRefresh(ctx, db, ACC, 's1', 4)).toEqual({ error: 'invalid' })
    expect(activeSession.rows[0].revokedOn).toBeUndefined()
  })
})

describe('purgeRevokedActiveSessions', () => {
  it('deletes revoked rows past the retention window, keeps live and recent', async () => {
    const { db, activeSession } = makeDb()
    const now = Date.now()
    activeSession.rows = [
      { sessionId: 'old', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password', revokedOn: 1000 },
      { sessionId: 'recent', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password', revokedOn: now },
      { sessionId: 'live', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password' }
    ] as ActiveSession[]

    await purgeRevokedActiveSessions(db)

    const ids = activeSession.rows.map((r) => r.sessionId).sort()
    expect(ids).toEqual(['live', 'recent'])
  })
})

describe('token mint helpers', () => {
  it('accessTokenOptions marks the token as an access token', () => {
    const opts = accessTokenOptions('sess-1')
    expect(opts.kind).toBe('access')
    expect(opts.sessionId).toBe('sess-1')
  })

  it('mintRefreshToken encodes kind=refresh, sessionId and generation', () => {
    const acc = generateUuid() as AccountUuid
    const token = mintRefreshToken(acc, 'sess-9', 3)
    const decoded = decodeToken(token)
    expect(decoded.account).toBe(acc)
    expect(decoded.kind).toBe('refresh')
    expect(decoded.sessionId).toBe('sess-9')
    expect(decoded.extra?.gen).toBe('3')
  })
})

describe('listActiveSessions', () => {
  it('returns only non-revoked sessions, newest first', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 'a', accountUuid: ACC, createdOn: 1, lastSeen: 10, authMethod: 'password' },
      { sessionId: 'b', accountUuid: ACC, createdOn: 2, lastSeen: 30, authMethod: 'otp' },
      { sessionId: 'c', accountUuid: ACC, createdOn: 3, lastSeen: 20, authMethod: 'password', revokedOn: 99 },
      { sessionId: 'd', accountUuid: OTHER, createdOn: 4, lastSeen: 40, authMethod: 'password' }
    ] as ActiveSession[]

    const res = await listActiveSessions(db, ACC)
    expect(res.map((r) => r.sessionId)).toEqual(['b', 'a'])
  })

  it('filters by workspace when provided', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 'a', accountUuid: ACC, createdOn: 1, lastSeen: 10, authMethod: 'password', workspaceUuid: WS },
      { sessionId: 'b', accountUuid: ACC, createdOn: 2, lastSeen: 20, authMethod: 'password' }
    ] as ActiveSession[]

    const res = await listActiveSessions(db, ACC, WS)
    expect(res.map((r) => r.sessionId)).toEqual(['a'])
  })
})

describe('isActiveSessionRevoked', () => {
  it('treats unknown and revoked sessions as revoked, active as not', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 'live', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password' },
      { sessionId: 'dead', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password', revokedOn: 5 }
    ] as ActiveSession[]

    expect(await isActiveSessionRevoked(db, 'unknown')).toBe(true)
    expect(await isActiveSessionRevoked(db, 'dead')).toBe(true)
    expect(await isActiveSessionRevoked(db, 'live')).toBe(false)
  })
})

describe('touchActiveSession', () => {
  it('updates lastSeen of an active session only', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 'live', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password' },
      { sessionId: 'dead', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password', revokedOn: 5 }
    ] as ActiveSession[]

    await touchActiveSession(db, 'live', 123)
    await touchActiveSession(db, 'dead', 123)

    expect(activeSession.rows.find((r) => r.sessionId === 'live')?.lastSeen).toBe(123)
    expect(activeSession.rows.find((r) => r.sessionId === 'dead')?.lastSeen).toBe(1)
  })
})

describe('revokeActiveSession', () => {
  it('returns false for an unknown session', async () => {
    const { db } = makeDb()
    expect(await revokeActiveSession(ctx, db, ACC, 'nope')).toBe(false)
  })

  it("returns false when the session belongs to another account", async () => {
    const { db, activeSession, securityLoginEvent } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: OTHER, createdOn: 1, lastSeen: 1, authMethod: 'password' }
    ] as ActiveSession[]
    expect(await revokeActiveSession(ctx, db, ACC, 's1')).toBe(false)
    expect(activeSession.rows[0].revokedOn).toBeUndefined()
    expect(securityLoginEvent.rows).toHaveLength(0)
  })

  it('revokes, records a logout event, and is idempotent', async () => {
    const { db, activeSession, securityLoginEvent } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: ACC, workspaceUuid: WS, createdOn: 1, lastSeen: 1, authMethod: 'password', ip: '1.2.3.4' }
    ] as ActiveSession[]

    const ok = await revokeActiveSession(ctx, db, ACC, 's1')
    expect(ok).toBe(true)
    expect(activeSession.rows[0].revokedOn).toBeDefined()
    expect(activeSession.rows[0].revokedReason).toBe('user')

    const logout = securityLoginEvent.rows.find((e) => e.eventType === 'logout')
    expect(logout).toBeDefined()
    expect(logout?.sessionId).toBe('s1')
    expect(logout?.reason).toBe('session_revoked')

    // Second revoke is a no-op.
    expect(await revokeActiveSession(ctx, db, ACC, 's1')).toBe(false)
    expect(securityLoginEvent.rows.filter((e) => e.eventType === 'logout')).toHaveLength(1)
  })

  it('uses a distinct reason for the "not me" flow', async () => {
    const { db, activeSession, securityLoginEvent } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'otp' }
    ] as ActiveSession[]

    await revokeActiveSession(ctx, db, ACC, 's1', 'user-not-me')
    expect(activeSession.rows[0].revokedReason).toBe('user-not-me')
    expect(securityLoginEvent.rows.find((e) => e.eventType === 'logout')?.reason).toBe('session_revoked_not_me')
  })

  it('invokes the revoke notifier with session details', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: ACC, workspaceUuid: WS, createdOn: 1, lastSeen: 1, authMethod: 'password' }
    ] as ActiveSession[]

    const notifier = jest.fn()
    setSessionRevokeNotifier(notifier)

    await revokeActiveSession(ctx, db, ACC, 's1')
    expect(notifier).toHaveBeenCalledWith({ accountUuid: ACC, workspaceUuid: WS, sessionId: 's1' })
  })

  it('does not fail the revoke when the notifier throws', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: ACC, createdOn: 1, lastSeen: 1, authMethod: 'password' }
    ] as ActiveSession[]

    setSessionRevokeNotifier(() => {
      throw new Error('queue down')
    })

    expect(await revokeActiveSession(ctx, db, ACC, 's1')).toBe(true)
    expect(activeSession.rows[0].revokedOn).toBeDefined()
  })
})
