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

import type { Class, Doc, Hierarchy, Ref } from '@hcengineering/core'
import { getClassInclusionFilter } from '../class-filter'

const root = 'test:class:Root' as Ref<Class<Doc>>
const child = 'test:class:Child' as Ref<Class<Doc>>
const tag = 'test:mixin:Tag' as Ref<Class<Doc>>
const childTag = 'test:mixin:ChildTag' as Ref<Class<Doc>>
const otherTag = 'test:mixin:OtherTag' as Ref<Class<Doc>>
const classTag = 'test:mixin:ClassTag' as Ref<Class<Doc>>
const unknown = 'test:class:Missing' as Ref<Class<Doc>>

function hierarchy (): Hierarchy {
  const descendants = new Map([
    [root, [root, child, tag, childTag, otherTag, classTag]],
    [child, [child, classTag]],
    [tag, [tag, childTag]]
  ])
  const mock: Partial<Hierarchy> = {
    hasClass: (id) => id !== unknown,
    getDescendants: (id) => descendants.get(id) ?? [id],
    isMixin: (id) => [tag, childTag, otherTag, classTag].includes(id),
    getBaseClass: (id) => (id === classTag ? child : root),
    hasMixin: (doc, id) => id in doc
  }
  return mock as Hierarchy
}

it('matches selected classes and their subclasses without unnecessary mixin checks', () => {
  const filter = getClassInclusionFilter(hierarchy(), [root])
  expect(filter.query).toEqual({ _class: { $in: [root, child] } })
  expect(filter.projection).toEqual({ _id: 1, _class: 1 })
  const doc: Partial<Doc> = { _class: child }
  expect(filter.matches(doc as Doc)).toBe(true)
})

it('uses a direct existence query for one mixin', () => {
  expect(getClassInclusionFilter(hierarchy(), [otherTag]).query).toEqual({ [otherTag]: { $exists: true } })
})

it('matches a descendant mixin even when its parent marker is absent', () => {
  const filter = getClassInclusionFilter(hierarchy(), [tag])
  expect(filter.query).toBeUndefined()
  const doc: Partial<Doc> = { _class: root, [childTag]: {} }
  expect(filter.matches(doc as Doc)).toBe(true)
})

it('treats mixed classes and mixins as alternatives, not simultaneous requirements', () => {
  const filter = getClassInclusionFilter(hierarchy(), [child, tag])
  expect(filter.query).toBeUndefined()
  expect(filter.projection).toEqual({ _id: 1, _class: 1, [tag]: 1, [childTag]: 1 })
  const classDoc: Partial<Doc> = { _class: child }
  const mixinDoc: Partial<Doc> = { _class: root, [tag]: {} }
  const otherDoc: Partial<Doc> = { _class: root }
  expect(filter.matches(classDoc as Doc)).toBe(true)
  expect(filter.matches(mixinDoc as Doc)).toBe(true)
  expect(filter.matches(otherDoc as Doc)).toBe(false)
})

it('returns an empty inclusion for no selected types', () => {
  expect(getClassInclusionFilter(hierarchy(), []).query).toEqual({ _class: { $in: [] } })
})

it('rejects unavailable classes instead of widening the filter', () => {
  expect(() => getClassInclusionFilter(hierarchy(), [unknown])).toThrow('Unavailable class filter')
})
