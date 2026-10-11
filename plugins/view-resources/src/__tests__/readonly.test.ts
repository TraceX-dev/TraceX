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

import type { Class, Doc, Hierarchy, Mixin, PersonId, Ref, Space, VersionableDoc } from '@hcengineering/core'
import { isObjectAttributeReadonly } from '../readonly'

const doc: Doc = {
  _id: 'test:doc' as Ref<Doc>,
  _class: 'test:class:Doc' as Ref<Class<Doc>>,
  space: 'test:space' as Ref<Space>,
  modifiedOn: 0,
  modifiedBy: 'test:person' as PersonId
}

const parentClass = 'test:class:Parent' as Ref<Class<Doc>>
const tag = 'test:mixin:Details' as Ref<Mixin<Doc>>
const otherTag = 'test:mixin:Other' as Ref<Mixin<Doc>>
const hierarchy: Pick<Hierarchy, 'isMixin' | 'getAncestors'> = {
  isMixin: (id) => id === tag || id === otherTag,
  getAncestors: (id) => [id, parentClass]
}

describe('object readonly in collection views', () => {
  it('leaves ordinary documents editable', () => {
    expect(isObjectAttributeReadonly(doc, { key: 'title' }, hierarchy)).toBe(false)
  })

  it('locks every field of a readonly document', () => {
    const object: VersionableDoc = { ...doc, readonly: true }
    expect(isObjectAttributeReadonly(object, { key: 'title' }, hierarchy)).toBe(true)
    expect(isObjectAttributeReadonly(object, { key: 'rank' }, hierarchy)).toBe(true)
  })

  it('locks only the fields listed on the object', () => {
    const object = { ...doc, readonly: false, readonlyFields: ['title'] }
    expect(isObjectAttributeReadonly(object, { key: 'title' }, hierarchy)).toBe(true)
    expect(isObjectAttributeReadonly(object, { key: 'rank' }, hierarchy)).toBe(false)
  })

  it('checks mixin fields without the cast prefix', () => {
    const object = { ...doc, readonlyFields: ['status'] }
    expect(
      isObjectAttributeReadonly(
        object,
        {
          key: 'test:mixin:Details.status',
          castRequest: tag
        },
        hierarchy
      )
    ).toBe(true)
  })

  it.each(['$associations.related_b.title', '$associations.related_b.$associations.nested_a.title'])(
    'checks the related object field for %s',
    (key) => {
      const object = { ...doc, readonlyFields: ['title'] }
      expect(isObjectAttributeReadonly(object, { key }, hierarchy)).toBe(true)
      expect(isObjectAttributeReadonly(doc, { key }, hierarchy)).toBe(false)
    }
  )

  it.each([doc._class, parentClass])('locks main fields for section %s, leaving tag fields editable', (section) => {
    const object = { ...doc, readonlySections: [section] }
    expect(isObjectAttributeReadonly(object, { key: 'title' }, hierarchy)).toBe(true)
    expect(isObjectAttributeReadonly(object, { key: 'rank' }, hierarchy)).toBe(true)
    expect(isObjectAttributeReadonly(object, { key: `${tag}.status`, castRequest: tag }, hierarchy)).toBe(false)
  })

  it('locks only fields of the selected tag', () => {
    const object = { ...doc, readonlySections: [tag] }
    expect(isObjectAttributeReadonly(object, { key: `${tag}.status`, castRequest: tag }, hierarchy)).toBe(true)
    expect(isObjectAttributeReadonly(object, { key: 'title' }, hierarchy)).toBe(false)
    expect(isObjectAttributeReadonly(object, { key: `${otherTag}.status`, castRequest: otherTag }, hierarchy)).toBe(
      false
    )
  })

  it('checks section locks in update handlers without a cast prefix', () => {
    const object = { ...doc, readonlySections: [tag] }
    expect(isObjectAttributeReadonly(object, { key: 'status', attribute: { attributeOf: tag } }, hierarchy)).toBe(true)
    expect(isObjectAttributeReadonly(object, { key: 'status', attribute: { attributeOf: otherTag } }, hierarchy)).toBe(
      false
    )
  })

  it('uses the displayed tag section for inherited attributes', () => {
    const object = { ...doc, readonlySections: [tag] }
    expect(
      isObjectAttributeReadonly(
        object,
        {
          key: `${tag}.status`,
          castRequest: tag,
          attribute: { attributeOf: otherTag }
        },
        hierarchy
      )
    ).toBe(true)
  })

  it('checks the related document main section', () => {
    const object = { ...doc, readonlySections: [parentClass] }
    const attribute = { key: '$associations.related_b.title' }
    expect(isObjectAttributeReadonly(object, attribute, hierarchy)).toBe(true)
    expect(isObjectAttributeReadonly(doc, attribute, hierarchy)).toBe(false)
  })

  it('preserves the tag section when an update uses an unprefixed field key', () => {
    const object = { ...doc, readonlySections: [tag], readonlyFields: ['status'] }
    expect(
      isObjectAttributeReadonly(
        object,
        {
          key: 'status',
          castRequest: tag,
          attribute: { attributeOf: otherTag }
        },
        hierarchy
      )
    ).toBe(true)
    expect(
      isObjectAttributeReadonly(
        { ...object, readonlyFields: [] },
        {
          key: 'status',
          castRequest: tag,
          attribute: { attributeOf: otherTag }
        },
        hierarchy
      )
    ).toBe(true)
  })
})
