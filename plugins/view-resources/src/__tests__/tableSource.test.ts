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
// See the License for the specific language governing permissions and
// limitations under the License.
//

import type { Class, Doc, Ref, Space } from '@hcengineering/core'
import type { FilteredView } from '@hcengineering/view'
import { attachQueryFilterSource, escapeCommentJson, getQueryFilterSource, getTableFilterSource } from '../tableSource'
import { selectedFilterStore } from '../filter'
import { activeViewlet } from '../utils'

jest.mock('svelte/store', () => ({
  writable: (value: unknown) => ({
    value,
    set (next: unknown) {
      this.value = next
    }
  }),
  get: (store: { value: unknown }) => store.value
}))
jest.mock('@hcengineering/ui', () => ({ getCurrentLocation: () => ({ path: [] }) }))
jest.mock('../filter', () => ({ selectedFilterStore: jest.requireMock('svelte/store').writable(undefined) }))
jest.mock('../utils', () => ({
  activeViewlet: jest.requireMock('svelte/store').writable({}),
  makeViewletKey: () => 'key'
}))
jest.mock('../viewOptions', () => ({
  viewOptionStore: jest.requireMock('svelte/store').writable(new Map()),
  getViewOptions: () => undefined
}))

const cardClass = 'test:class:Doc' as Ref<Class<Doc>>
const filters = '[{"key":"state"}]'
const saved = { _id: 'saved', filters, filterClass: cardClass, viewletId: null } as unknown as FilteredView

function tagged (): Record<string, any> {
  return attachQueryFilterSource(
    { space: 's' as Ref<Space>, state: 'a' },
    { cardClass, baseQuery: { space: 's' as Ref<Space> }, filters }
  )
}

describe('table filter source', () => {
  afterEach(() => {
    selectedFilterStore.set(undefined)
    activeViewlet.set({})
  })

  it('travels with the query through object spreads but not through serialization', () => {
    const query = { ...tagged() }
    expect(getQueryFilterSource(query)?.baseQuery).toEqual({ space: 's' })
    expect(JSON.parse(JSON.stringify(query))).toEqual({ space: 's', state: 'a' })
  })

  it('reports the open saved view and whether the filters on screen differ from it', () => {
    selectedFilterStore.set(saved)
    activeViewlet.set({ key: null })
    expect(getTableFilterSource(tagged(), cardClass)).toEqual({
      baseQuery: { space: 's' },
      filters,
      filteredViewId: 'saved',
      savedViewModified: false
    })
    selectedFilterStore.set({ ...saved, filters: '[]' })
    expect(getTableFilterSource(tagged(), cardClass)).toEqual({
      baseQuery: { space: 's' },
      filters,
      filteredViewId: 'saved',
      savedViewModified: true
    })
    selectedFilterStore.set({ ...saved, filterClass: 'other' } as unknown as FilteredView)
    expect(getTableFilterSource(tagged(), cardClass)).toEqual({ baseQuery: { space: 's' }, filters })
  })

  it('does not attach a source to an unrelated query or class', () => {
    expect(getTableFilterSource({ space: 's' as Ref<Space> }, cardClass)).toBeUndefined()
    expect(getTableFilterSource(tagged(), 'other' as Ref<Class<Doc>>)).toBeUndefined()
  })
})

describe('metadata comment escaping', () => {
  it('cannot be closed early by values in the metadata', () => {
    const json = escapeCommentJson(JSON.stringify({ query: { title: 'a --> <b>' } }))
    expect(json).not.toMatch(/[<>]/)
    expect(JSON.parse(json)).toEqual({ query: { title: 'a --> <b>' } })
  })
})
