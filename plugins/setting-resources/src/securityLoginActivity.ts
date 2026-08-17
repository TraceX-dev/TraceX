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
import type { SecurityLoginHistoryEvent } from '@hcengineering/account-client'

const MAX_USER_AGENT_LENGTH = 80

export function maskIpAddress (ip?: string): string {
  if (ip == null || ip.trim() === '') return 'Unknown IP'

  const trimmed = ip.trim()

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').filter((part) => part.length > 0)
    if (parts.length === 0) return '***'
    if (parts.length === 1) return `${parts[0].slice(0, 8)}:***`
    return `${parts.slice(0, 2).join(':')}:***`
  }

  const octets = trimmed.split('.')
  if (octets.length !== 4) return '***'
  return `${octets[0]}.${octets[1]}.***.***`
}

export function formatLocation (event: Partial<Pick<SecurityLoginHistoryEvent, 'city' | 'country'>>): string {
  const location = [event.city, event.country].filter((value): value is string => value != null && value.trim() !== '')
  return location.length > 0 ? location.join(', ') : 'Unknown location'
}

export function getShortUserAgent (userAgent?: string): string {
  if (userAgent == null || userAgent.trim() === '') return 'Unknown device'
  if (userAgent.length <= MAX_USER_AGENT_LENGTH) return userAgent
  return `${userAgent.slice(0, MAX_USER_AGENT_LENGTH - 1)}…`
}

/** Device family used for the display icon. */
export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'unknown'

export interface ParsedUserAgent {
  /** Display label, with a shortened raw-UA fallback. */
  label: string
  deviceKind: DeviceKind
}

