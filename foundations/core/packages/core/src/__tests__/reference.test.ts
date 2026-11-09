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
import { getReferenceQuery, updateReferenceExclusions } from '../reference'
import type { DocumentQuery } from '../storage'
import { TxFactory } from '../tx'
import { genMinModel, test } from './minmodel'

const childMixin = 'test:mixin:Child' as Ref<Class<Doc>>
const childClass = 'test:class:Child' as Ref<Class<Doc>>

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
  return hierarchy
}

function reference (...excludedClasses: Ref<Class<Doc>>[]): RefTo<Doc> {
  const type: RefTo<Doc> = { _class: core.class.RefTo, label: core.string.Ref, to: core.class.Doc, excludedClasses }
  return type
}

describe('reference candidate exclusions', () => {
  it('preserves unrestricted references and existing query constraints', () => {
    const query: DocumentQuery<Doc> = { space: core.space.Model, active: true }
    expect(getReferenceQuery(prepare(), undefined, query)).toEqual(query)
    expect(getReferenceQuery(prepare(), reference(), query)).toEqual(query)
  })

  it('excludes a mixin and its descendants without requiring employee activity', () => {
    const query = getReferenceQuery(prepare(), reference(test.mixin.TestMixin))
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
    const result = getReferenceQuery(prepare(), reference(test.class.Task), query)
    expect(result._class).toEqual({ $in: [core.class.Space] })
    expect(result.space).toBe(core.space.Model)
    expect(result._id).toEqual(query._id)
    expect(result[test.mixin.TaskMixinTodos]).toEqual({ $exists: false })
    expect(JSON.stringify(query)).toBe(before)
  })

  it('combines multiple exclusions and deduplicates descendants', () => {
    const result = getReferenceQuery(prepare(), reference(test.mixin.TestMixin, childMixin, core.class.Space))
    expect(result[test.mixin.TestMixin]).toEqual({ $exists: false })
    expect(result[childMixin]).toEqual({ $exists: false })
    expect(result._class).toEqual({ $nin: [core.class.Space] })
  })

  it('returns no candidates when an existing filter requires an excluded mixin', () => {
    const query: DocumentQuery<Doc> = { [test.mixin.TestMixin]: { $exists: true }, active: true }
    const result = getReferenceQuery(prepare(), reference(test.mixin.TestMixin), query)
    expect(result._id).toEqual({ $in: [] })
    expect(result.active).toBe(true)
  })

  it('preserves matching mixin absence constraints', () => {
    const query: DocumentQuery<Doc> = { [test.mixin.TestMixin]: { $exists: false } }
    expect(getReferenceQuery(prepare(), reference(test.mixin.TestMixin), query)[test.mixin.TestMixin]).toEqual({
      $exists: false
    })
  })

  it('does not broaden selection when an excluded class is unavailable', () => {
    const missing = 'test:class:Missing' as Ref<Class<Doc>>
    expect(getReferenceQuery(prepare(), reference(missing))._id).toEqual({ $in: [] })
  })
})

describe('updating existing reference field constraints', () => {
  it('keeps unchanged field types without producing schema updates', () => {
    const original = reference(test.mixin.TestMixin)
    expect(updateReferenceExclusions(original, reference(test.mixin.TestMixin))).toBe(original)
    const array: ArrOf<Ref<Doc>> = { _class: core.class.ArrOf, label: core.string.Array, of: original }
    expect(updateReferenceExclusions(array, array)).toBe(array)
  })

  it('updates and clears exclusions without changing the reference target or other type properties', () => {
    const original: RefTo<Doc> = { ...reference(), label: core.string.Ref }
    const updated = updateReferenceExclusions(original, reference(test.mixin.TestMixin))
    expect(updated).toEqual({ ...original, excludedClasses: [test.mixin.TestMixin] })
    expect(original.excludedClasses).toEqual([])
    expect(updateReferenceExclusions(updated, reference())).toEqual({
      _class: core.class.RefTo,
      to: core.class.Doc,
      label: core.string.Ref
    })
  })

  it('updates array element exclusions while keeping the existing array type', () => {
    const original: ArrOf<Ref<Doc>> = { _class: core.class.ArrOf, label: core.string.Array, of: reference() }
    const source: ArrOf<Ref<Doc>> = {
      _class: core.class.ArrOf,
      label: core.string.Array,
      of: reference(test.mixin.TestMixin)
    }
    expect(updateReferenceExclusions(original, source)).toEqual({
      ...original,
      of: reference(test.mixin.TestMixin)
    })
  })

  it('rejects reference target and array shape changes for existing fields', () => {
    const original = reference()
    const source: RefTo<Doc> = { ...reference(test.mixin.TestMixin), to: core.class.Space }
    const array: ArrOf<Ref<Doc>> = { _class: core.class.ArrOf, label: core.string.Array, of: original }
    expect(updateReferenceExclusions(original, source)).toBe(original)
    expect(updateReferenceExclusions(original, array)).toBe(original)
    expect(updateReferenceExclusions(array, original)).toBe(array)
  })
})
