//
// Copyright © 2024 Hardcore Engineering Inc.
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

import client, { clientId } from '@hcengineering/client'
import { type Client, type FullModelResponse, type Tx } from '@hcengineering/core'
import { addLocation, getMetadata, getResource, setMetadata } from '@hcengineering/platform'
import crypto from 'node:crypto'
import plugin from './plugin'

/**
 * @public
 *
 * If connectTimeout is set, connect will try to connect only specified amount of time, and will return failure if failed.
 */
export async function createClient (
  transactorUrl: string,
  token: string,
  model?: Tx[],
  connectTimeout: number = 0
): Promise<Client> {
  // We need to override default factory with 'ws' one.
  // eslint-disable-next-line
  const WebSocket = require('ws')

  setMetadata(client.metadata.UseBinaryProtocol, true)
  setMetadata(client.metadata.UseProtocolCompression, true)
  setMetadata(client.metadata.ConnectionTimeout, connectTimeout)

  setMetadata(client.metadata.ClientSocketFactory, (url) => {
    const socket = new WebSocket(url, {
      headers: {
        'User-Agent': getMetadata(plugin.metadata.UserAgent) ?? 'Anticrm Client'
      }
    })
    return socket
  })
  addLocation(clientId, () => import('@hcengineering/client-resources'))

  let current: FullModelResponse =
    model !== undefined
      ? {
          hash: crypto.createHash('sha1').update(JSON.stringify(model)).digest('hex'),
          systemTx: structuredClone(model),
          userTx: [],
          kind: 'full'
        }
      : { kind: 'full', hash: '', systemTx: [], userTx: [] }
  const override = model === undefined ? getMetadata(client.metadata.OverridePersistenceStore) : undefined
  const txPersistence = override ?? {
    load: async () => structuredClone(current),
    store: async (model: FullModelResponse) => {
      current = structuredClone(model)
    }
  }

  const clientFactory = await getResource(client.function.GetClient)
  return await clientFactory(token, transactorUrl, { txPersistence })
}
