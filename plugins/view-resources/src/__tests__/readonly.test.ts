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

import type { Class, Doc, Mixin, PersonId, Ref, Space, VersionableDoc } from '@hcengineering/core'
import { isObjectAttributeReadonly } from '../readonly'

const doc: Doc = {
  _id: 'test:doc' as Ref<Doc>,
  _class: 'test:class:Doc' as Ref<Class<Doc>>,
  space: 'test:space' as Ref<Space>,
  modifiedOn: 0,
  modifiedBy: 'test:person' as PersonId
}

describe('object readonly in collection views', () => {
  it('leaves ordinary documents editable', () => {
    expect(isObjectAttributeReadonly(doc, { key: 'title' })).toBe(false)
  })

  it('locks every field of a readonly document', () => {
    const object: VersionableDoc = { ...doc, readonly: true }
    expect(isObjectAttributeReadonly(object, { key: 'title' })).toBe(true)
    expect(isObjectAttributeReadonly(object, { key: 'rank' })).toBe(true)
  })

  it('locks only the fields listed on the object', () => {
    const object = { ...doc, readonly: false, readonlyFields: ['title'] }
    expect(isObjectAttributeReadonly(object, { key: 'title' })).toBe(true)
    expect(isObjectAttributeReadonly(object, { key: 'rank' })).toBe(false)
  })

  it('checks mixin fields without the cast prefix', () => {
    const object = { ...doc, readonlyFields: ['status'] }
    expect(
      isObjectAttributeReadonly(object, {
        key: 'test:mixin:Details.status',
        castRequest: 'test:mixin:Details' as Ref<Mixin<Doc>>
      })
    ).toBe(true)
  })

  it.each(['$associations.related_b.title', '$associations.related_b.$associations.nested_a.title'])(
    'checks the related object field for %s',
    (key) => {
      const object = { ...doc, readonlyFields: ['title'] }
      expect(isObjectAttributeReadonly(object, { key })).toBe(true)
      expect(isObjectAttributeReadonly(doc, { key })).toBe(false)
    }
  )
})
