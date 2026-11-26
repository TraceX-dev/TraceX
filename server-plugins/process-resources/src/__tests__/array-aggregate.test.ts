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

import core from '@hcengineering/core'
import type { Association, Class, Doc, Hierarchy, ModelDb, Ref } from '@hcengineering/core'
import process, { createContext } from '@hcengineering/process'
import type { Execution, Process, ProcessFunction, SelectedContext } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'
import * as aggregates from '../aggregate'
import { getContextValue } from '../utils'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn(async (name: keyof typeof aggregates) => aggregates[name])
}))

const execution: Pick<Execution, 'card' | 'process'> = {
  card: 'source-card' as Execution['card'],
  process: 'process-definition' as Ref<Process>
}
const targetClass = 'card:mixin:LineItem' as Ref<Class<Doc>>
const associationSlot = '__SLOT_items__' as Ref<Association>
const amountSlot = '__SLOT_amount__'
const definition: Partial<Process> = {
  masterTag: core.class.Doc,
  bindings: { [associationSlot]: 'association', [amountSlot]: 'amount' }
}
const linkedDocs = [{ [targetClass]: { amount: 3 } }, { [targetClass]: { amount: 7 } }, {}]

function makeControl (
  associationType: Association['type'],
  cardFields: Record<string, unknown> = {}
): { control: Partial<ProcessControl>, findAll: jest.Mock } {
  const association: Partial<Association> = {
    _id: 'association' as Ref<Association>,
    type: associationType,
    classA: targetClass,
    classB: targetClass
  }
  const findAll = jest.fn().mockResolvedValue(linkedDocs)
  const model: Partial<ModelDb> = {
    findObject: jest.fn().mockImplementation((id: string) => {
      if (id === execution.process) return definition
      if (id === association._id) return association
      const func: Partial<ProcessFunction> = { _id: id as Ref<ProcessFunction>, arrayElement: core.class.TypeNumber }
      return func
    })
  }
  const hierarchy: Partial<Hierarchy> = {
    findAttribute: jest.fn().mockImplementation((clazz: Ref<Class<Doc>>, key: string) => {
      if (clazz === targetClass && key === 'amount') return { attributeOf: targetClass }
      if (key === 'items') {
        return { type: { _class: core.class.ArrOf, of: { _class: core.class.RefTo, to: targetClass } } }
      }
      return undefined
    }),
    isMixin: (clazz: Ref<Class<Doc>>) => clazz === targetClass,
    hasMixin: () => true,
    as: jest.fn().mockImplementation((func: ProcessFunction) => ({ func: func._id.split(':').at(-1) }))
  }
  const client: Partial<ProcessControl['client']> = {
    findAll,
    getModel: () => model as ModelDb,
    getHierarchy: () => hierarchy as Hierarchy
  }
  const control: Partial<ProcessControl> = {
    client: client as ProcessControl['client'],
    cache: new Map([[execution.card, { _class: core.class.Doc, ...cardFields }]])
  }
  return { control, findAll }
}

const relationSource: SelectedContext = {
  type: 'relation',
  key: amountSlot,
  association: associationSlot,
  direction: 'A',
  name: 'Line items',
  functions: [{ func: process.function.ArraySum, props: {} }]
}

describe('array aggregate values', () => {
  it('calculates number aggregates without converting strings or losing zero', () => {
    const values = [-3, undefined, 6, 0, '10', NaN, Infinity]
    expect(aggregates.ArraySum(values)).toBe(3)
    expect(aggregates.ArrayProduct([2, 3, null, 4])).toBe(24)
    expect(aggregates.ArrayProduct(values)).toBe(0)
    expect(aggregates.ArrayMin(values)).toBe(-3)
    expect(aggregates.ArrayMax(values)).toBe(6)
    expect(aggregates.ArrayAverage(values)).toBe(1)
  })

  it('returns timestamps for date extrema and uses literal booleans', () => {
    const dates = [new Date(10), 0, null, new Date(NaN)]
    expect(aggregates.ArrayEarliest(dates)).toBe(0)
    expect(aggregates.ArrayLatest(dates)).toBe(10)
    const values = [true, false, null, 'false', true]
    expect(aggregates.ArrayAllTrue(values)).toBe(false)
    expect(aggregates.ArrayAnyTrue(values)).toBe(true)
    expect(aggregates.ArrayAnyTrue([false, 1, 'true'])).toBe(false)
    expect(aggregates.ArrayCountTrue(values)).toBe(2)
  })

  it('handles empty inputs and non-finite numeric results', () => {
    expect(aggregates.ArraySum([])).toBe(0)
    expect(aggregates.ArrayProduct([])).toBe(1)
    expect(aggregates.ArrayMin([])).toBeNull()
    expect(aggregates.ArrayMax([])).toBeNull()
    expect(aggregates.ArrayAverage([])).toBeNull()
    expect(aggregates.ArrayEarliest([])).toBeNull()
    expect(aggregates.ArrayLatest([])).toBeNull()
    expect(aggregates.ArrayAllTrue([])).toBe(true)
    expect(aggregates.ArrayAnyTrue([])).toBe(false)
    expect(aggregates.ArrayCountTrue([])).toBe(0)
    const large = [Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE]
    expect(aggregates.ArraySum(large)).toBeNull()
    expect(aggregates.ArrayProduct(large)).toBeNull()
    expect(aggregates.ArrayAverage(large)).toBe(Number.MAX_VALUE)
  })
})

describe('aggregating projected fields', () => {
  it.each([
    ['1:N', 'A', 'docB'],
    ['N:N', 'A', 'docB'],
    ['N:N', 'B', 'docA']
  ] as const)('aggregates the linked cards of a %s association on side %s', async (type, direction, cardKey) => {
    const { control, findAll } = makeControl(type)
    findAll.mockResolvedValueOnce(
      ['first', 'second'].map((id) =>
        direction === 'A' ? { docA: id, docB: execution.card } : { docA: execution.card, docB: id }
      )
    )
    const source = createContext({ ...relationSource, direction })
    await expect(getContextValue(source, control as ProcessControl, execution as Execution)).resolves.toBe(10)
    expect(findAll).toHaveBeenNthCalledWith(1, core.class.Relation, {
      association: 'association',
      [cardKey]: execution.card
    })
    expect(findAll).toHaveBeenNthCalledWith(2, targetClass, { _id: { $in: ['first', 'second'] } })
  })

  it('passes an empty to-many association through the aggregate', async () => {
    const { control, findAll } = makeControl('N:N')
    findAll.mockResolvedValueOnce([])
    await expect(
      getContextValue(createContext(relationSource), control as ProcessControl, execution as Execution)
    ).resolves.toBe(0)
    expect(findAll).toHaveBeenCalledTimes(1)
  })

  it.each([
    [undefined, 0],
    [[], 0],
    [['first', 'second'], 10]
  ])('aggregates fields through the references %p', async (items, expected) => {
    const { control, findAll } = makeControl('N:N', { items })
    const source = createContext({
      type: 'nested',
      path: 'items',
      key: amountSlot,
      functions: relationSource.functions
    })
    await expect(getContextValue(source, control as ProcessControl, execution as Execution)).resolves.toBe(expected)
    expect(findAll).toHaveBeenCalledTimes(expected === 0 ? 0 : 1)
  })
})
