//
// Copyright © 2026 Hardcore Engineering Inc.
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

import core, { type Doc, type Hierarchy } from '@hcengineering/core'
import { getResource, type IntlString } from '@hcengineering/platform'
import type { AttributeModel } from '@hcengineering/view'
import type { ValueFormatter } from '../types'
import { formatValue } from '../formatter/valueFormatter'

jest.mock('@hcengineering/platform', () => {
  const actual = jest.requireActual('@hcengineering/platform')
  return {
    ...actual,
    translate: jest.fn(async (str: unknown) => String(str)),
    getResource: jest.fn()
  }
})

jest.mock('@hcengineering/presentation', () => ({
  getClient: jest.fn()
}))

jest.mock('../data/personLoader', () => ({
  loadPersonName: jest.fn(async (personId: string) => personId)
}))

// Avoid pulling in Svelte/UI dependencies via createMarkdownLink
jest.mock('../markdown/link', () => ({
  createMarkdownLink: jest.fn(async (_hierarchy: any, _doc: any, text: string) => text)
}))

describe('formatter/valueFormatter', () => {
  it.each(['Title', 'Status', 'Version', 'Labels'])(
    'calls the class formatter for the empty-key %s column',
    async (label) => {
      const attr: Partial<AttributeModel> = { key: '', label: label as IntlString }
      const card: Partial<Doc> = {
        _id: 'document-1' as Doc['_id'],
        _class: 'documents:class:Document' as Doc['_class']
      }
      const hierarchy: Partial<Hierarchy> = {
        classHierarchyMixin: jest.fn().mockReturnValue({ formatter: 'document-formatter' }),
        getClass: jest.fn()
      }
      const formatter: ValueFormatter = jest.fn(async () => `formatted:${label}`)
      jest.mocked(getResource).mockResolvedValue(formatter)

      expect(
        await formatValue(attr as AttributeModel, card as Doc, hierarchy as Hierarchy, card._class!, 'en', false)
      ).toBe(`formatted:${label}`)
    }
  )

  it('keeps unsupported empty-key columns empty after trying custom formatters', async () => {
    const attr: Partial<AttributeModel> = { key: '', label: 'Unsupported' as IntlString }
    const card: Partial<Doc> = { _class: core.class.Doc }
    const hierarchy: Partial<Hierarchy> = {
      classHierarchyMixin: jest.fn(() => undefined),
      getClass: jest.fn()
    }
    const formatter: ValueFormatter = jest.fn(async () => undefined)

    expect(
      await formatValue(
        attr as AttributeModel,
        card as Doc,
        hierarchy as Hierarchy,
        core.class.Doc,
        'en',
        false,
        undefined,
        formatter
      )
    ).toBe('')
    expect(formatter).toHaveBeenCalled()
  })

  const baseCard = {
    _id: 'card-1',
    _class: 'card:class:Card'
  } as unknown as Doc

  it('formats cast property reference values using lookup', async () => {
    const attr = {
      key: 'mixin:class:CardProps.otherCard',
      castRequest: 'mixin:class:CardProps',
      label: 'Other card'
    } as unknown as AttributeModel

    const card = {
      ...baseCard,
      otherCard: 'card-2',
      $lookup: {
        otherCard: { title: 'Related Card' }
      }
    } as unknown as Doc

    const hierarchy = {
      as: jest.fn((doc: Doc) => doc),
      findAttribute: jest.fn((_class: string, key: string) =>
        key === 'otherCard' ? { name: 'otherCard', type: { _class: core.class.RefTo } } : undefined
      ),
      classHierarchyMixin: jest.fn(() => undefined),
      getClass: jest.fn(() => undefined)
    } as any

    const result = await formatValue(attr, card, hierarchy, card._class, 'en', false)
    expect(result).toBe('Related Card')
  })

  it('formats date property values for TypeDate attributes', async () => {
    const timestamp = Date.UTC(2025, 0, 15)
    const attr = {
      key: 'mixin:class:CardProps.dueDate',
      castRequest: 'mixin:class:CardProps',
      label: 'Due date',
      attribute: { name: 'dueDate', type: { _class: core.class.TypeDate } }
    } as unknown as AttributeModel

    const card = {
      ...baseCard,
      dueDate: timestamp
    } as unknown as Doc

    const hierarchy = {
      as: jest.fn((doc: Doc) => doc),
      findAttribute: jest.fn(),
      classHierarchyMixin: jest.fn(() => undefined),
      getClass: jest.fn(() => undefined)
    } as any

    const result = await formatValue(attr, card, hierarchy, card._class, 'en-US', false)
    expect(result).toBe(
      new Date(timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    )
  })

  it('formats cast array reference values for tags using normalized attribute key', async () => {
    const attr = {
      key: 'mixin:class:CardProps.tags',
      castRequest: 'mixin:class:CardProps',
      label: 'Tags'
    } as unknown as AttributeModel

    const card = {
      ...baseCard,
      tags: ['tag-1', 'tag-2'],
      $lookup: {
        tags: [{ title: 'Tag A' }, { title: 'Tag B' }]
      }
    } as unknown as Doc

    const hierarchy = {
      as: jest.fn((doc: Doc) => doc),
      findAttribute: jest.fn((_class: string, key: string) =>
        key === 'tags'
          ? { name: 'tags', type: { _class: core.class.ArrOf, of: { _class: core.class.RefTo } } }
          : undefined
      ),
      classHierarchyMixin: jest.fn(() => undefined),
      getClass: jest.fn(() => undefined)
    } as any

    const result = await formatValue(attr, card, hierarchy, card._class, 'en', false)
    expect(result).toBe('Tag A, Tag B')
  })
})
