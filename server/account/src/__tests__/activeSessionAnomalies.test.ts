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

import type { AccountUuid, MeasureContext } from '@hcengineering/core'
import { decodeTokenVerbose } from '@hcengineering/server-token'

import { getMyActiveSessions } from '../operations'
import type { AccountDB, ActiveSession, SecurityLoginEvent } from '../types'

jest.mock('@hcengineering/server-token', () => ({
  decodeTokenVerbose: jest.fn(),
  decodeToken: jest.fn()
}))

// ---- Minimal in-memory AccountDB collection (mirrors securitySession.test.ts) ----

function matches (row: Record<string, any>, query: Record<string, any>): boolean {
  for (const [key, cond] of Object.entries(query)) {
    const value = row[key]
    if (cond === null) {
      if (value != null) return false
    } else if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond && !(cond.$in as any[]).includes(value)) return false
    } else if (value !== cond) {
      return false
    }
  }
  return true
}

class InMemoryCollection<T extends Record<string, any>> {
  rows: T[] = []

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

describe('getMyActiveSessions anomaly flagging', () => {
  beforeEach(() => {
    ;(decodeTokenVerbose as jest.Mock).mockReturnValue({ account: ACC, sessionId: 's-current' })
  })

  it('attaches anomalyCodes from the session-creating login event', async () => {
    const { db, activeSession, securityLoginEvent } = makeDb()
    activeSession.rows = [
      { sessionId: 's-current', accountUuid: ACC, createdOn: 100, lastSeen: 200, authMethod: 'password' },
      { sessionId: 's-flagged', accountUuid: ACC, createdOn: 50, lastSeen: 60, authMethod: 'password' }
    ] as ActiveSession[]
    securityLoginEvent.rows = [
      {
        id: 'ev1',
        accountUuid: ACC,
        eventTime: 50,
        success: true,
        authMethod: 'password',
        sessionId: 's-flagged',
        anomalyCodes: ['new_country_for_account'],
        createdOn: 50
      }
    ] as SecurityLoginEvent[]

    const result = await getMyActiveSessions(ctx, db, null, 'tok', {})
    const flagged = result.find((s) => s.sessionId === 's-flagged')
    const current = result.find((s) => s.sessionId === 's-current')
    expect(flagged?.anomalyCodes).toEqual(['new_country_for_account'])
    expect(current?.anomalyCodes).toBeUndefined()
  })

  it('omits anomalyCodes entirely when nothing was flagged', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 's-current', accountUuid: ACC, createdOn: 100, lastSeen: 200, authMethod: 'password' }
    ] as ActiveSession[]

    const result = await getMyActiveSessions(ctx, db, null, 'tok', {})
    expect(result[0].anomalyCodes).toBeUndefined()
  })

  it('unions and dedupes anomaly codes across multiple matching login events', async () => {
    const { db, activeSession, securityLoginEvent } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: ACC, createdOn: 100, lastSeen: 200, authMethod: 'password' }
    ] as ActiveSession[]
    securityLoginEvent.rows = [
      {
        id: 'ev1',
        accountUuid: ACC,
        eventTime: 100,
        success: true,
        authMethod: 'password',
        sessionId: 's1',
        anomalyCodes: ['new_country_for_account'],
        createdOn: 100
      },
      {
        id: 'ev2',
        accountUuid: ACC,
        eventTime: 150,
        success: true,
        authMethod: 'session',
        sessionId: 's1',
        anomalyCodes: ['new_country_for_account', 'impossible_travel_suspected'],
        createdOn: 150
      }
    ] as SecurityLoginEvent[]

    const result = await getMyActiveSessions(ctx, db, null, 'tok', {})
    expect(result[0].anomalyCodes).toHaveLength(2)
    expect(new Set(result[0].anomalyCodes)).toEqual(new Set(['new_country_for_account', 'impossible_travel_suspected']))
  })

  it('does not fail the whole call when the anomaly lookup throws', async () => {
    const { db, activeSession } = makeDb()
    activeSession.rows = [
      { sessionId: 's1', accountUuid: ACC, createdOn: 100, lastSeen: 200, authMethod: 'password' }
    ] as ActiveSession[]
    ;(db as any).securityLoginEvent = {
      find: jest.fn().mockRejectedValue(new Error('db down'))
    }

    const result = await getMyActiveSessions(ctx, db, null, 'tok', {})
    expect(result).toHaveLength(1)
    expect(result[0].anomalyCodes).toBeUndefined()
    expect(ctx.warn as jest.Mock).toHaveBeenCalled()
  })
})
