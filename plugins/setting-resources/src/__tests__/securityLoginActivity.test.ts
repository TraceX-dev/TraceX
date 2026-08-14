//
// Copyright © TraceX SAS 2026
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import type { SecurityLoginHistoryEvent } from '@hcengineering/account-client'
import {
  classifyLoginHistoryRow,
  coalesceLoginHistory,
  decodeSessionIdFromToken,
  filterHistoryByStatus,
  filterKnownAnomalyCodes,
  formatLocation,
  getShortUserAgent,
  hasAnomalies,
  isRoutineEvent,
  maskIpAddress,
  parseUserAgent,
  shouldShowNotMeAction
} from '../securityLoginActivity'

function makeEvent (
  partial: Partial<SecurityLoginHistoryEvent> & Pick<SecurityLoginHistoryEvent, 'id' | 'eventTime'>
): SecurityLoginHistoryEvent {
  return {
    accountUuid: 'acc-1' as SecurityLoginHistoryEvent['accountUuid'],
    success: true,
    authMethod: 'session',
    createdOn: partial.eventTime,
    ...partial
  }
}

describe('securityLoginActivity helpers', () => {
  it('masks IPv4 addresses for profile display', () => {
    expect(maskIpAddress('192.168.12.200')).toBe('192.168.***.***')
  })

  it('masks IPv6 and short IPv6 forms', () => {
    expect(maskIpAddress('2001:db8::1')).toBe('2001:db8:***')
    expect(maskIpAddress('::1')).toMatch(/\*\*\*/)
  })

  it('masks non-dotted IP strings', () => {
    expect(maskIpAddress('not-an-ip')).toBe('***')
  })

  it('uses fallback for empty ip', () => {
    expect(maskIpAddress('')).toBe('Unknown IP')
  })

  it('formats location from city and country', () => {
    expect(formatLocation({ city: 'Berlin', country: 'DE' })).toBe('Berlin, DE')
  })

  it('uses unknown location when location fields are missing', () => {
    expect(formatLocation({})).toBe('Unknown location')
  })

  it('trims long user agent strings', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0_0) AppleWebKit/537.36 Gecko/123'
    expect(getShortUserAgent(ua).length).toBeLessThanOrEqual(80)
  })

  it('shows not-me action only for successful, non-routine logins', () => {
    expect(shouldShowNotMeAction({ success: true })).toBe(true)
    expect(shouldShowNotMeAction({ success: false })).toBe(false)
    expect(shouldShowNotMeAction({ success: true, authMethod: 'session' })).toBe(false)
    expect(shouldShowNotMeAction({ success: true, eventType: 'refresh' })).toBe(false)
    expect(shouldShowNotMeAction({ success: true, authMethod: 'password', eventType: 'login' })).toBe(true)
  })
})

describe('parseUserAgent', () => {
  it('parses Chrome on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    expect(parseUserAgent(ua)).toEqual({ label: 'Chrome on macOS', deviceKind: 'desktop' })
  })

  it('parses Safari on iOS as mobile', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
    expect(parseUserAgent(ua)).toEqual({ label: 'Safari on iOS', deviceKind: 'mobile' })
  })

  it('parses Edge on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0'
    expect(parseUserAgent(ua)).toEqual({ label: 'Edge on Windows', deviceKind: 'desktop' })
  })

  it('parses Chrome on Android as mobile', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36'
    expect(parseUserAgent(ua)).toEqual({ label: 'Chrome on Android', deviceKind: 'mobile' })
  })

  it('falls back to a short raw string when nothing recognizable is found', () => {
    expect(parseUserAgent('SomeCustomBot/1.0')).toEqual({ label: 'SomeCustomBot/1.0', deviceKind: 'unknown' })
  })

  it('returns Unknown device for empty input', () => {
    expect(parseUserAgent(undefined)).toEqual({ label: 'Unknown device', deviceKind: 'unknown' })
    expect(parseUserAgent('')).toEqual({ label: 'Unknown device', deviceKind: 'unknown' })
  })
})

describe('anomaly helpers', () => {
  it('filters to known codes only, deduplicated', () => {
    expect(filterKnownAnomalyCodes(['new_country_for_account', 'made_up_code', 'new_country_for_account'])).toEqual([
      'new_country_for_account'
    ])
  })

  it('treats missing/empty codes as no anomalies', () => {
    expect(hasAnomalies(undefined)).toBe(false)
    expect(hasAnomalies([])).toBe(false)
    expect(hasAnomalies(['unrecognized'])).toBe(false)
  })

  it('reports anomalies when a known code is present', () => {
    expect(hasAnomalies(['impossible_travel_suspected'])).toBe(true)
  })
})

describe('isRoutineEvent', () => {
  it('prefers eventType over authMethod when both are present', () => {
    expect(isRoutineEvent({ eventType: 'login', authMethod: 'session' })).toBe(false)
    expect(isRoutineEvent({ eventType: 'refresh', authMethod: 'password' })).toBe(true)
  })

  it('falls back to authMethod when eventType is absent', () => {
    expect(isRoutineEvent({ authMethod: 'session' })).toBe(true)
    expect(isRoutineEvent({ authMethod: 'password' })).toBe(false)
  })
})

