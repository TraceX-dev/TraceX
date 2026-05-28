//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import type { SecurityLoginHistoryEvent } from '@hcengineering/account-client'
import {
  coalesceLoginHistory,
  formatLocation,
  getShortUserAgent,
  maskIpAddress,
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

  it('shows not-me action only for successful logins', () => {
    expect(shouldShowNotMeAction({ success: true })).toBe(true)
    expect(shouldShowNotMeAction({ success: false })).toBe(false)
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
    // representative event is the first one encountered (newest-first ordering).
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
    // Every real authentication keeps its own row so redacted-IP
    // collisions across distinct sources don't get hidden.
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
})
