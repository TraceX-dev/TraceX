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
import type { Doc, Ref } from '@hcengineering/core'
import process, { createContext } from '@hcengineering/process'
import type { ContextId, Execution, Process, ProcessFunction } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'
import { ArrayLength, RelationCount } from '../transform'
import { getContextValue } from '../utils'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn(async () => ArrayLength)
}))

const contextId = 'items' as ContextId
const execution = {
  card: 'card',
  process: 'process',
  context: { [contextId]: ['first', 'second', 'first', null] }
} as unknown as Execution
const definition = {
  _id: execution.process,
  masterTag: core.class.Doc,
  bindings: { relationSlot: 'association', arraySlot: 'items' },
  context: { [contextId]: { _class: core.class.ArrOf } }
} as unknown as Process

function makeControl (): { control: ProcessControl, findAll: jest.Mock } {
  const findAll = jest.fn().mockResolvedValue([])
  const control = {
    cache: new Map([[execution.card, { _class: core.class.Doc }]]),
    client: {
      findAll,
      getModel: () => ({
        findObject: (id: Ref<Doc>) => {
          if (id === execution.process) return definition
          return { _id: id }
        }
      }),
      getHierarchy: () => ({
        isMixin: () => false,
        findAttribute: () => ({ type: { _class: core.class.ArrOf } }),
        hasMixin: () => true,
        as: () => ({ func: 'array-length' })
      })
    }
  } as unknown as ProcessControl
  return { control, findAll }
}

describe('array length in process context', () => {
  it('counts every saved element without reducing the list or removing duplicates', async () => {
    const source = createContext({
      type: 'context',
      id: contextId,
      key: '',
      functions: [{ func: process.function.ArrayLength, props: {} }]
    })
    await expect(getContextValue(source, makeControl().control, execution)).resolves.toBe(4)
    expect(execution.context[contextId]).toEqual(['first', 'second', 'first', null])
  })

  it('returns zero for an unset array attribute, including imported bindings', async () => {
    const source = createContext({
      type: 'attribute',
      key: 'arraySlot',
      functions: [{ func: process.function.ArrayLength, props: {} }]
    })
    await expect(getContextValue(source, makeControl().control, execution)).resolves.toBe(0)
  })

  it('lets another function handle an unset attribute without checking its identifier', async () => {
    const source = createContext({
      type: 'attribute',
      key: 'arraySlot',
      functions: [{ func: 'process:function:CustomArrayFunction' as Ref<ProcessFunction>, props: {} }]
    })
    await expect(getContextValue(source, makeControl().control, execution)).resolves.toBe(0)
  })

  it('preserves the missing attribute error when no function is selected', async () => {
    const source = createContext({ type: 'attribute', key: 'arraySlot' })
    await expect(getContextValue(source, makeControl().control, execution)).rejects.toThrow()
  })

  it.each([[], null, undefined])('returns zero for an empty input: %p', (value) => {
    expect(ArrayLength(value)).toBe(0)
  })
})

describe('relation count in process context', () => {
  it.each(['A', 'B'] as const)('counts links on side %s and resolves imported bindings', async (direction) => {
    const { control, findAll } = makeControl()
    findAll.mockResolvedValue([{ _id: 'first' }, { _id: 'second' }])
    await expect(RelationCount(null, { association: 'relationSlot', direction }, control, execution)).resolves.toBe(2)
    expect(findAll).toHaveBeenCalledTimes(1)
    expect(findAll).toHaveBeenCalledWith(core.class.Relation, {
      association: 'association',
      ...(direction === 'A' ? { docB: execution.card } : { docA: execution.card })
    })
  })

  it.each(['A', 'B'] as const)('returns zero for an empty relation on side %s', async (direction) => {
    await expect(
      RelationCount(null, { association: 'association', direction }, makeControl().control, execution)
    ).resolves.toBe(0)
  })

  it.each([{}, { association: 'association', direction: 'invalid' }])('rejects invalid parameters', async (props) => {
    const { control, findAll } = makeControl()
    await expect(RelationCount(null, props, control, execution)).rejects.toThrow()
    expect(findAll).not.toHaveBeenCalled()
  })
})
