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

import core, {
  type AnyAttribute,
  type Class,
  type Doc,
  type Hierarchy,
  type Ref,
  type RefTo,
  type DocumentQuery
} from '@hcengineering/core'
import card from '@hcengineering/card'
import contact from '@hcengineering/contact'
import { onDestroy } from 'svelte'
import { createQuery, getClient } from '@hcengineering/presentation'
import { filtersToQuery } from '../filter'
import view from '../plugin'
import {
  createReferenceQuery,
  supportsReferenceFilters,
  parseReferenceFilters,
  referenceFilterQuery,
  serializeReferenceFilters
} from '../reference-filters'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn(), createQuery: jest.fn() }))
jest.mock('svelte', () => ({ onDestroy: jest.fn() }))
jest.mock('svelte/store', () => ({
  writable: <T>(initial: T) => {
    let value = initial
    const subscribers = new Set<(value: T) => void>()
    return {
      set: (next: T): void => {
        value = next
        subscribers.forEach((callback) => {
          callback(value)
        })
      },
      subscribe: (callback: (value: T) => void): (() => void) => {
        subscribers.add(callback)
        callback(value)
        return () => {
          subscribers.delete(callback)
        }
      }
    }
  }
}))

jest.mock('../filter', () => ({ filtersToQuery: jest.fn() }))

const person = 'test:class:Person' as Ref<Class<Doc>>
const employee = 'test:mixin:Employee' as Ref<Class<Doc>>
const worker = 'test:mixin:Worker' as Ref<Class<Doc>>
const childCard = 'test:class:ChildCard' as Ref<Class<Doc>>
const missing = 'test:class:Missing' as Ref<Class<Doc>>
const findMode = jest.fn()
const liveQuery = jest.fn()
const unsubscribe = jest.fn()

interface StoredCondition {
  key: { _class: string, key: string, component: string }
  mode: string
  modes: string[]
  value: unknown[]
  index: number
}

function condition (overrides: Partial<StoredCondition> = {}): StoredCondition {
  return {
    key: { _class: employee, key: 'role', component: view.component.ValueFilter },
    mode: view.filter.FilterValueIn,
    modes: [view.filter.FilterValueIn, view.filter.FilterValueNin],
    value: [['GUEST', ['GUEST']]],
    index: 42,
    ...overrides
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  const attribute: Partial<AnyAttribute> = { name: 'role', attributeOf: employee, label: core.string.Name }
  const hierarchy: Partial<Hierarchy> = {
    hasClass: (id) => id !== missing,
    getBaseClass: (id) => ([employee, worker].includes(id) ? person : id),
    getDescendants: (id) => (id === employee ? [employee, worker] : [id]),
    isMixin: (id) => [employee, worker].includes(id),
    hasMixin: (doc, id) => id in doc,
    isDerived: (id, parent) =>
      id === parent ||
      (id === person && parent === contact.class.Person) ||
      (id === childCard && parent === card.class.Card),
    getAttribute: jest.fn().mockImplementation((_id: Ref<Class<Doc>>, key: string) => {
      if (key === 'deleted') throw new Error('Missing field')
      return attribute as AnyAttribute
    })
  }
  const client: Partial<ReturnType<typeof getClient>> = {
    getHierarchy: () => hierarchy as Hierarchy,
    findOne: findMode.mockResolvedValue({ result: 'test:function:Mode' })
  }
  const query: Partial<ReturnType<typeof createQuery>> = { query: liveQuery, unsubscribe }
  jest.mocked(createQuery).mockReturnValue(query as ReturnType<typeof createQuery>)
  jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)
  jest.mocked(filtersToQuery).mockResolvedValue({ [employee + '.role']: { $in: ['GUEST'] } })
})

it('hydrates mixin field definitions and compiles them through the standard strict converter', async () => {
  const source = JSON.stringify([condition()])
  const filters = parseReferenceFilters(person, source)
  expect(filters[0].key.attribute.attributeOf).toBe(employee)
  expect(filters[0].index).toBe(0)
  await expect(referenceFilterQuery(person, source)).resolves.toEqual({ [employee + '.role']: { $in: ['GUEST'] } })
  expect(filtersToQuery).toHaveBeenCalledWith(filters, {}, true)
})

