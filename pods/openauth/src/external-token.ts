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

import { systemAccountUuid } from '@hcengineering/core'
import { generateToken } from '@hcengineering/server-token'

/** Exchanges a stored user session over a service-authenticated channel; never calls public account RPC. */
export async function exchangeExternalAccess (
  accountsUrl: string,
  secret: string,
  accountToken: string,
  source: string,
  connectionId: string
): Promise<string> {
  const serviceToken = generateToken(systemAccountUuid, undefined, { service: 'openauth' }, secret, {
    exp: Math.floor(Date.now() / 1000) + 60
  })
  const response = await fetch(`${accountsUrl.replace(/\/+$/, '')}/internal/oauth/exchange`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountToken, source, connectionId }),
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) throw new Error('OAuth account token exchange failed')
  const result: unknown = await response.json()
  if (
    result === null ||
    typeof result !== 'object' ||
    !('token' in result) ||
    typeof result.token !== 'string' ||
    result.token === ''
  ) {
    throw new Error('Invalid OAuth account token exchange response')
  }
  return result.token
}
