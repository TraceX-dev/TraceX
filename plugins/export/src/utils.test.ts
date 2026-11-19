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

import core, { type AnyAttribute, type Doc, type Hierarchy, type Ref, type Class } from '@hcengineering/core'
import { hasDocumentContent } from './utils'

const doc: Partial<Doc> = { _id: 'document' as Ref<Doc>, _class: 'test:class:Document' as Ref<Class<Doc>> }
const hierarchy: Pick<Hierarchy, 'findAttribute' | 'isDerived'> = { findAttribute: jest.fn(), isDerived: jest.fn() }
const attribute: Partial<AnyAttribute> = {
  type: { _class: core.class.TypeCollaborativeDoc, label: core.string.String }
}

describe('document content availability', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('uses the inherited field schema even when the content value is empty', () => {
    jest.mocked(hierarchy.findAttribute).mockReturnValue(attribute as AnyAttribute)
    jest.mocked(hierarchy.isDerived).mockReturnValue(true)
    expect(hasDocumentContent(hierarchy as Hierarchy, doc as Doc)).toBe(true)
    expect(hierarchy.findAttribute).toHaveBeenCalledWith(doc._class, 'content')
    expect(hierarchy.isDerived).toHaveBeenCalledWith(core.class.TypeCollaborativeDoc, core.class.TypeCollaborativeDoc)
  })

  it('rejects objects without a content field', () => {
    jest.mocked(hierarchy.findAttribute).mockReturnValue(undefined)
    expect(hasDocumentContent(hierarchy as Hierarchy, doc as Doc)).toBe(false)
    expect(hierarchy.isDerived).not.toHaveBeenCalled()
  })

  it('rejects ordinary string fields named content', () => {
    jest.mocked(hierarchy.findAttribute).mockReturnValue(attribute as AnyAttribute)
    jest.mocked(hierarchy.isDerived).mockReturnValue(false)
    expect(hasDocumentContent(hierarchy as Hierarchy, doc as Doc)).toBe(false)
  })
})