it('does not persist attribute snapshots or runtime callbacks', () => {
  const filters = parseReferenceFilters(person, JSON.stringify([condition()]))
  filters[0].onRemove = jest.fn()
  const serialized = serializeReferenceFilters(filters)
  expect(serialized).not.toContain('attribute')
  expect(serialized).not.toContain('onRemove')
  expect(JSON.parse(serialized ?? '[]')[0].value).toEqual([['GUEST', ['GUEST']]])
  expect(serializeReferenceFilters([])).toBeUndefined()
})

it.each(['null', '{}', '[null]', '{'])('rejects malformed imported filters: %s', (source) => {
  expect(() => parseReferenceFilters(person, source)).toThrow()
})

it('rejects a deleted field without altering its stored definition', () => {
  const filter = condition({ key: { _class: person, key: 'deleted', component: view.component.ValueFilter } })
  const source = JSON.stringify([filter])
  expect(() => parseReferenceFilters(person, source)).toThrow('Missing field')
  expect(JSON.stringify([filter])).toBe(source)
})

it('keeps unavailable exclusion ids invalid until explicitly removed', () => {
  const filter = condition({
    key: { _class: person, key: '_class', component: view.component.ClassFilter },
    mode: view.filter.FilterObjectNin,
    value: [missing]
  })
  expect(() => parseReferenceFilters(person, JSON.stringify([filter]))).toThrow('Invalid class condition')
  expect(filter.value).toEqual([missing])
})

it('rejects filters from an unrelated target class', () => {
  expect(() => parseReferenceFilters(core.class.Space, JSON.stringify([condition()]))).toThrow(
    'Unsupported reference filter target'
  )
})

it('rejects nested, duplicate and malformed value conditions', () => {
  expect(() => parseReferenceFilters(person, JSON.stringify([{ ...condition(), nested: condition() }]))).toThrow()
  expect(() => parseReferenceFilters(person, JSON.stringify([condition(), condition()]))).toThrow(
    'one condition per field'
  )
  expect(() => parseReferenceFilters(person, JSON.stringify([condition({ value: ['GUEST'] })]))).toThrow(
    'selected filter values'
  )
})

it('rejects incomplete conditions and missing modes instead of widening the query', async () => {
  await expect(referenceFilterQuery(person, JSON.stringify([condition({ value: [] })]))).rejects.toThrow('Incomplete')
  findMode.mockResolvedValue(undefined)
  await expect(referenceFilterQuery(person, JSON.stringify([condition()]))).rejects.toThrow('unavailable')
  expect(filtersToQuery).not.toHaveBeenCalled()
})

it('supports only Person and Card families, including employee mixins', () => {
  const hierarchy = getClient().getHierarchy()
  expect(supportsReferenceFilters(hierarchy, person)).toBe(true)
  expect(supportsReferenceFilters(hierarchy, employee)).toBe(true)
  expect(supportsReferenceFilters(hierarchy, card.class.Card)).toBe(true)
  expect(supportsReferenceFilters(hierarchy, childCard)).toBe(true)
  expect(supportsReferenceFilters(hierarchy, core.class.Space)).toBe(false)
  expect(supportsReferenceFilters(hierarchy, missing)).toBe(false)
})

function reference (to: Ref<Class<Doc>> = person): RefTo<Doc> {
  const type: RefTo<Doc> = {
    _class: core.class.RefTo,
    label: core.string.Ref,
    to,
    filters: JSON.stringify([condition()])
  }
  return type
}

it('leaves selectors without filters and unsupported targets unchanged', () => {
  const store = createReferenceQuery<Doc>()
  let current: DocumentQuery<Doc> = {}
  store.subscribe((value) => {
    current = value
  })
  const base: DocumentQuery<Doc> = { space: core.space.Model }
  store.update(undefined, base)
  expect(current).toBe(base)
  store.update(reference(core.class.Space), base)
  expect(current).toBe(base)
  expect(liveQuery).not.toHaveBeenCalled()
  expect(filtersToQuery).not.toHaveBeenCalled()
})

it('merges ordinary role filters without loading a separate list of candidate ids', async () => {
  const store = createReferenceQuery<Doc>()
  let current: DocumentQuery<Doc> = {}
  store.subscribe((value) => {
    current = value
  })
  const base: DocumentQuery<Doc> = { space: core.space.Model }
  store.update(reference(), base)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(current).toEqual({ ...base, [employee + '.role']: { $in: ['GUEST'] } })
  expect(liveQuery).not.toHaveBeenCalled()
})