describe('filterHistoryByStatus', () => {
  const events: SecurityLoginHistoryEvent[] = [
    makeEvent({ id: '2', eventTime: 200, success: true }),
    makeEvent({ id: '1', eventTime: 100, success: false })
  ]

  it('returns everything for "all"', () => {
    expect(filterHistoryByStatus(events, 'all')).toEqual(events)
  })

  it('keeps only successful events for "success"', () => {
    expect(filterHistoryByStatus(events, 'success').map((e) => e.id)).toEqual(['2'])
  })

  it('keeps only failed events for "failed"', () => {
    expect(filterHistoryByStatus(events, 'failed').map((e) => e.id)).toEqual(['1'])
  })
})

describe('coalesceLoginHistory', () => {
  it('returns an empty array for no input', () => {
    expect(coalesceLoginHistory([])).toEqual([])
  })

  it('groups consecutive same-signature events into one entry with a count', () => {
    const events: SecurityLoginHistoryEvent[] = [
      makeEvent({ id: '3', eventTime: 300, ip: '1.1.1.1', userAgent: 'Chrome' }),
      makeEvent({ id: '2', eventTime: 200, ip: '1.1.1.1', userAgent: 'Chrome' }),
      makeEvent({ id: '1', eventTime: 100, ip: '1.1.1.1', userAgent: 'Chrome' })
    ]
    const groups = coalesceLoginHistory(events)
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(3)
    expect(groups[0].ids).toEqual(['3', '2', '1'])
    expect(groups[0].firstEventTime).toBe(100)
    expect(groups[0].lastEventTime).toBe(300)
    // Keep the newest event as the representative.
    expect(groups[0].event.id).toBe('3')
  })

  it('starts a new group when any signature field changes', () => {
    const events: SecurityLoginHistoryEvent[] = [
      makeEvent({ id: '4', eventTime: 400, ip: '1.1.1.1', userAgent: 'Chrome' }),
      makeEvent({ id: '3', eventTime: 300, ip: '2.2.2.2', userAgent: 'Chrome' }),
      makeEvent({ id: '2', eventTime: 200, ip: '2.2.2.2', userAgent: 'Firefox' }),
      makeEvent({ id: '1', eventTime: 100, ip: '2.2.2.2', userAgent: 'Firefox', success: false })
    ]
    const groups = coalesceLoginHistory(events)
    expect(groups.map((g) => g.count)).toEqual([1, 1, 1, 1])
    expect(groups.map((g) => g.id)).toEqual(['4', '3', '2', '1'])
  })

  it('does not merge non-consecutive matches', () => {
    const events: SecurityLoginHistoryEvent[] = [
      makeEvent({ id: '3', eventTime: 300, ip: '1.1.1.1', userAgent: 'Chrome' }),
      makeEvent({ id: '2', eventTime: 200, ip: '2.2.2.2', userAgent: 'Chrome' }),
      makeEvent({ id: '1', eventTime: 100, ip: '1.1.1.1', userAgent: 'Chrome' })
    ]
    const groups = coalesceLoginHistory(events)
    expect(groups).toHaveLength(3)
  })

  it('treats undefined and empty string fields as equivalent', () => {
    const events: SecurityLoginHistoryEvent[] = [
      makeEvent({ id: '2', eventTime: 200, ip: undefined, city: '' }),
      makeEvent({ id: '1', eventTime: 100, ip: '', city: undefined })
    ]
    const groups = coalesceLoginHistory(events)
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(2)
  })

  it('does not collapse password events even when signature matches', () => {
    const events: SecurityLoginHistoryEvent[] = [
      makeEvent({ id: '3', eventTime: 300, authMethod: 'password', ip: '1.1.1.1', userAgent: 'Chrome' }),
      makeEvent({ id: '2', eventTime: 200, authMethod: 'password', ip: '1.1.1.1', userAgent: 'Chrome' }),
      makeEvent({ id: '1', eventTime: 100, authMethod: 'password', ip: '1.1.1.1', userAgent: 'Chrome' })
    ]
    const groups = coalesceLoginHistory(events)
    // Do not collapse separate interactive logins.
    expect(groups).toHaveLength(3)
    expect(groups.every((g) => g.count === 1)).toBe(true)
  })

  it('does not collapse otp or token events', () => {
    const events: SecurityLoginHistoryEvent[] = [
      makeEvent({ id: '4', eventTime: 400, authMethod: 'otp', ip: '1.1.1.1' }),
      makeEvent({ id: '3', eventTime: 300, authMethod: 'otp', ip: '1.1.1.1' }),
      makeEvent({ id: '2', eventTime: 200, authMethod: 'token', ip: '1.1.1.1' }),
      makeEvent({ id: '1', eventTime: 100, authMethod: 'token', ip: '1.1.1.1' })
    ]
    expect(coalesceLoginHistory(events)).toHaveLength(4)
  })

  it('does not collapse failed events even when authMethod is session', () => {
    const events: SecurityLoginHistoryEvent[] = [
      makeEvent({ id: '2', eventTime: 200, authMethod: 'session', success: false, ip: '1.1.1.1' }),
      makeEvent({ id: '1', eventTime: 100, authMethod: 'session', success: false, ip: '1.1.1.1' })
    ]
    expect(coalesceLoginHistory(events)).toHaveLength(2)
  })

  it('coalesces a session run but keeps surrounding password events separate', () => {
    const events: SecurityLoginHistoryEvent[] = [
      makeEvent({ id: '5', eventTime: 500, authMethod: 'password', ip: '1.1.1.1' }),
      makeEvent({ id: '4', eventTime: 400, authMethod: 'session', ip: '1.1.1.1' }),
      makeEvent({ id: '3', eventTime: 300, authMethod: 'session', ip: '1.1.1.1' }),
      makeEvent({ id: '2', eventTime: 200, authMethod: 'session', ip: '1.1.1.1' }),
      makeEvent({ id: '1', eventTime: 100, authMethod: 'password', ip: '1.1.1.1' })
    ]
    const groups = coalesceLoginHistory(events)
    expect(groups.map((g) => g.count)).toEqual([1, 3, 1])
    expect(groups[1].ids).toEqual(['4', '3', '2'])
  })

  it('coalesces refresh-typed events by eventType even with authMethod token', () => {
    const events: SecurityLoginHistoryEvent[] = [
      makeEvent({ id: '3', eventTime: 300, authMethod: 'token', eventType: 'refresh', ip: '1.1.1.1' }),
      makeEvent({ id: '2', eventTime: 200, authMethod: 'token', eventType: 'refresh', ip: '1.1.1.1' }),
      makeEvent({ id: '1', eventTime: 100, authMethod: 'password', eventType: 'login', ip: '1.1.1.1' })
    ]
    const groups = coalesceLoginHistory(events)
    expect(groups.map((g) => g.count)).toEqual([2, 1])
    expect(groups[0].ids).toEqual(['3', '2'])
  })
})

