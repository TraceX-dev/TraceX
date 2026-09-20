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

import type { Card } from '@hcengineering/card'
import type { Employee } from '@hcengineering/contact'
import core, { TxFactory, TxProcessor } from '@hcengineering/core'
import type { Ref, Space, TxCreateDoc } from '@hcengineering/core'
import process from '@hcengineering/process'
import type { EventButton, Execution } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'
import { RequestAttachments } from '../functions'

const execution = {
  _id: 'execution' as Ref<Execution>,
  space: 'space' as Ref<Space>,
  card: 'card' as Ref<Card>
} as Execution
const control = {
  client: { txFactory: new TxFactory(core.account.System) }
} as unknown as ProcessControl
const params = {
  title: 'Upload documents',
  eventType: 'documents-uploaded',
  user: 'user' as Ref<Employee>
}

describe('RequestAttachments', () => {
  it('creates an attachment request with rollback', async () => {
    const result = await RequestAttachments(params, execution, control)
    if (!('txes' in result)) throw new Error('Expected request creation transactions')
    expect(result.txes).toHaveLength(1)
    const tx = result.txes[0] as TxCreateDoc<EventButton>
    expect(tx.objectClass).toBe(process.class.EventButton)
    expect(tx.objectSpace).toBe(execution.space)
    expect(tx.attributes).toMatchObject({
      ...params,
      requireAttachments: true,
      execution: execution._id,
      card: execution.card
    })
    expect(result.rollback).toEqual([
      expect.objectContaining({ _class: core.class.TxRemoveDoc, objectId: tx.objectId })
    ])
    expect(result.context).toEqual([{ _id: tx.objectId, value: TxProcessor.createDoc2Doc(tx, true) }])
  })

  it.each(['title', 'eventType', 'user'])('rejects a missing %s', async (key) => {
    await expect(RequestAttachments({ ...params, [key]: undefined }, execution, control)).rejects.toBeDefined()
  })
})
