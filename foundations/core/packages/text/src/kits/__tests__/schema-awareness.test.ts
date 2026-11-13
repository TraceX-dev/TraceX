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

import { getSchema } from '@tiptap/core'
import { Awareness, getEditorContext } from '@hcengineering/text-agent'
import type { EditorContext } from '@hcengineering/text-agent'
import { CommonKitFactory } from '../common-kit'
import type { ExtensionFactory } from '../../kit'
import { ServerKit } from '../server-kit'
import { ReferenceNode } from '../../nodes/reference'

describe('shared extension schema awareness', () => {
  let context: EditorContext
  beforeAll(() => {
    context = getEditorContext(new Awareness([ServerKit]))
  })

  it('describes every visible native attribute in the server profile', () => {
    const missing: string[] = []
    for (const [name, item] of Object.entries({ ...context.nodes, ...context.marks })) {
      for (const [attribute, metadata] of Object.entries(item.attributes)) {
        if (metadata.hidden !== true && (metadata.description?.trim().length ?? 0) === 0) {
          missing.push(`${name}.${attribute}`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it.each([
    'reference',
    'file',
    'image',
    'embed',
    'emoji',
    'todoItem',
    'todoList',
    'comment',
    'markdown',
    'codeBlock',
    'mermaid',
    'code',
    'note',
    'inline-comment',
    'node-uuid',
    'textStyle',
    'tableCell',
    'tableHeader'
  ])('describes the owning extension and every persisted attribute: %s', (name) => {
    const native = getSchema([ServerKit])
    const item = context.nodes[name] ?? context.marks[name]
    expect(item).toBeDefined()
    expect(item.description).toEqual(expect.any(String))
    expect(item.type).toBe(native.marks[name] === undefined ? 'node' : 'mark')
    const type = native.nodes[name] ?? native.marks[name]
    expect(Object.keys(item.attributes)).toEqual(Object.keys(type.spec.attrs ?? {}))
    for (const attr of Object.values(item.attributes)) {
      expect(attr.name).toEqual(expect.any(String))
      expect(attr.hidden === true || (attr.description?.trim().length ?? 0) > 0).toBe(true)
      for (const type of [attr.type].flat()) {
        expect(type).toEqual(expect.any(String))
        expect(type).not.toMatch(/\||null|undefined/)
      }
      expect(attr.required).toEqual(expect.any(Boolean))
      expect(attr.nullable).toEqual(expect.any(Boolean))
    }
  })

  it('describes image layout and source attributes with plain metadata', () => {
    const image = context.nodes.image
    expect(image.label).toBe('Stored image')
    expect(image.attributes['file-id']).toMatchObject({ type: 'string', required: false, nullable: true })
    expect(image.attributes.width).toMatchObject({ type: ['string', 'number'], nullable: true })
    expect(image.attributes.display.enum).toEqual(['block', 'inline'])
    expect(image.attributes.align.enum).toEqual(['left', 'center', 'right'])
  })

  it('describes and validates text alignment from the extension configuration', () => {
    const awareness = new Awareness([ServerKit])
    for (const type of ['paragraph', 'heading', 'tableCell']) {
      expect(context.nodes[type].attributes.textAlign).toMatchObject({
        type: 'string',
        nullable: true,
        default: null,
        enum: ['left', 'center', 'right']
      })
    }
    for (const textAlign of ['left', 'center', 'right', null]) {
      expect(() => {
        awareness.schema.nodeFromJSON({ type: 'paragraph', attrs: { textAlign } }).check()
      }).not.toThrow()
    }
    for (const textAlign of ['justify', 'invalid', 1, false]) {
      expect(() => {
        awareness.schema.nodeFromJSON({ type: 'paragraph', attrs: { textAlign } }).check()
      }).toThrow()
    }
    const factory: ExtensionFactory = (extension, options) => ({ extension, options: options ?? true })
    const alignment = CommonKitFactory(factory).textAlign.extension.configure({
      types: ['paragraph', 'heading'],
      alignments: ['justify'],
      defaultAlignment: 'justify'
    })
    const configured = new Awareness([ServerKit.configure({ textAlign: false }), alignment])
    expect(getEditorContext(configured).nodes.paragraph.attributes.textAlign).toMatchObject({
      type: 'string',
      enum: ['justify'],
      default: 'justify',
      nullable: false
    })
  })

  it('provides a minimal paragraph example accepted by the native schema', () => {
    const awareness = new Awareness([ServerKit])
    const example = context.nodes.paragraph.example
    expect(example).toEqual({ type: 'paragraph', content: [{ type: 'text', text: 'Example paragraph' }] })
    expect(() => {
      awareness.schema.nodeFromJSON(example).check()
    }).not.toThrow()
  })

  it('explains external resource identities and protected comment anchors', () => {
    for (const name of ['reference', 'file', 'image', 'inline-comment', 'node-uuid']) {
      const item = context.nodes[name] ?? context.marks[name]
      expect(JSON.stringify(item)).toMatch(/Preserve|existing/)
    }
    expect(context.marks['node-uuid'].description).toContain('not the editable node')
  })

  it('describes the actual global attributes instead of generic unsupported styles', () => {
    expect(context.nodes.paragraph.attributes).toHaveProperty('textAlign')
    expect(context.marks.textStyle.attributes).toHaveProperty('color')
    expect(context.marks.textStyle.attributes).not.toHaveProperty('fontFamily')
    expect(context.marks.textStyle.attributes).not.toHaveProperty('fontSize')
    expect(context.nodes.tableCell.attributes).toHaveProperty('textAlign')
    expect(context.nodes.tableCell.attributes).toHaveProperty('backgroundColor')
    expect(context.nodes.tableHeader.attributes).toHaveProperty('backgroundColor')
    expect(context.nodes.tableHeader.attributes).not.toHaveProperty('verticalAlign')
  })

  it('does not advertise attributes disabled in a different editor profile', () => {
    const data = getEditorContext(new Awareness([ServerKit.configure({ textColorStyling: false })]))
    expect(data.nodes.tableCell.attributes).not.toHaveProperty('backgroundColor')
    expect(data.nodes.tableCell.attributes).not.toHaveProperty('textAlign')
    expect(data.nodes.tableCell.attributes).not.toHaveProperty('verticalAlign')
    expect(data.nodes.tableCell.attributes).toHaveProperty('colspan')
    expect(data.marks).not.toHaveProperty('textStyle')
  })

  it('is JSON serializable and contains every compiled type without synthetic hash attributes', () => {
    const native = getSchema([ServerKit])
    const stored = JSON.parse(JSON.stringify(context))
    expect(Object.keys(stored.nodes)).toEqual(Object.keys(native.nodes))
    expect(Object.keys(stored.marks)).toEqual(Object.keys(native.marks))
    expect(stored.nodes.reference.attributes.id).toMatchObject({ type: 'string', nullable: true })
    expect(stored.nodes.paragraph.attributes).not.toHaveProperty('_hash')
    expect(getEditorContext(new Awareness([ServerKit]))).toEqual(context)
  })

  it('keeps todo examples valid and derives nesting rules from the configured schema', () => {
    const schema = new Awareness([ServerKit]).schema
    const example = context.nodes.todoItem.example
    expect(example).toBeDefined()
    expect(() => {
      schema.nodeFromJSON(example).check()
    }).not.toThrow()
    expect(context.nodes.todoList.allowedChildren).toEqual(['todoItem'])
    expect(context.nodes.todoItem.allowedChildren).toContain('todoList')
    const flat = getEditorContext(new Awareness([ServerKit.configure({ lists: { todoItem: { nested: false } } })]))
    expect(flat.nodes.todoItem.content).toBe('paragraph+')
    expect(flat.nodes.todoItem.allowedChildren).toEqual(['paragraph'])
  })

  it('allows derived client-style extensions to inherit descriptions from the shared node', () => {
    const Derived = ReferenceNode.extend({ name: 'derivedReference' })
    const data = getEditorContext(new Awareness([ServerKit.configure({ reference: false }), Derived]))
    expect(data.nodes.derivedReference).toMatchObject({
      name: 'derivedReference',
      label: 'Document reference',
      type: 'node'
    })
  })
})
