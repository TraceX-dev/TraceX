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
import core, { SortingOrder } from '@hcengineering/core'
import type { Class, Doc, Ref } from '@hcengineering/core'
import process, { createContext } from '@hcengineering/process'
import type { ContextId, Execution, Process, ProcessFunction } from '@hcengineering/process'
import type { ProcessControl } from '@hcengineering/server-process'
import { FindObjects } from '../transform'
import { getContextValue } from '../utils'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn(async (id: string) => jest.requireActual('../transform')[id])
}))

const FIND_OBJECTS = 'process:function:FindObjects' as Ref<ProcessFunction>
const TARGET_CLASS = 'card:mixin:Target' as Ref<Class<Doc>>
const execution = {
  card: 'source-card',
  process: 'process',
  space: 'execution-space',
  context: { owners: ['one', 'two'] }
} as unknown as Execution

function makeControl (): {
  control: ProcessControl
  findAll: jest.Mock
  findOne: jest.Mock
  definition: Process
} {
  const sourceCard = { _id: execution.card, _class: card.class.Card, space: 'card-space', title: 'Title' }
  const definition = {
    _id: execution.process,
    masterTag: card.class.Card,
    bindings: { targetSlot: TARGET_CLASS, prioritySlot: 'priority' },
    context: {}
  } as unknown as Process
  const findAll = jest.fn().mockResolvedValue([{ _id: 'first' }, { _id: 'second' }])
  const findOne = jest.fn().mockResolvedValue(sourceCard)
  const control = {
    cache: new Map([[execution.card, sourceCard]]),
    client: {
      findAll,
      findOne,
      getModel: () => ({
        findObject: (id: Ref<Doc>) => {
          if (id === execution.process) return definition
          return { _id: id, label: id }
        }
      }),
      getHierarchy: () => ({
        findAttribute: (_class: Ref<Class<Doc>>, key: string) => ({
          attributeOf: key === 'priority' ? TARGET_CLASS : core.class.Doc
        }),
        isMixin: (id: Ref<Class<Doc>>) => id === TARGET_CLASS,
        hasMixin: () => true,
        as: (func: ProcessFunction) => ({ func: func._id === FIND_OBJECTS ? 'FindObjects' : 'FirstValue' })
      })
    }
  } as unknown as ProcessControl
  return { control, findAll, findOne, definition }
}

