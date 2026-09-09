//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import login from '@hcengineering/login'
import { getMetadata, setMetadata } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'
import { getAccount } from '@hcengineering/login-resources'
import { fetchMetadataLocalStorage, setMetadataLocalStorage } from '@hcengineering/ui'

export async function connect (): Promise<void> {
  console.log('[Admin.connect] Authentication metadata', {
    hasToken: getMetadata(presentation.metadata.Token) != null,
    hasLastAccount: fetchMetadataLocalStorage(login.metadata.LastAccount) != null
  })

  if (getMetadata(presentation.metadata.Token) == null) {
    const lastAccount = fetchMetadataLocalStorage(login.metadata.LastAccount)
    if (lastAccount != null) {
      const loginInfo = await getAccount(false)
      if (loginInfo != null) {
        setMetadata(presentation.metadata.Token, loginInfo.token)
        setMetadataLocalStorage(login.metadata.LoginAccount, loginInfo.account)
      }
    }
  }

  console.log('[Admin.connect] Authentication restored', {
    hasToken: getMetadata(presentation.metadata.Token) != null
  })
}
