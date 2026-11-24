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

import { normalizeExternalSource, type AccountUuid } from '@hcengineering/core'
import { generateToken } from '@hcengineering/server-token'
import { ensureExternalIdentity } from './external-identity'
import type { AccountDB } from './types'

interface UserSession {
  extra?: Record<string, string>
  exp?: number
  nbf?: number
}

interface OAuthAccess {
  connectionId: string
  session: UserSession
}

/** Issues an author-bound token after the caller has authorized the credential's lifecycle. */
export async function issueExternalAccess (
  db: AccountDB,
  account: AccountUuid,
  requestedSource: string,
  access: OAuthAccess
): Promise<{ token: string, source: string }> {
  const source = normalizeExternalSource(requestedSource)
  const identity = await ensureExternalIdentity(db, account, source)
  const session = access.session
  const extra: Record<string, string> = {
    ...session.extra,
    externalSource: source,
    externalSocialId: identity._id,
    externalConnectionId: access.connectionId
  }
  return {
    source,
    token: generateToken(account, undefined, extra, undefined, { exp: session.exp, nbf: session.nbf })
  }
}
