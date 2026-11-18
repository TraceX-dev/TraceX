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

import { Buffer } from 'node:buffer'
import type { PlatformContext } from '@hcengineering/ai-core'
import core from '@hcengineering/core'
import type {
  AnyAttribute,
  Class,
  CollaborativeDoc,
  Doc,
  FindResult,
  Hierarchy,
  TxOperations
} from '@hcengineering/core'
import { objectLookupTool } from '../../object/object.lookup'
import { fulltextSearchTool } from '../../fulltext/fulltext.search'
import { decodeAgentDocument, encodeAgentDocument, getCollaborativeFields } from '../collaborative-document'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  translate: jest.fn(async (label: string) => label)
}))

const document: CollaborativeDoc = {
  objectClass: 'card:types:Document' as CollaborativeDoc['objectClass'],
  objectId: 'object/with spaces/текст' as CollaborativeDoc['objectId'],
  objectAttr: 'content'
}

it('round-trips a workspace-independent opaque address', () => {
  const encoded = encodeAgentDocument(document)
  expect(encoded).toMatch(/^d1\.[A-Za-z0-9_-]+$/)
  expect(decodeAgentDocument(encoded)).toEqual(document)
})

it.each(['', 'workspace|class|object|content', 'd2.unknown', 'd1.@@', 'd1.W10', 'd1.bnVsbA'])(
  'rejects malformed or unsupported addresses: %s',
  (address) => {
    expect(() => decodeAgentDocument(address)).toThrow('Use a docName returned in collaborativeFields')
  }
)

it('rejects structurally invalid payloads and transport delimiter injection', () => {
  for (const parts of [
    ['class', 'object'],
    ['class', '', 'content'],
    ['class', 'object', 1],
    ['class', 'object', 'other|content']
  ]) {
    const encoded = 'd1.' + Buffer.from(JSON.stringify(parts)).toString('base64url')
    expect(() => decodeAgentDocument(encoded)).toThrow()
  }
})

it('discovers visible inherited fields with the actual class, excluding tag mixins', async () => {
  const inherited = 'base-class' as AnyAttribute['attributeOf']
  const mixin = 'tag-mixin' as AnyAttribute['attributeOf']
  const attributeType: Partial<AnyAttribute['type']> = { _class: core.class.TypeCollaborativeDoc }
  const content: Partial<AnyAttribute> = {
    name: 'content',
    label: 'Content' as AnyAttribute['label'],
    attributeOf: inherited,
    type: attributeType as AnyAttribute['type']
  }
  const hidden: Partial<AnyAttribute> = { ...content, name: 'hidden', hidden: true }
  const tag: Partial<AnyAttribute> = { ...content, name: 'tagField', attributeOf: mixin }
  const attrs = new Map<string, AnyAttribute>([
    ['content', content as AnyAttribute],
    ['hidden', hidden as AnyAttribute],
    ['tagField', tag as AnyAttribute]
  ])
  const hierarchy: Partial<Hierarchy> = {
    getAllAttributes: jest.fn(() => attrs),
    isMixin: (value) => value === mixin,
    isDerived: (value, base) => value === base
  }
  const context: Partial<PlatformContext> = { hierarchy: hierarchy as Hierarchy }
  const object: Partial<Doc> = { _class: document.objectClass, _id: document.objectId }
  const fields = await getCollaborativeFields(context as PlatformContext, object as Doc)
  expect(fields).toEqual([{ key: 'content', label: 'Content', docName: encodeAgentDocument(document) }])
  expect(hierarchy.getAllAttributes).toHaveBeenCalledWith(document.objectClass, core.class.Doc)
})

function lookupContext (missing = false): PlatformContext {
  const attributeType: Partial<AnyAttribute['type']> = { _class: core.class.TypeCollaborativeDoc }
  const attribute: Partial<AnyAttribute> = {
    name: 'content',
    label: 'Content' as AnyAttribute['label'],
    attributeOf: document.objectClass,
    type: attributeType as AnyAttribute['type']
  }
  const getClass = jest.fn((id: Class<Doc>['_id']) => {
    const model: Partial<Class<Doc>> = { _id: id, label: 'Class' as Class<Doc>['label'] }
    return model as Class<Doc>
  })
  const hierarchy: Partial<Hierarchy> = {
    getClass: getClass as Hierarchy['getClass'],
    getAllAttributes: () => new Map([['content', attribute as AnyAttribute]]),
    classHierarchyMixin: () => undefined,
    isMixin: () => false,
    isDerived: (value, base) => value === base
  }
  const object: Partial<Doc> & { title: string } = {
    _id: document.objectId,
    _class: document.objectClass,
    title: 'Current title',
    space: 'space' as Doc['space']
  }
  const indexed: Pick<Doc, '_id' | '_class' | 'createdOn'> = {
    _id: document.objectId,
    _class: 'stale-index-class' as Doc['_class'],
    createdOn: 0
  }
  const searchResult: { docs: Array<{ id: Doc['_id'], title: string, doc: typeof indexed }> } = {
    docs: [{ id: document.objectId, title: 'Indexed title', doc: indexed }]
  }
  const findAll = jest.fn(async (clazz: Doc['_class']) => {
    const rows = clazz === core.class.Space || missing ? [] : [object as Doc]
    const found: FindResult<Doc> = Object.assign(rows, { total: rows.length })
    return found
  })
  const searchFulltext = jest.fn(async () => searchResult)
  const client: Partial<TxOperations> = {
    findAll: findAll as TxOperations['findAll'],
    searchFulltext: searchFulltext as TxOperations['searchFulltext']
  }
  const context: Partial<PlatformContext> = { hierarchy: hierarchy as Hierarchy, client: client as TxOperations }
  return context as PlatformContext
}

it('returns ready addresses from generic object lookup', async () => {
  const result = await objectLookupTool.execute({ classId: document.objectClass }, lookupContext())
  if (!result.ok) throw new Error(JSON.stringify(result.error))
  expect(decodeAgentDocument(result.output.results[0].collaborativeFields[0].docName)).toEqual(document)
})

it('uses the loaded object class in fulltext results and omits addresses for missing objects', async () => {
  const result = await fulltextSearchTool.execute({ query: 'Current' }, lookupContext())
  if (!result.ok) throw new Error('Expected fulltext search success')
  expect(result.output.results[0].class.id).toBe(document.objectClass)
  expect(decodeAgentDocument(result.output.results[0].collaborativeFields[0].docName)).toEqual(document)
  const missing = await fulltextSearchTool.execute({ query: 'Current' }, lookupContext(true))
  if (!missing.ok) throw new Error('Expected fulltext search success')
  expect(missing.output.results[0].collaborativeFields).toEqual([])
})