function makeJwt (payload: Record<string, any>): string {
  const base64 = (obj: Record<string, any>): string => btoa(JSON.stringify(obj))
  return `${base64({ alg: 'HS256' })}.${base64(payload)}.signature`
}

describe('decodeSessionIdFromToken', () => {
  it('returns undefined for null/empty/malformed tokens', () => {
    expect(decodeSessionIdFromToken(undefined)).toBeUndefined()
    expect(decodeSessionIdFromToken(null)).toBeUndefined()
    expect(decodeSessionIdFromToken('')).toBeUndefined()
    expect(decodeSessionIdFromToken('not-a-jwt')).toBeUndefined()
  })

  it('extracts the sessionId claim from a well-formed token', () => {
    const token = makeJwt({ account: 'acc-1', sessionId: 'sess-123' })
    expect(decodeSessionIdFromToken(token)).toBe('sess-123')
  })

  it('returns undefined when the token carries no sessionId', () => {
    const token = makeJwt({ account: 'acc-1' })
    expect(decodeSessionIdFromToken(token)).toBeUndefined()
  })
})

describe('classifyLoginHistoryRow', () => {
  const current = { sessionId: 'sess-current', ip: '1.2.3.4', deviceKnown: true, deviceLabel: 'Chrome on macOS' }

  it('flags an exact session match as currentSession, even with a different IP', () => {
    const badge = classifyLoginHistoryRow(
      { sessionId: 'sess-current', ip: '9.9.9.9' },
      true,
      'Chrome on macOS',
      current
    )
    expect(badge).toBe('currentSession')
  })

  it('flags a matching IP under a different session as sameIp', () => {
    const badge = classifyLoginHistoryRow(
      { sessionId: 'sess-other', ip: '1.2.3.4' },
      true,
      'Firefox on Windows',
      current
    )
    expect(badge).toBe('sameIp')
  })

  it('flags a known, different device (different session, different IP) as otherDevice', () => {
    const badge = classifyLoginHistoryRow(
      { sessionId: 'sess-other', ip: '9.9.9.9' },
      true,
      'Firefox on Windows',
      current
    )
    expect(badge).toBe('otherDevice')
  })

  it('does not guess otherDevice when either device label is unknown', () => {
    expect(
      classifyLoginHistoryRow({ sessionId: 'sess-other', ip: '9.9.9.9' }, false, 'Unknown device', current)
    ).toBeUndefined()
    expect(
      classifyLoginHistoryRow({ sessionId: 'sess-other', ip: '9.9.9.9' }, true, 'Firefox on Windows', {
        ...current,
        deviceKnown: false
      })
    ).toBeUndefined()
  })

  it('returns undefined when nothing about the current session is known', () => {
    const badge = classifyLoginHistoryRow({ sessionId: 'sess-other', ip: '9.9.9.9' }, true, 'Firefox on Windows', {
      deviceKnown: false,
      deviceLabel: 'Unknown device'
    })
    expect(badge).toBeUndefined()
  })
})
