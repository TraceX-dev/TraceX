// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { getClient } from '@hcengineering/account-client'
import type { TraceXAuthInfo } from './auth'
import type { McpConfig } from './config'

/** Checks administrator-configured package authoring access for an authenticated account. */
export type PackageAuthorizer = (auth: TraceXAuthInfo) => Promise<boolean>

/** Resolves verified email identities on every call; package authorship remains UUID-based. */
export function createPackageAuthorizer (
  config: Pick<McpConfig, 'AccountsURL' | 'PackageAuthorAccounts' | 'PackageAuthorEmails'>
): PackageAuthorizer {
  const emails = [
    ...new Set((config.PackageAuthorEmails ?? []).map((email) => email.trim().toLowerCase()).filter(Boolean))
  ]
  return async (auth): Promise<boolean> => {
    if (config.PackageAuthorAccounts?.includes(auth.extra.account) === true) return true
    if (emails.length === 0) return false
    const client = getClient(config.AccountsURL, auth.extra.accountToken)
    for (const email of emails) {
      if ((await client.resolveAccountByEmail(email)) === auth.extra.account) return true
    }
    return false
  }
}
