// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import card from '@hcengineering/card'
import core, {
  type AnyAttribute,
  type ArrOf,
  type Class,
  type Doc,
  type Hierarchy,
  type ModelDb,
  type Ref,
  type RefTo
} from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import { exportModule } from '../exporter'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))

const ownerId = 'test:class:Owner' as Ref<Class<Doc>>
const excludedId = 'test:class:Excluded' as Ref<Class<Doc>>

it.each([false, true])('exports card classes used only in exclusions (array: %s)', async (multiple) => {
  const owner: Partial<Class<Doc>> = {
    _id: ownerId,
    _class: card.class.MasterTag,
    space: core.space.Model,
    extends: card.class.Card,
    label: core.string.Class
  }
  const excluded: Partial<Class<Doc>> = {
    _id: excludedId,
    _class: card.class.MasterTag,
    space: core.space.Model,
    extends: card.class.Card,
    label: core.string.Class
  }
  const base: Partial<Class<Doc>> = {
    _id: card.class.Card,
    _class: core.class.Class,
    space: core.space.Model,
    extends: core.class.Doc,
    label: core.string.Class
  }
  const reference: RefTo<Doc> = {
    _class: core.class.RefTo,
    label: core.string.Ref,
    to: card.class.Card,
    excludedClasses: [excludedId]
  }
  const array: ArrOf<Doc> = { _class: core.class.ArrOf, label: core.string.Array, of: reference }
  const attribute: Partial<AnyAttribute> = {
    _id: 'test:attribute:Reference' as Ref<AnyAttribute>,
    _class: core.class.Attribute,
    space: core.space.Model,
    attributeOf: ownerId,
    name: 'reference',
    type: multiple ? array : reference
  }
  const classes = new Map([
    [ownerId, owner],
    [excludedId, excluded],
    [card.class.Card, base]
  ])
  const model: Partial<ModelDb> = {
    findObject: jest.fn().mockImplementation((id: Ref<Class<Doc>>) => classes.get(id)),
    findAllSync: jest.fn().mockReturnValue([])
  }
  const hierarchy: Partial<Hierarchy> = {
    getClass: jest.fn().mockImplementation((id: Ref<Class<Doc>>) => classes.get(id)),
    getOwnAttributes: jest
      .fn()
      .mockImplementation((id: Ref<Class<Doc>>) => (id === ownerId ? new Map([['reference', attribute]]) : new Map())),
    getDescendants: jest.fn().mockImplementation((id: Ref<Class<Doc>>) => [id]),
    isDerived: jest
      .fn()
      .mockImplementation(
        (id: Ref<Class<Doc>>, parent: Ref<Class<Doc>>) => parent === card.class.Card && classes.has(id)
      )
  }
  const client: Partial<ReturnType<typeof getClient>> = {
    getModel: () => model as ModelDb,
    getHierarchy: () => hierarchy as Hierarchy
  }
  jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)

  const documents = JSON.parse(await exportModule(ownerId, 'json')) as Array<{ _id: string }>
  expect(documents.filter((document) => document._id === excludedId)).toHaveLength(1)
})
