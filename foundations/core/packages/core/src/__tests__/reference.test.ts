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

import type { ArrOf, Class, Data, Doc, Ref, RefTo } from '../classes'
import { ClassifierKind } from '../classes'
import core from '../component'
import { Hierarchy } from '../hierarchy'
import { getClassExclusionQuery, updateReferenceFilters } from '../reference'
import type { DocumentQuery } from '../storage'
import { TxFactory } from '../tx'
import { genMinModel, test } from './minmodel'

const childMixin = 'test:mixin:Child' as Ref<Class<Doc>>
const childClass = 'test:class:Child' as Ref<Class<Doc>>
const childClassMixin = 'test:mixin:ChildClassMixin' as Ref<Class<Doc>>

function prepare (): Hierarchy {
  const hierarchy = new Hierarchy()
  for (const tx of genMinModel()) hierarchy.tx(tx)
  const factory = new TxFactory(core.account.System)
  const mixin: Data<Class<Doc>> = {
    label: core.string.Class,
    extends: test.mixin.TestMixin,
    kind: ClassifierKind.MIXIN
  }
  const clazz: Data<Class<Doc>> = {
    label: core.string.Class,
    extends: test.class.Task,
    kind: ClassifierKind.CLASS
  }
  hierarchy.tx(factory.createTxCreateDoc(core.class.Class, core.space.Model, mixin, childMixin))
  hierarchy.tx(factory.createTxCreateDoc(core.class.Class, core.space.Model, clazz, childClass))
  const nestedMixin: Data<Class<Doc>> = {
    label: core.string.Class,
    extends: childClass,
    kind: ClassifierKind.MIXIN
  }
  hierarchy.tx(factory.createTxCreateDoc(core.class.Class, core.space.Model, nestedMixin, childClassMixin))
  return hierarchy
}

function reference (...classes: Ref<Class<Doc>>[]): Ref<Class<Doc>>[] {
  return classes
}

describe('reference candidate exclusions', () => {
  it('preserves unrestricted references and existing query constraints', () => {
    const query: DocumentQuery<Doc> = { space: core.space.Model, active: true }
    expect(getClassExclusionQuery(prepare(), [], query)).toEqual(query)
    expect(getClassExclusionQuery(prepare(), reference(), query)).toEqual(query)
  })

  it('excludes a mixin and its descendants without requiring employee activity', () => {
    const query = getClassExclusionQuery(prepare(), reference(test.mixin.TestMixin))
    expect(query).toEqual({
      [test.mixin.TestMixin]: { $exists: false },
      [childMixin]: { $exists: false }
    })
  })

  it('excludes classes and their descendants while retaining existing class and access restrictions', () => {
    const query: DocumentQuery<Doc> = {
      _class: { $in: [test.class.Task, childClass, core.class.Space] },
      space: core.space.Model,
      _id: { $nin: [core.space.Model] }
    }
    const before = JSON.stringify(query)
    const result = getClassExclusionQuery(prepare(), reference(test.class.Task), query)
    expect(result._class).toEqual({ $in: [core.class.Space] })
    expect(result.space).toBe(core.space.Model)
    expect(result._id).toEqual(query._id)
    expect(result[test.mixin.TaskMixinTodos]).toBeUndefined()
    expect(result[childClassMixin]).toBeUndefined()
    expect(Object.keys(result).sort()).toEqual(['_class', '_id', 'space'])
    expect(JSON.stringify(query)).toBe(before)
  })

  it('combines multiple exclusions and deduplicates descendants', () => {
    const result = getClassExclusionQuery(prepare(), reference(test.mixin.TestMixin, childMixin, core.class.Space))
    expect(result[test.mixin.TestMixin]).toEqual({ $exists: false })
    expect(result[childMixin]).toEqual({ $exists: false })
    expect(result._class).toEqual({ $nin: [core.class.Space] })
  })

  it('keeps independent mixin exclusions while omitting mixins covered by a class exclusion', () => {
    const result = getClassExclusionQuery(prepare(), reference(test.class.Task, test.mixin.TestMixin))
    expect(result[test.mixin.TestMixin]).toEqual({ $exists: false })
    expect(result[childMixin]).toEqual({ $exists: false })
    expect(result[test.mixin.TaskMixinTodos]).toBeUndefined()
    expect(result[childClassMixin]).toBeUndefined()
    expect(result._class).toEqual({ $nin: [test.class.Task, childClass] })
  })

  it('keeps a mixin condition when its base class is not excluded', () => {
    expect(getClassExclusionQuery(prepare(), reference(childClassMixin))).toEqual({
      [childClassMixin]: { $exists: false }
    })
  })

  it('returns no candidates when an existing filter requires an excluded mixin', () => {
    const query: DocumentQuery<Doc> = { [test.mixin.TestMixin]: { $exists: true }, active: true }
    const result = getClassExclusionQuery(prepare(), reference(test.mixin.TestMixin), query)
    expect(result._id).toEqual({ $in: [] })
    expect(result.active).toBe(true)
  })

  it('preserves matching mixin absence constraints', () => {
    const query: DocumentQuery<Doc> = { [test.mixin.TestMixin]: { $exists: false } }
    expect(getClassExclusionQuery(prepare(), reference(test.mixin.TestMixin), query)[test.mixin.TestMixin]).toEqual({
      $exists: false
    })
  })

  it('does not broaden selection when an excluded class is unavailable', () => {
    const missing = 'test:class:Missing' as Ref<Class<Doc>>
    expect(getClassExclusionQuery(prepare(), reference(missing))._id).toEqual({ $in: [] })
  })
})

describe('updating existing reference filters', () => {
  const first = '[{"key":{"_class":"test:class:Task","key":"name"},"value":["first"]}]'
  const second = '[{"key":{"_class":"test:class:Task","key":"name"},"value":["second"]}]'
  function type (filters?: string): RefTo<Doc> {
    const reference: RefTo<Doc> = { _class: core.class.RefTo, label: core.string.Ref, to: core.class.Doc, filters }
    return reference
  }
  it('preserves unchanged filters and their enclosing array type', () => {
    const original = type(first)
    expect(updateReferenceFilters(original, type(first))).toBe(original)
    const array: ArrOf<Doc> = { _class: core.class.ArrOf, label: core.string.Array, of: original }
    expect(updateReferenceFilters(array, array)).toBe(array)
  })
  it('updates and clears conditions without changing other type properties', () => {
    const original = type(first)
    expect(updateReferenceFilters(original, type(second))).toEqual(type(second))
    expect(original.filters).toBe(first)
    const cleared = updateReferenceFilters(original, type())
    expect(cleared).not.toHaveProperty('filters')
    expect(cleared).toMatchObject({ _class: core.class.RefTo, to: core.class.Doc })
  })
  it('updates array elements and rejects reference target changes', () => {
    const original: ArrOf<Doc> = { _class: core.class.ArrOf, label: core.string.Array, of: type(first) }
    const source: ArrOf<Doc> = { ...original, of: type(second) }
    expect(updateReferenceFilters(original, source)).toEqual(source)
    const other: RefTo<Doc> = { ...type(second), to: core.class.Space }
    expect(updateReferenceFilters(type(first), other)).toEqual(type(first))
    expect(updateReferenceFilters(original, type(first))).toBe(original)
  })
})
