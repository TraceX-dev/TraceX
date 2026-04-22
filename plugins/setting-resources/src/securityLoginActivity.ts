//
// Copyright © 2026 Hardcore Engineering Inc.
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
