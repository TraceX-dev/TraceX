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

export function shouldShowNotMeAction (event: Pick<SecurityLoginHistoryEvent, 'success'>): boolean {
  return event.success
}

/**
 * A group of consecutive login events that share the same observable
 * attributes (auth method, success, IP, location, user agent). Used to
 * collapse noisy runs — most commonly `authMethod: 'session'` events
 * recorded on every workspace switch — into a single row in the UI.
 */
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

/**
 * Returns true for events safe to collapse into a previous identical row.
 */
function isCoalescable (event: SecurityLoginHistoryEvent): boolean {
  return event.success && event.authMethod === 'session'
}

/**
 * Collapses consecutive same-signature events into a single group.
 * Input is expected to be ordered newest-first (matching the server
 * response).
 */
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
