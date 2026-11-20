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

import { externalIdentityValue, SocialIdType, type AccountUuid } from '@hcengineering/core'
import type { AccountDB, SocialId } from './types'

/** Resolves one immutable author per user and source, including concurrent first connections. */
export async function ensureExternalIdentity (db: AccountDB, account: AccountUuid, source: string): Promise<SocialId> {
  const value = externalIdentityValue(account, source)
  const query = { type: SocialIdType.EXTERNAL, value }
  let identity = await db.socialId.findOne(query)
  if (identity === null) {
    const data: Omit<SocialId, '_id' | 'key'> = {
      ...query,
      personUuid: account,
      verifiedOn: Date.now(),
      displayValue: source.trim()
    }
    try {
      const id = await db.socialId.insertOne(data)
      identity = { ...data, _id: id, key: `${query.type}:${value}` }
    } catch (error: unknown) {
      // A competing request can win the unique (type, value) insert.
      identity = await db.socialId.findOne(query)
      if (identity === null) throw error
    }
  }
  if (identity.personUuid !== account || identity.isDeleted === true || identity.verifiedOn == null) {
    throw new Error('External identity does not belong to the authenticated account')
  }
  return identity
}
