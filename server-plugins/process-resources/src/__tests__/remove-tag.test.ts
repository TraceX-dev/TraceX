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
import type { Card, Tag } from '@hcengineering/card'
import core, { Hierarchy, TxFactory, TxProcessor } from '@hcengineering/core'
import type { Ref, Space, TxUpdateDoc } from '@hcengineering/core'
import process from '@hcengineering/process'
import type { Execution } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'
import { RemoveTag } from '../functions'

const tagId = 'test:tag:Parent' as Ref<Tag>
const childId = 'test:tag:Child' as Ref<Tag>
const grandchildId = 'test:tag:Grandchild' as Ref<Tag>
const unrelatedId = 'test:tag:Unrelated' as Ref<Tag>
const executionData: Partial<Execution> = { card: 'test:card' as Ref<Card> }
const execution = executionData as Execution

function setup (
  tags: Record<string, object> = {},
  cached = true
): {
  card: Card
  control: ProcessControl
  findOne: jest.Mock
} {
  const cardData: Partial<Card> = {
    _id: execution.card,
    _class: cardPlugin.class.Card,
    space: 'test:space' as Ref<Space>,
    ...tags
  }
  const card = cardData as Card
  const findOne = jest.fn().mockResolvedValue(card)
  const control = {
    cache: new Map(cached ? [[execution.card, card]] : []),
    client: {
      findOne,
      getModel: () => ({ findObject: () => ({ _id: tagId }) }),
      getHierarchy: () => ({
        hasMixin: (doc: Card, mixin: Ref<Tag>) => Hierarchy.hasMixin(doc, mixin),
        getDescendants: () => [tagId, childId, grandchildId]
      }),
      txFactory: new TxFactory(core.account.System)
    }
  } as unknown as ProcessControl
  return { card, control, findOne }
}

describe('RemoveTag', () => {
  it('removes only the selected tag and restores its fields on rollback', async () => {
    const { card, control, findOne } = setup({ [tagId]: { value: 42 }, [unrelatedId]: {} })
    const result = await RemoveTag({ _id: tagId }, execution, control)
    if (!('txes' in result) || result.rollback === undefined) throw new Error('Expected success')
    expect(result.txes).toHaveLength(1)
    expect(result.rollback).toHaveLength(1)
    const updated = TxProcessor.updateDoc2Doc(structuredClone(card), result.txes[0] as TxUpdateDoc<Card>)
    expect(updated).not.toHaveProperty(tagId)
    expect(updated).toHaveProperty(unrelatedId)
    const restored = TxProcessor.updateDoc2Doc(updated, result.rollback[0] as TxUpdateDoc<Card>)
    expect(restored).toHaveProperty(tagId, { value: 42 })
    expect(card).toHaveProperty(tagId, { value: 42 })
    expect(findOne).not.toHaveBeenCalled()
  })

  it.each([childId, grandchildId])('rejects an applied descendant %s', async (descendant) => {
    const { control } = setup({ [tagId]: {}, [descendant]: {} })
    await expect(RemoveTag({ _id: tagId }, execution, control)).rejects.toMatchObject({
      message: process.error.TagHasSubtags
    })
  })

  it('rejects a descendant even if the parent tag itself is absent', async () => {
    const { control } = setup({ [childId]: {} })
    await expect(RemoveTag({ _id: tagId }, execution, control)).rejects.toBeDefined()
  })

  it('succeeds without transactions when the tag is absent', async () => {
    const { control } = setup({ [unrelatedId]: {} })
    await expect(RemoveTag({ _id: tagId }, execution, control)).resolves.toEqual({
      txes: [],
      rollback: [],
      context: null
    })
  })

  it('loads the card when it is not cached', async () => {
    const { control, findOne } = setup({ [tagId]: {} }, false)
    await RemoveTag({ _id: tagId }, execution, control)
    expect(findOne).toHaveBeenCalledWith(cardPlugin.class.Card, { _id: execution.card })
  })

  it('reports a missing card', async () => {
    const { control, findOne } = setup({}, false)
    findOne.mockResolvedValue(undefined)
    await expect(RemoveTag({ _id: tagId }, execution, control)).rejects.toMatchObject({
      message: process.error.ObjectNotFound
    })
  })

  it.each([undefined, ''])('rejects a missing tag parameter %s', async (_id) => {
    const { control } = setup()
    await expect(RemoveTag({ _id }, execution, control)).rejects.toMatchObject({
      message: process.error.RequiredParamsNotProvided
    })
  })
})