describe('find objects in process context', () => {
  it('searches the requested type in the card space rather than the execution space', async () => {
    const { control, findAll, findOne } = makeControl()
    await expect(FindObjects(null, { _class: TARGET_CLASS }, control, execution)).resolves.toEqual(['first', 'second'])
    expect(findAll).toHaveBeenCalledWith(TARGET_CLASS, { space: 'card-space' }, { sort: undefined })
    expect(findOne).not.toHaveBeenCalled()
  })

  it('loads the card when it is not cached', async () => {
    const { control, findAll, findOne } = makeControl()
    control.cache.clear()
    await FindObjects(null, { _class: TARGET_CLASS }, control, execution)
    expect(findOne).toHaveBeenCalledWith(card.class.Card, { _id: execution.card })
    expect(findAll.mock.calls[0][1].space).toBe('card-space')
  })

  it('does not search when the source card is missing', async () => {
    const { control, findAll, findOne } = makeControl()
    control.cache.clear()
    findOne.mockResolvedValue(undefined)
    await expect(FindObjects(null, { _class: TARGET_CLASS }, control, execution)).rejects.toThrow(
      process.error.ObjectNotFound
    )
    expect(findAll).not.toHaveBeenCalled()
  })

  it('cannot widen the search through a supplied space filter', async () => {
    const { control, findAll } = makeControl()
    await FindObjects(null, { _class: TARGET_CLASS, query: { space: { $in: ['other-space'] } } }, control, execution)
    expect(findAll.mock.calls[0][1]).toEqual({ space: 'card-space' })
  })

  it('resolves card fields and context values inside operators and arrays without changing saved props', async () => {
    const { control, findAll } = makeControl()
    const title = createContext({ type: 'attribute', key: 'title' })
    const owner = createContext({ type: 'const', key: '', value: 'one' })
    const owners = createContext({ type: 'context', id: 'owners' as ContextId, key: '' })
    const props = {
      _class: TARGET_CLASS,
      query: {
        title,
        owner: { $in: [owner, 'literal'] },
        reviewers: { $in: owners },
        missing: null,
        count: { $gte: 0 },
        active: false
      }
    }
    const saved = JSON.stringify(props)
    await FindObjects(null, props, control, execution)
    expect(findAll.mock.calls[0][1]).toEqual({
      title: 'Title',
      owner: { $in: ['one', 'literal'] },
      reviewers: { $in: ['one', 'two'] },
      missing: null,
      count: { $gte: 0 },
      active: false,
      space: 'card-space'
    })
    expect(JSON.stringify(props)).toBe(saved)
  })

  it('resolves contains filters produced by the criteria editor', async () => {
    const { control, findAll } = makeControl()
    const title = createContext({ type: 'attribute', key: 'title' })
    await FindObjects(
      null,
      {
        _class: TARGET_CLASS,
        query: { title: { $like: '%' + title + '%' }, description: { $like: '%literal%' } }
      },
      control,
      execution
    )
    expect(findAll.mock.calls[0][1]).toEqual({
      title: { $like: '%Title%' },
      description: { $like: '%literal%' },
      space: 'card-space'
    })
  })

  it('resolves type and field bindings, qualifies mixin fields, and preserves sort priority', async () => {
    const { control, findAll } = makeControl()
    await FindObjects(
      null,
      {
        _class: 'targetSlot',
        query: { prioritySlot: { $gte: 2 } },
        $sort: { prioritySlot: SortingOrder.Descending, modifiedOn: SortingOrder.Ascending }
      },
      control,
      execution
    )
    expect(findAll).toHaveBeenCalledWith(
      TARGET_CLASS,
      {
        [TARGET_CLASS + '.priority']: { $gte: 2 },
        space: 'card-space'
      },
      { sort: { [TARGET_CLASS + '.priority']: SortingOrder.Descending, modifiedOn: SortingOrder.Ascending } }
    )
  })

  it('keeps all ordered references for an array context and reduces to the first for a reference', async () => {
    const { control } = makeControl()
    const source = { type: 'function' as const, func: FIND_OBJECTS, key: 'value', props: { _class: TARGET_CLASS } }
    await expect(getContextValue(createContext(source), control, execution)).resolves.toEqual(['first', 'second'])
    await expect(
      getContextValue(
        createContext({
          ...source,
          sourceFunction: { func: process.function.FirstValue, props: {} }
        }),
        control,
        execution
      )
    ).resolves.toBe('first')
  })

  it('returns an empty array for no matches and respects the normal reference fallback', async () => {
    const { control, findAll } = makeControl()
    findAll.mockResolvedValue([])
    const source = { type: 'function' as const, func: FIND_OBJECTS, key: 'value', props: { _class: TARGET_CLASS } }
    await expect(getContextValue(createContext(source), control, execution)).resolves.toEqual([])
    const scalar = { ...source, sourceFunction: { func: process.function.FirstValue, props: {} } }
    await expect(getContextValue(createContext(scalar), control, execution)).rejects.toThrow(
      process.error.EmptyFunctionResult
    )
    await expect(
      getContextValue(createContext({ ...scalar, fallbackValue: null }), control, execution)
    ).resolves.toBeNull()
  })

  it('propagates storage failures', async () => {
    const { control, findAll } = makeControl()
    findAll.mockRejectedValue(new Error('Storage unavailable'))
    await expect(FindObjects(null, { _class: TARGET_CLASS }, control, execution)).rejects.toThrow('Storage unavailable')
  })

  it.each([{}, { _class: TARGET_CLASS, query: [] }, { _class: TARGET_CLASS, query: { $or: [] } }])(
    'rejects missing types and unsupported queries: %j',
    async (props) => {
      const { control, findAll } = makeControl()
      await expect(FindObjects(null, props, control, execution)).rejects.toThrow(
        process.error.RequiredParamsNotProvided
      )
      expect(findAll).not.toHaveBeenCalled()
    }
  )
})
