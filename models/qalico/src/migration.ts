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

import { type CardSpace } from '@hcengineering/card'
import core, { TxOperations } from '@hcengineering/core'
import { type MigrationUpgradeClient, type MigrateOperation, tryUpgrade } from '@hcengineering/model'
import card from '@hcengineering/model-card'
import { qalicoId } from '@tracex/qalico'
import qalico from '.'

async function ensureSpace (tx: TxOperations): Promise<void> {
  const current = await tx.findOne(core.class.Space, {
    _id: qalico.space.RegulatoryMonitoring
  })
  if (current === undefined) {
    await tx.createDoc<CardSpace>(
      card.class.CardSpace,
      core.space.Space,
      {
        name: 'Regulatory Monitoring',
        description: 'Regulatory monitoring',
        private: false,
        archived: false,
        autoJoin: true,
        members: [],
        type: card.spaceType.SpaceType,
        types: [qalico.masterTag.RegulatoryUpdate]
      },
      qalico.space.RegulatoryMonitoring
    )
  }
}

export const qalicoOperation: MigrateOperation = {
  async migrate (): Promise<void> {},
  async upgrade (state: Map<string, Set<string>>, client: () => Promise<MigrationUpgradeClient>, mode): Promise<void> {
    await tryUpgrade(mode, state, client, qalicoId, [
      {
        state: 'create-defaults',
        func: async (client) => {
          const tx = new TxOperations(client, core.account.System)
          await ensureSpace(tx)
        }
      }
    ])
  }
}
