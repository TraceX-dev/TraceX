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

import { SocialIdType, type AccountUuid, type PersonId } from '@hcengineering/core'
import type { AccountDB, Query, SocialId } from '../types'

export const account = '3529632b-872d-43e0-8a31-6a54251593ce' as AccountUuid

export function identityDatabase (): { db: AccountDB, identities: Map<string, SocialId> } {
  const identities = new Map<string, SocialId>()
  const socialId: Partial<AccountDB['socialId']> = {
    findOne: jest.fn(async (query: Query<SocialId>) =>
      typeof query.value === 'string' ? (identities.get(query.value) ?? null) : null
    ),
    insertOne: jest.fn(async (data: Partial<SocialId>) => {
      if (data.value === undefined || data.personUuid === undefined) throw new Error('Incomplete identity fixture')
      const identity: SocialId = {
        _id: `external-${identities.size + 1}` as PersonId,
        type: SocialIdType.EXTERNAL,
        value: data.value,
        key: `external:${data.value}`,
        personUuid: data.personUuid,
        verifiedOn: data.verifiedOn,
        displayValue: data.displayValue
      }
      identities.set(identity.value, identity)
      return identity._id
    })
  }
  const db: Partial<AccountDB> = { socialId: socialId as AccountDB['socialId'] }
  return { db: db as AccountDB, identities }
}
