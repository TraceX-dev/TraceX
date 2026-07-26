//
// Copyright © 2026 TraceX.
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

import { TxOperations, WorkspaceUuid } from '@hcengineering/core'
import { RestClientAdapter, createRestClient } from '@hcengineering/api-client'
import { getTransactorEndpoint } from '@hcengineering/server-client'

export async function getClient (workspace: WorkspaceUuid, token: string): Promise<TxOperations> {
  const endpoint = await getTransactorEndpoint(token)
  const client = createRestClient(toHttpUrl(endpoint), workspace, token)
  const account = await client.getAccount()
  const { model, hierarchy } = await client.getModel()

  return new TxOperations(new RestClientAdapter(client, hierarchy, model), account.primarySocialId)
}

function toHttpUrl (url: string): string {
  return url.replace('ws://', 'http://').replace('wss://', 'https://')
}
