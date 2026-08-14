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

import type { MeasureContext } from '@hcengineering/core'
import type { SecurityLoginEvent } from './types'

export interface SecurityPolicyEvaluationInput {
  event: Omit<SecurityLoginEvent, 'id' | 'createdOn'>
  recentHistory: SecurityLoginEvent[]
}

export interface SecurityPolicyEvaluationResult {
  policyVersion: string
  anomalyCodes: string[]
}

export interface SecurityPolicyEngine {
  evaluateEvent: (input: SecurityPolicyEvaluationInput) => Promise<SecurityPolicyEvaluationResult>
}

export class NoopPolicyEngine implements SecurityPolicyEngine {
  async evaluateEvent (input: SecurityPolicyEvaluationInput): Promise<SecurityPolicyEvaluationResult> {
    const { event, recentHistory } = input
    const anomalyCodes = new Set<string>()

    const sameIpFailures = recentHistory.filter(
      (entry) => !entry.success && entry.ip != null && event.ip != null && entry.ip === event.ip
    )
    if (!event.success && sameIpFailures.length >= 4) {
      anomalyCodes.add('repeated_failed_attempts_from_ip')
    }

    if (event.country != null) {
      const hadGeoBaseline = recentHistory.some((entry) => entry.country != null && entry.country.trim() !== '')
      if (hadGeoBaseline) {
        const hadCountryBefore = recentHistory.some((entry) => entry.country === event.country)
        if (!hadCountryBefore) {
          anomalyCodes.add('new_country_for_account')
        }
      }
    }

    const latestSuccessful = recentHistory.find((entry) => entry.success)
    if (
      event.success &&
      latestSuccessful?.country != null &&
      event.country != null &&
      latestSuccessful.country !== event.country &&
      Math.abs(event.eventTime - latestSuccessful.eventTime) < 60 * 60 * 1000
    ) {
      anomalyCodes.add('impossible_travel_suspected')
    }

    return {
      policyVersion: 'noop-v1',
      anomalyCodes: Array.from(anomalyCodes)
    }
  }
}

let cachedPolicyEngine: SecurityPolicyEngine | undefined

const POLICY_SCOPED_PREFIX = /^@[a-z0-9-~][a-z0-9-._~]*$/i
const POLICY_UNSCOPED_ROOT = /^[a-z0-9][a-z0-9-._]*$/i
/** Valid package-name path segment. */
const POLICY_SEGMENT = /^[a-z0-9-._~]+$/i

function isValidPolicyPathSegment (s: string): boolean {
  return s.length > 0 && s.length <= 200 && POLICY_SEGMENT.test(s)
}

/** Allows npm-style policy specifiers, not paths, URLs, or traversal. */
export function isSafeSecurityPolicyModuleSpecifier (moduleName: string): boolean {
  if (moduleName.length === 0 || moduleName.length > 256) return false
  if (moduleName.includes('..') || moduleName.includes('\\')) return false
  if (moduleName.startsWith('/') || moduleName.startsWith('.')) return false
  if (/^(file|node|data|https?|worker):/i.test(moduleName)) return false
  if (moduleName.includes('//')) return false

  const parts = moduleName.split('/')
  if (parts.some((p) => p.length === 0)) return false

  if (parts[0].startsWith('@')) {
    if (!POLICY_SCOPED_PREFIX.test(parts[0])) return false
    if (parts.length === 2) return isValidPolicyPathSegment(parts[1])
    if (parts.length === 3) return isValidPolicyPathSegment(parts[1]) && isValidPolicyPathSegment(parts[2])
    return false
  }

  if (parts.length === 1) return POLICY_UNSCOPED_ROOT.test(parts[0])
  if (parts.length === 2) return POLICY_UNSCOPED_ROOT.test(parts[0]) && isValidPolicyPathSegment(parts[1])
  return false
}

export async function resolveSecurityPolicyEngine (ctx: MeasureContext): Promise<SecurityPolicyEngine> {
  if (cachedPolicyEngine != null) {
    return cachedPolicyEngine
  }

  const moduleName = process.env.SECURITY_POLICY_MODULE?.trim()
  if (moduleName == null || moduleName === '') {
    cachedPolicyEngine = new NoopPolicyEngine()
    return cachedPolicyEngine
  }

  if (!isSafeSecurityPolicyModuleSpecifier(moduleName)) {
    ctx.warn('SECURITY_POLICY_MODULE rejected (unsafe specifier), fallback to noop', { moduleName })
    cachedPolicyEngine = new NoopPolicyEngine()
    return cachedPolicyEngine
  }

  try {
    const moduleExports = await import(moduleName)
    const createEngine = moduleExports.createSecurityPolicyEngine as
      | ((ctx: MeasureContext) => SecurityPolicyEngine)
      | undefined

    if (typeof createEngine !== 'function') {
      ctx.warn('SECURITY_POLICY_MODULE loaded but createSecurityPolicyEngine is missing, fallback to noop', {
        moduleName
      })
      cachedPolicyEngine = new NoopPolicyEngine()
      return cachedPolicyEngine
    }

    cachedPolicyEngine = createEngine(ctx)
    return cachedPolicyEngine
  } catch (err) {
    ctx.warn('Failed to load private security policy module, fallback to noop', { moduleName, err })
    cachedPolicyEngine = new NoopPolicyEngine()
    return cachedPolicyEngine
  }
}
