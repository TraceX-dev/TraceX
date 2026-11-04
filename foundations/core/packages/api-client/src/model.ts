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

import type { FullModelResponse, Tx, TxPersistenceStore } from '@hcengineering/core'
import { calculateModelHashSync } from '@hcengineering/core/model-hash-node'

export async function createModelSnapshot (model?: Tx[]): Promise<FullModelResponse> {
  if (model === undefined) {
    return { kind: 'full', hash: '', systemTx: [], userTx: [] }
  }
  // Each connection owns its transactions; model construction must not mutate the caller's bundle.
  const systemTx = JSON.parse(JSON.stringify(model)) as Tx[]
  const hash = calculateModelHashSync(systemTx)
  return { kind: 'full', hash, systemTx, userTx: [] }
}

/** Create independent model persistence for a connection, optionally seeded with system transactions.
 * @public
 */
export async function createModelPersistence (model?: Tx[]): Promise<TxPersistenceStore> {
  let current: FullModelResponse = await createModelSnapshot(model)
  return {
    load: async () => structuredClone(current),
    store: async (model) => {
      current = structuredClone(model)
    }
  }
}
