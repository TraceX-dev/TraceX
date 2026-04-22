//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import {
  formatLocation,
  getShortUserAgent,
  maskIpAddress,
  shouldShowNotMeAction
} from '../securityLoginActivity'

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
