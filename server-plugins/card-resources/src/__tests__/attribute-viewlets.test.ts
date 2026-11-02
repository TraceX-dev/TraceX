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

import card from '@hcengineering/card'
import core, {
  TxFactory,
  TxProcessor,
  toFindResult,
  type AnyAttribute,
  type Class,
  type Data,
  type Doc,
  type DocumentQuery,
  type Hierarchy,
  type ModelDb,
  type Ref,
  type Tx,
  type TxCreateDoc,
  type TxUpdateDoc
} from '@hcengineering/core'
import type { TriggerControl } from '@hcengineering/server-core'
import view, {
  type BuildModelKey,
  type Viewlet,
  type ViewletDescriptor,
  type ViewletPreference
} from '@hcengineering/view'
import resources from '../index'

const CARD_TYPE = 'test:class:Card' as Ref<Class<Doc>>
const OTHER_TYPE = 'test:class:Other' as Ref<Class<Doc>>
const factory = new TxFactory(core.account.System)

function attribute (name: string, owner = CARD_TYPE): TxCreateDoc<AnyAttribute> {
  const data: Data<AnyAttribute> = {
    name,
    attributeOf: owner,
    label: core.string.Name,
    type: { _class: core.class.TypeString }
  }
  return factory.createTxCreateDoc(core.class.Attribute, core.space.Model, data)
}

function createViewlet (
  config: Viewlet['config'],
  descriptor: Ref<ViewletDescriptor> = view.viewlet.Table,
  owner = CARD_TYPE
): TxCreateDoc<Viewlet> {
  const data: Data<Viewlet> = { attachTo: owner, descriptor, config }
  return factory.createTxCreateDoc(view.class.Viewlet, core.space.Model, data)
}

function preference (viewlet: Viewlet, config: Viewlet['config']): ViewletPreference {
  const data: Data<ViewletPreference> = { attachedTo: viewlet._id, config }
  return TxProcessor.createDoc2Doc(factory.createTxCreateDoc(view.class.ViewletPreference, core.space.Workspace, data))
}

function control (viewlets: Viewlet[], preferences: ViewletPreference[] = [], txes: Tx[] = []): TriggerControl {
  const hierarchy: Partial<Hierarchy> = {
    isDerived: (clazz, parent) => parent === card.class.Card && clazz !== OTHER_TYPE,
    getDescendants: (clazz) => [clazz]
  }
  const model: Partial<ModelDb> = {
    findAllSync: jest
      .fn()
      .mockImplementation((_class: Ref<Class<Doc>>, query: DocumentQuery<Viewlet>) =>
        viewlets.filter((item) => item.attachTo === query.attachTo && item.variant === undefined)
      )
  }
  const result: Partial<TriggerControl> = {
    hierarchy: hierarchy as Hierarchy,
    modelDb: model as ModelDb,
    txFactory: new TxFactory(core.account.System, true),
    txes,
    findAll: jest
      .fn()
      .mockImplementation(async (_ctx: unknown, _class: Ref<Class<Doc>>, query: DocumentQuery<ViewletPreference>) =>
        toFindResult(preferences.filter((item) => item.attachedTo === query.attachedTo))
      )
  }
  return result as TriggerControl
}

async function run (
  txes: TxCreateDoc<AnyAttribute>[],
  triggerControl: TriggerControl
): Promise<TxUpdateDoc<Viewlet | ViewletPreference>[]> {
  const plugin = await resources()
  const result = await plugin.trigger.OnAttribute(txes, triggerControl)
  return result as TxUpdateDoc<Viewlet | ViewletPreference>[]
}

describe('card attribute viewlet configuration', () => {
  it('preserves an imported view configuration, including omitted fields', async () => {
    const imported = createViewlet(['second', 'title'])
    const target = TxProcessor.createDoc2Doc(imported)
    const attrs = [attribute('first'), attribute('second')]
    expect(await run(attrs, control([target], [], [imported, ...attrs]))).toEqual([])
    expect(target.config).toEqual(['second', 'title'])
  })

  it('preserves an explicit configuration update in the same import batch', async () => {
    const target = TxProcessor.createDoc2Doc(createViewlet(['second', 'title']))
    const update = factory.createTxUpdateDoc(view.class.Viewlet, core.space.Model, target._id, {
      config: target.config
    })
    const attrs = [attribute('first'), attribute('second')]
    expect(await run(attrs, control([target], [], [...attrs, update]))).toEqual([])
  })

  it('adds every missing batch field once and emits one update per view or preference', async () => {
    const target = TxProcessor.createDoc2Doc(createViewlet(['title']))
    const pref = preference(target, ['modifiedOn', 'title'])
    const first = attribute('first')
    const result = await run([first, attribute('second'), first], control([target], [pref]))
    expect(result).toHaveLength(2)
    expect(result.find((tx) => tx.objectId === target._id)?.operations.config).toEqual(['title', 'first', 'second'])
    expect(result.find((tx) => tx.objectId === pref._id)?.operations.config).toEqual([
      'modifiedOn',
      'title',
      'first',
      'second'
    ])
    expect(target.config).toEqual(['title'])
    expect(pref.config).toEqual(['modifiedOn', 'title'])
  })

  it('keeps existing string and object entries and their order without duplicates', async () => {
    const field: BuildModelKey = { key: 'first', displayProps: { fixed: 'left' } }
    const target = TxProcessor.createDoc2Doc(createViewlet(['second', field, 'title']))
    const pref = preference(target, ['first', 'title', 'second'])
    expect(await run([attribute('first'), attribute('second')], control([target], [pref]))).toEqual([])
    expect(target.config[1]).toEqual(field)
  })

  it('updates a preference independently when the view already contains the field', async () => {
    const target = TxProcessor.createDoc2Doc(createViewlet(['first', 'title']))
    const pref = preference(target, ['title'])
    const result = await run([attribute('first')], control([target], [pref]))
    expect(result).toHaveLength(1)
    expect(result[0].objectId).toBe(pref._id)
    expect(result[0].operations.config).toEqual(['title', 'first'])
  })

  it('inserts a batch after the growing list column in transaction order', async () => {
    const title: BuildModelKey = { key: 'title', displayProps: { grow: true } }
    const target = TxProcessor.createDoc2Doc(createViewlet([title, 'modifiedOn'], view.viewlet.List))
    const pref = preference(target, [title, 'space'])
    const result = await run([attribute('first'), attribute('second')], control([target], [pref]))
    expect(result.find((tx) => tx.objectId === target._id)?.operations.config).toEqual([
      title,
      'first',
      'second',
      'modifiedOn'
    ])
    expect(result.find((tx) => tx.objectId === pref._id)?.operations.config).toEqual([
      title,
      'first',
      'second',
      'space'
    ])
  })

  it('populates automatically created viewlets and skips unrelated types and relationship tables', async () => {
    const autoCreated = createViewlet(['title'])
    autoCreated.space = core.space.DerivedTx
    const target = TxProcessor.createDoc2Doc(autoCreated)
    const relationship = TxProcessor.createDoc2Doc(createViewlet(['title'], view.viewlet.RelationshipTable))
    const other = TxProcessor.createDoc2Doc(createViewlet(['title'], view.viewlet.Table, OTHER_TYPE))
    const result = await run(
      [attribute('ignored', OTHER_TYPE), attribute('first')],
      control([target, relationship, other], [], [autoCreated])
    )
    expect(result).toHaveLength(1)
    expect(result[0].objectId).toBe(target._id)
    expect(result[0].operations.config).toEqual(['title', 'first'])
  })
})