it('keeps candidate IDs live while preserving access and search constraints', async () => {
  jest.mocked(filtersToQuery).mockResolvedValue({ name: { $like: '%Smith%' } })
  const store = createReferenceQuery<Doc>()
  let current: DocumentQuery<Doc> = {}
  store.subscribe((value) => {
    current = value
  })
  const blocked = 'blocked' as Ref<Doc>
  const base: DocumentQuery<Doc> = { name: { $like: '%Alice%' }, space: core.space.Model, _id: { $nin: [blocked] } }
  const type = reference()
  store.update(type, base)
  expect(current._id).toEqual({ $in: [] })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(liveQuery).toHaveBeenCalledWith(type.to, { name: { $like: '%Smith%' } }, expect.any(Function), {
    projection: { _id: 1 }
  })
  const onResult = liveQuery.mock.calls[0][2] as (docs: Array<{ _id: string }>) => void
  onResult([{ _id: 'allowed' }, { _id: 'blocked' }])
  expect(current).toEqual({ ...base, _id: { $in: ['allowed'] } })
  onResult([])
  expect(current._id).toEqual({ $in: [] })
  store.update(undefined, base)
  onResult([{ _id: 'stale' }])
  expect(current).toBe(base)
})

it('isolates a text condition from the picker search field', async () => {
  jest.mocked(filtersToQuery).mockResolvedValue({ name: { $like: '%Smith%' } })
  const store = createReferenceQuery<Doc>()
  let current: DocumentQuery<Doc> = {}
  store.subscribe((value) => {
    current = value
  })
  store.update(reference(), { name: { $like: '%Alice%' } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const onResult = liveQuery.mock.calls[0][2] as (docs: Array<{ _id: string }>) => void
  expect(liveQuery.mock.calls[0][1]).toEqual({ name: { $like: '%Smith%' } })
  onResult([{ _id: 'allowed' }])
  expect(current).toEqual({ name: { $like: '%Alice%' }, _id: { $in: ['allowed'] } })
})

it('blocks selection on invalid conditions and ignores pending work after destruction', async () => {
  const store = createReferenceQuery<Doc>()
  let current: DocumentQuery<Doc> = {}
  store.subscribe((value) => {
    current = value
  })
  findMode.mockResolvedValue(undefined)
  store.update(reference(), { space: core.space.Model })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(current).toEqual({ space: core.space.Model, _id: { $in: [] } })
  expect(liveQuery).not.toHaveBeenCalled()
  findMode.mockResolvedValue({ result: 'test:function:Mode' })
  store.update(reference())
  jest.mocked(onDestroy).mock.calls[0][0]()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(liveQuery).not.toHaveBeenCalled()
})

it.each([view.filter.FilterObjectIn, view.filter.FilterObjectNin])(
  'supports both class modes and restores available mode choices: %s',
  (mode) => {
    const filter = condition({
      key: { _class: person, key: '_class', component: view.component.ClassFilter },
      mode,
      modes: [view.filter.FilterObjectNin],
      value: [employee]
    })
    const [restored] = parseReferenceFilters(person, JSON.stringify([filter]))
    expect(restored.mode).toBe(mode)
    expect(restored.modes).toEqual([view.filter.FilterObjectIn, view.filter.FilterObjectNin])
  }
)

it('keeps positive unions of a mixin and its descendants live', async () => {
  jest.mocked(filtersToQuery).mockResolvedValue({})
  const filter = condition({
    key: { _class: person, key: '_class', component: view.component.ClassFilter },
    mode: view.filter.FilterObjectIn,
    value: [employee]
  })
  const type: RefTo<Doc> = { ...reference(), filters: JSON.stringify([filter]) }
  const store = createReferenceQuery<Doc>()
  let current: DocumentQuery<Doc> = {}
  store.subscribe((value) => {
    current = value
  })
  store.update(type)
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(liveQuery).toHaveBeenCalledWith(person, {}, expect.any(Function), {
    projection: { _id: 1, _class: 1, [employee]: 1, [worker]: 1 }
  })
  const onResult = liveQuery.mock.calls[0][2] as (docs: Array<Partial<Doc>>) => void
  const employeeDoc: Partial<Doc> = { _id: 'employee' as Ref<Doc>, _class: person, [employee]: {} }
  const workerDoc: Partial<Doc> = { _id: 'worker' as Ref<Doc>, _class: person, [worker]: {} }
  const personDoc: Partial<Doc> = { _id: 'person' as Ref<Doc>, _class: person }
  onResult([employeeDoc, workerDoc, personDoc])
  expect(current._id).toEqual({ $in: ['employee', 'worker'] })
  onResult([personDoc])
  expect(current._id).toEqual({ $in: [] })
})
