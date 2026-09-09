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

import cardPlugin from '@hcengineering/card'
import type { Card } from '@hcengineering/card'
import core, { TxFactory, TxProcessor } from '@hcengineering/core'
import type { Ref, Space, TxCreateDoc, TxCUD } from '@hcengineering/core'
import process from '@hcengineering/process'
import type { Execution, MethodParams, Process } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'
import { CreateCard } from '../functions'

const parentSpace = 'parent-space' as Ref<Space>
const selectedSpace = 'selected-space' as Ref<Space>

describe('CreateCard space', () => {
  it.each([
    { name: 'explicit space', params: { space: selectedSpace }, expectedSpace: selectedSpace },
    { name: 'required fields', params: { requiredFields: { space: selectedSpace } }, expectedSpace: selectedSpace },
    { name: 'bound attribute', params: { spaceSlot: selectedSpace }, expectedSpace: selectedSpace },
    { name: 'unspecified space', params: {}, expectedSpace: parentSpace }
  ])('uses $name for the card, child execution and rollback', async ({ params, expectedSpace }) => {
    const execution: Partial<Execution> = {
      _id: 'execution' as Ref<Execution>,
      process: 'parent-process' as Ref<Process>,
      space: parentSpace
    }
    const hierarchy = {
      getAllAttributes: () => new Map(),
      getAncestors: () => [cardPlugin.class.Card],
      isDerived: (_class: string, base: string) => base === cardPlugin.class.Card
    }
    const model = {
      findObject: () => ({ bindings: { spaceSlot: 'space' } }),
      findAllSync: (_class: string) =>
        _class === process.class.Process ? [{ _id: 'child-process' }] : [{ _id: 'initial-transition' }]
    }
    const control = {
      client: {
        getModel: () => model,
        getHierarchy: () => hierarchy,
        txFactory: new TxFactory(core.account.System)
      }
    } as unknown as ProcessControl

    const cardParams: MethodParams<Card> = { _class: cardPlugin.class.Card, title: 'New card', ...params }
    const result = await CreateCard(cardParams, execution as Execution, control)

    if (!('txes' in result) || result.rollback === undefined) {
      throw new Error('Expected card creation to succeed with rollback transactions')
    }
    expect(result.txes).toHaveLength(2)
    expect(result.rollback).toHaveLength(2)
    for (const tx of [...result.txes, ...result.rollback]) {
      expect((tx as TxCUD<Card>).objectSpace).toBe(expectedSpace)
    }
    const cardTx = result.txes[0] as TxCreateDoc<Card>
    const childTx = result.txes[1] as TxCreateDoc<Execution>
    expect(cardTx.attributes).not.toHaveProperty('space')
    expect(TxProcessor.createDoc2Doc(cardTx).space).toBe(expectedSpace)
    expect(childTx.attributes.card).toBe(cardTx.objectId)
    expect(result.context).toEqual([{ _id: cardTx.objectId, value: TxProcessor.createDoc2Doc(cardTx) }])
    expect(execution.space).toBe(parentSpace)
  })
})