// Keep specific browsers before their shared Chrome token.
const BROWSER_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/edg(a|ios|)\//i, 'Edge'],
  [/opr\/|opios\/|opera/i, 'Opera'],
  [/samsungbrowser\//i, 'Samsung Internet'],
  [/crios\//i, 'Chrome'],
  [/fxios\//i, 'Firefox'],
  [/chrome\//i, 'Chrome'],
  [/firefox\//i, 'Firefox'],
  [/version\/[\d.]+.*safari/i, 'Safari'],
  [/safari\//i, 'Safari']
]

const OS_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/windows nt/i, 'Windows'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/mac os x|macintosh/i, 'macOS'],
  [/cros/i, 'ChromeOS'],
  [/android/i, 'Android'],
  [/linux/i, 'Linux']
]

function detect (patterns: ReadonlyArray<[RegExp, string]>, ua: string): string | undefined {
  for (const [pattern, name] of patterns) {
    if (pattern.test(ua)) return name
  }
  return undefined
}

function detectDeviceKind (ua: string, os: string | undefined): DeviceKind {
  if (/ipad/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet'
  if (/iphone|ipod/i.test(ua) || os === 'iOS' || (os === 'Android' && /mobile/i.test(ua))) return 'mobile'
  if (os === 'Android') return 'tablet'
  if (os === 'Windows' || os === 'macOS' || os === 'Linux' || os === 'ChromeOS') return 'desktop'
  return 'unknown'
}

/** Builds a short device label and family from a User-Agent. */
export function parseUserAgent (userAgent?: string): ParsedUserAgent {
  const ua = userAgent?.trim() ?? ''
  if (ua === '') return { label: 'Unknown device', deviceKind: 'unknown' }

  const browser = detect(BROWSER_PATTERNS, ua)
  const os = detect(OS_PATTERNS, ua)
  const deviceKind = detectDeviceKind(ua, os)

  if (browser !== undefined && os !== undefined) return { label: `${browser} on ${os}`, deviceKind }
  if (browser !== undefined) return { label: browser, deviceKind }
  if (os !== undefined) return { label: os, deviceKind }
  return { label: getShortUserAgent(ua), deviceKind: 'unknown' }
}

/** Anomaly codes supported by the UI. */
const KNOWN_ANOMALY_CODES = new Set<string>([
  'new_country_for_account',
  'impossible_travel_suspected',
  'repeated_failed_attempts_from_ip'
])

export function filterKnownAnomalyCodes (codes?: string[]): string[] {
  if (codes == null || codes.length === 0) return []
  return Array.from(new Set(codes.filter((code) => KNOWN_ANOMALY_CODES.has(code))))
}

export function hasAnomalies (codes?: string[]): boolean {
  return filterKnownAnomalyCodes(codes).length > 0
}

/** Identifies session upkeep; authMethod is a fallback for legacy events. */
export function isRoutineEvent (event: Partial<Pick<SecurityLoginHistoryEvent, 'authMethod' | 'eventType'>>): boolean {
  if (event.eventType != null) return event.eventType === 'refresh' || event.eventType === 'session'
  return event.authMethod === 'session'
}

/** Login history status filter. */
export type LoginHistoryStatusFilter = 'all' | 'success' | 'failed'

export function filterHistoryByStatus (
  events: SecurityLoginHistoryEvent[],
  filter: LoginHistoryStatusFilter
): SecurityLoginHistoryEvent[] {
  if (filter === 'all') return events
  return events.filter((event) => (filter === 'success' ? event.success : !event.success))
}

export function shouldShowNotMeAction (
  event: Pick<SecurityLoginHistoryEvent, 'success'> &
  Partial<Pick<SecurityLoginHistoryEvent, 'authMethod' | 'eventType'>>
): boolean {
  return event.success && !isRoutineEvent(event)
}

/** Consecutive equivalent events collapsed into one row. */
export interface SecurityLoginHistoryGroup {
  id: string
  event: SecurityLoginHistoryEvent
  count: number
  firstEventTime: number
  lastEventTime: number
  ids: string[]
}

function sameSignature (a: SecurityLoginHistoryEvent, b: SecurityLoginHistoryEvent): boolean {
  return (
    a.authMethod === b.authMethod &&
    a.success === b.success &&
    (a.ip ?? '') === (b.ip ?? '') &&
    (a.country ?? '') === (b.country ?? '') &&
    (a.city ?? '') === (b.city ?? '') &&
    (a.userAgent ?? '') === (b.userAgent ?? '')
  )
}

/** Only successful routine events can be collapsed. */
function isCoalescable (event: SecurityLoginHistoryEvent): boolean {
  return event.success && isRoutineEvent(event)
}

/** Collapses consecutive equivalent events from a newest-first list. */
export function coalesceLoginHistory (events: SecurityLoginHistoryEvent[]): SecurityLoginHistoryGroup[] {
  const groups: SecurityLoginHistoryGroup[] = []
  for (const event of events) {
    const last = groups[groups.length - 1]
    if (last !== undefined && isCoalescable(event) && isCoalescable(last.event) && sameSignature(last.event, event)) {
      last.count += 1
      last.firstEventTime = Math.min(last.firstEventTime, event.eventTime)
      last.lastEventTime = Math.max(last.lastEventTime, event.eventTime)
      last.ids.push(event.id)
      continue
    }
    groups.push({
      id: event.id,
      event,
      count: 1,
      firstEventTime: event.eventTime,
      lastEventTime: event.eventTime,
      ids: [event.id]
    })
  }
  return groups
}

/** Reads sessionId for display only; the server enforces revocation. */
export function decodeSessionIdFromToken (token: string | null | undefined): string | undefined {
  if (token == null || token === '') return undefined
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(decodeURIComponent(escape(atob(base64))))
    return typeof payload.sessionId === 'string' && payload.sessionId !== '' ? payload.sessionId : undefined
  } catch {
    return undefined
  }
}

/** Login history row badge. */
export type LoginHistoryRowBadge = 'currentSession' | 'sameIp' | 'otherDevice'

/** Classifies a row against the current session. */
export function classifyLoginHistoryRow (
  event: Pick<SecurityLoginHistoryEvent, 'sessionId' | 'ip'>,
  eventDeviceKnown: boolean,
  eventDeviceLabel: string,
  current: { sessionId?: string, ip?: string, deviceKnown: boolean, deviceLabel: string }
): LoginHistoryRowBadge | undefined {
  if (current.sessionId !== undefined && event.sessionId !== undefined && event.sessionId === current.sessionId) {
    return 'currentSession'
  }
  if (current.ip !== undefined && event.ip !== undefined && event.ip === current.ip) {
    return 'sameIp'
  }
  if (current.deviceKnown && eventDeviceKnown && current.deviceLabel !== eventDeviceLabel) {
    return 'otherDevice'
  }
  return undefined
}
