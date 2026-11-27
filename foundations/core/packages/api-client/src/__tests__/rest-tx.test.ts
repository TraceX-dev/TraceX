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

import { AccountRole, Hierarchy, ModelDb, type Account, type AccountUuid, type PersonId } from '@hcengineering/core'
import { RestClientImpl } from '../rest/rest'
import { createRestTxOperations } from '../rest/tx'

afterEach(() => {
  jest.restoreAllMocks()
})

it('exposes the authenticated account and uses its selected author without another account request', async () => {
  const humanId = 'human-author' as PersonId
  const externalId = 'external-author' as PersonId
  const account: Account = {
    uuid: '3529632b-872d-43e0-8a31-6a54251593ce' as AccountUuid,
    role: AccountRole.User,
    primarySocialId: humanId,
    socialId: externalId,
    socialIds: [humanId, externalId],
    fullSocialIds: []
  }
  const hierarchy = new Hierarchy()
  const getAccount = jest.spyOn(RestClientImpl.prototype, 'getAccount').mockResolvedValue(account)
  jest.spyOn(RestClientImpl.prototype, 'getModel').mockResolvedValue({ hierarchy, model: new ModelDb(hierarchy) })
  const operations = await createRestTxOperations('http://transactor.test', 'workspace', 'private-token')
  expect(operations.account).toBe(account)
  expect(operations.user).toBe(externalId)
  expect(operations.account.primarySocialId).toBe(humanId)
  expect(getAccount).toHaveBeenCalledTimes(1)
  await operations.close()
})
