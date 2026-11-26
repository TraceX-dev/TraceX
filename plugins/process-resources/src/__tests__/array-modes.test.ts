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

import card, { type MasterTag } from '@hcengineering/card'
import core, { generateId } from '@hcengineering/core'
import type { AnyAttribute, ArrOf, Association, Client, Hierarchy, ModelDb, Type } from '@hcengineering/core'
import processPlugin, { createContext, parseContext } from '@hcengineering/process'
import type { Func, Process, ProcessFunction, SelectedRelation } from '@hcengineering/process'
import { getContext, getDefaultArrayAggregate, getRelationReduceFunc, setArraySourceMode } from '../utils'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({ showPopup: jest.fn() }))
jest.mock('@hcengineering/text-core', () => ({ isEmptyMarkup: jest.fn() }))

const lineItem = generateId<MasterTag>()
const association = generateId<Association>()
const definition: Pick<Process, 'masterTag' | 'context'> = { masterTag: card.class.Card, context: {} }
const links: Partial<Association> = {
  _id: association,
  _class: core.class.Association,
  classA: lineItem,
  classB: definition.masterTag,
  type: '1:N',
  nameA: 'Line items'
}
const parent: Partial<Association> = {
  _id: generateId<Association>(),
  _class: core.class.Association,
  classA: definition.masterTag,
  classB: lineItem,
  type: '1:N',
  nameB: 'Parent'
}
const numberType: Type<number> = { _class: core.class.TypeNumber, label: core.string.Number }
const arrayType: ArrOf<number> = { _class: core.class.ArrOf, label: core.string.Array, of: numberType }
const amount: Partial<AnyAttribute> = {
  name: 'amount',
  label: core.string.Number,
  type: numberType
}
const paid: Partial<AnyAttribute> = {
  name: 'paid',
  label: core.string.Boolean,
  type: { _class: core.class.TypeBoolean, label: core.string.Boolean }
}
const amounts: Partial<AnyAttribute> = {
  name: 'amounts',
  label: core.string.Array,
  type: arrayType
}
const sum: Func = { func: processPlugin.function.ArraySum, props: {} }
const count: Func = { func: processPlugin.function.ArrayCountTrue, props: {} }

function makeClient (): Partial<Client> {
  const functions: Array<Partial<ProcessFunction>> = [
    {
      _id: sum.func,
      type: 'convert',
      of: core.class.ArrOf,
      to: core.class.TypeNumber,
      arrayElement: core.class.TypeNumber
    },
    {
      _id: count.func,
      type: 'convert',
      of: core.class.ArrOf,
      to: core.class.TypeNumber,
      arrayElement: core.class.TypeBoolean
    }
  ]
  const model: Partial<ModelDb> = {
    findAllSync: jest.fn().mockImplementation((clazz, query) => {
      if (clazz === core.class.Association) return [links, parent]
      return functions.filter((func) =>
        Object.entries(query).every(([key, value]) => func[key as keyof ProcessFunction] === value)
      )
    }),
    findObject: jest.fn().mockImplementation((id) => [links, parent].find((entry) => entry._id === id))
  }
  const hierarchy: Partial<Hierarchy> = {
    getAllAttributes: jest.fn().mockImplementation((clazz) =>
      clazz === lineItem
        ? new Map([
            ['amount', amount],
            ['paid', paid]
          ])
        : new Map([['amounts', amounts]])
    ),
    getAncestors: jest.fn().mockReturnValue([definition.masterTag]),
    isDerived: jest.fn().mockImplementation((actual, expected) => actual === expected)
  }
  return { getModel: () => model as ModelDb, getHierarchy: () => hierarchy as Hierarchy }
}

describe('projected array modes in the value editor', () => {
  it('lists to-many fields at the relationship level and standalone arrays under the aggregate', () => {
    const client = makeClient()
    const context = getContext(
      client as Client,
      definition as Process,
      core.class.TypeNumber,
      'attribute',
      undefined,
      true
    )
    expect(context.relations['Line items'].attributes).toEqual([amount, paid])
    expect(context.relations.Parent.attributes).toEqual([amount])
    const conversion = context.convertible?.find((entry) => entry.func === sum.func)
    expect(conversion?.context.attributes).toEqual([amounts])
    expect(conversion?.context.relations).toEqual({})
    expect(getDefaultArrayAggregate(client as Client, paid as AnyAttribute, amount as AnyAttribute)).toEqual(count)
  })

  it('switches between a source reduction and a value aggregation and retains later transforms', () => {
    const client = makeClient()
    const first = getRelationReduceFunc(client as Client, association, 'A')
    expect(first?.func).toBe(processPlugin.function.FirstValue)
    expect(getRelationReduceFunc(client as Client, association, 'B')).toBeUndefined()
    const round: Func = { func: processPlugin.function.Round, props: {} }
    const last: Func = { func: processPlugin.function.LastValue, props: {} }
    const value: SelectedRelation = {
      type: 'relation',
      key: 'amount',
      association,
      direction: 'A',
      name: 'Line items',
      sourceFunction: first,
      functions: [round]
    }
    const aggregated = setArraySourceMode(value, sum, [sum.func])
    expect(parseContext(createContext(aggregated))).toMatchObject({ functions: [sum, round] })
    expect(aggregated.sourceFunction).toBeUndefined()
    expect(setArraySourceMode(aggregated, last, [sum.func])).toEqual({
      ...value,
      sourceFunction: last
    })
  })
})
