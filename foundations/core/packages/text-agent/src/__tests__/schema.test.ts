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

import { Extension, getSchema, Mark, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Awareness, getEditorContext } from '../index'

interface AlertOptions {
  kinds: string[]
}
interface AlertStorage {
  label: string
}

const Alert = Node.create<AlertOptions, AlertStorage>({
  name: 'alert',
  group: 'block',
  content: 'inline*',
  addOptions () {
    return { kinds: ['info', 'warning'] }
  },
  addStorage () {
    return { label: 'Alert box' }
  },
  addAttributes () {
    return { kind: { default: 'info' } }
  },
  addSchemaAwareness () {
    return {
      label: this.storage.label,
      description: 'Highlighted inline content.',
      attributes: { kind: { description: `Available kinds: ${this.options.kinds.join(', ')}.` } }
    }
  }
})

const Comment = Mark.create({
  name: 'comment',
  excludes: '',
  addAttributes () {
    return { thread: { default: undefined, isRequired: true, validate: 'string' } }
  },
  addSchemaAwareness () {
    return { label: 'Comment anchor', attributes: { thread: { description: 'Existing thread identity.' } } }
  }
})

describe('plain schema awareness without an Editor', () => {
  it('keeps one schema and reads extension metadata once for all consumers', () => {
    let reads = 0
    const Aware = Alert.extend({
      addSchemaAwareness () {
        reads++
        return { label: 'Alert', attributes: { kind: { description: 'Semantic kind.', access: 'readonly' } } }
      }
    })
    const awareness = new Awareness([StarterKit, Aware, Comment])
    const schema = awareness.schema
    expect(awareness.of('alert')?.label).toBe('Alert')
    expect(awareness.attr('alert', 'kind')?.access).toBe('readonly')
    expect(awareness.of('comment')?.label).toBe('Comment anchor')
    expect(awareness.attr('missing', 'kind')).toBeUndefined()
    expect(awareness.attr('alert', 'missing')).toBeUndefined()
    expect(getEditorContext(awareness).nodes.alert.attributes.kind.access).toBe('readonly')
    expect(getEditorContext(awareness)).toEqual(getEditorContext(awareness))
    expect(awareness.schema).toBe(schema)
    expect(reads).toBe(1)
    for (const type of [...Object.values(schema.nodes), ...Object.values(schema.marks)]) {
      expect(type.spec).not.toHaveProperty('schemaAwareness')
    }
  })

  it('supports extensions without awareness hooks', () => {
    const awareness = new Awareness([StarterKit])
    expect(awareness.of('paragraph')).toBeUndefined()
    expect(awareness.attr('heading', 'level')).toBeUndefined()
    expect(getEditorContext(awareness).nodes.heading.attributes.level).toMatchObject({
      name: 'level',
      type: 'number',
      default: 1
    })
  })

  it('describes every compiled node and mark, including types without custom metadata', () => {
    const extensions = [StarterKit, Alert, Comment]
    const schema = getSchema(extensions)
    const context = getEditorContext(new Awareness(extensions))
    expect(context.topNode).toBe('doc')
    expect(Object.keys(context.nodes)).toEqual(Object.keys(schema.nodes))
    expect(Object.keys(context.marks)).toEqual(Object.keys(schema.marks))
    expect(context.nodes.paragraph).toMatchObject({ name: 'paragraph', type: 'node', content: 'inline*' })
    expect(context.nodes.text).toMatchObject({ type: 'node', inline: true })
    expect(context.nodes.paragraph.marks).toContain('comment')
    expect(context.marks.code.excludes).toEqual(Object.keys(context.marks))
    expect(context.marks.comment).toMatchObject({ type: 'mark', excludes: [] })
  })

  it('combines native attribute information with plain extension metadata', () => {
    const context = getEditorContext(new Awareness([StarterKit, Alert, Comment]))
    expect(context.nodes.alert).toMatchObject({
      label: 'Alert box',
      description: 'Highlighted inline content.',
      attributes: {
        kind: { name: 'kind', type: 'string', required: false, description: 'Available kinds: info, warning.' }
      }
    })
    expect(context.marks.comment.attributes.thread).toEqual({
      name: 'thread',
      type: 'string',
      required: true,
      nullable: false,
      description: 'Existing thread identity.'
    })
  })

  it('resolves nested kits and configured options without editor lifecycle or plugins', () => {
    const lifecycle = jest.fn()
    const plugins = jest.fn(() => [])
    const Kit = Extension.create({
      name: 'awarenessKit',
      addExtensions () {
        return [StarterKit, Alert.configure({ kinds: ['success', 'danger'] })]
      },
      onCreate: lifecycle,
      addProseMirrorPlugins: plugins
    })
    const context = getEditorContext(new Awareness([Kit]))
    expect(context.nodes.alert.attributes.kind.description).toBe('Available kinds: success, danger.')
    expect(lifecycle).not.toHaveBeenCalled()
    expect(plugins).not.toHaveBeenCalled()
  })

  it('inherits hooks through extend and supports explicit parent metadata overrides', () => {
    const Derived = Alert.extend({ name: 'specialAlert' }).configure({ kinds: ['success'] })
    expect(getEditorContext(new Awareness([StarterKit, Derived])).nodes.specialAlert).toMatchObject({
      label: 'Alert box',
      attributes: { kind: { description: 'Available kinds: success.' } }
    })
    const Overridden = Derived.extend({
      addSchemaAwareness () {
        return { ...this.parent?.(), label: 'Special alert' }
      }
    })
    expect(getEditorContext(new Awareness([StarterKit, Overridden])).nodes.specialAlert).toMatchObject({
      label: 'Special alert',
      attributes: { kind: { type: 'string', required: false } }
    })
  })

  it('reports a configured custom root and preserves ordered content expressions', () => {
    const Article = Node.create({ name: 'article', topNode: true, content: 'heading paragraph+' })
    const context = getEditorContext(new Awareness([StarterKit.configure({ document: false }), Article]))
    expect(context.topNode).toBe('article')
    expect(context.nodes.article.content).toBe('heading paragraph+')
    expect(context.nodes.article.allowedChildren).toEqual(['heading', 'paragraph'])
    expect(context.nodes).not.toHaveProperty('doc')
  })

  it('derives attribute types and requiredness from compiled specs', () => {
    const Fields = Node.create({
      name: 'fields',
      group: 'block',
      addAttributes () {
        return {
          target: { default: undefined, isRequired: true, validate: 'string' },
          label: { default: '' },
          enabled: { default: false },
          count: { default: 0 },
          values: { default: [] },
          metadata: { default: {} },
          nullable: { default: null },
          optionalText: { default: undefined, validate: 'string|undefined' },
          requiredNullable: { default: undefined, isRequired: true, validate: 'string|null' },
          union: { default: null, validate: 'string|number|null' }
        }
      }
    })
    const attrs = getEditorContext(new Awareness([StarterKit, Fields])).nodes.fields.attributes
    expect(attrs.target).toMatchObject({ type: 'string', required: true })
    expect(attrs.label).toMatchObject({ type: 'string', required: false, nullable: false })
    expect(attrs.enabled).toMatchObject({ type: 'boolean', required: false })
    expect(attrs.count).toMatchObject({ type: 'number', required: false })
    expect(attrs.values.type).toBe('array')
    expect(attrs.metadata.type).toBe('object')
    expect(attrs.nullable).toMatchObject({ type: 'unknown', required: false, nullable: true })
    expect(attrs.optionalText).toMatchObject({ type: 'string', required: false, nullable: false })
    expect(attrs.requiredNullable).toMatchObject({ type: 'string', required: true, nullable: true })
    expect(attrs.union).toMatchObject({ type: ['string', 'number'], required: false, nullable: true })
  })

  it('rejects metadata for nonexistent attributes instead of silently ignoring typos', () => {
    const Annotated = Alert.extend({
      addSchemaAwareness () {
        return { attributes: { missing: { description: 'Not a native attribute.' } } }
      }
    })
    expect(() => new Awareness([StarterKit, Annotated])).toThrow('unknown attribute missing')
  })

  it('takes defaults, types and requiredness only from native attribute definitions', () => {
    const Annotated = Alert.extend({
      addSchemaAwareness () {
        return { attributes: { kind: { description: 'Semantic kind.', access: 'readonly' } } }
      }
    })
    expect(getEditorContext(new Awareness([StarterKit, Annotated])).nodes.alert.attributes.kind).toMatchObject({
      name: 'kind',
      type: 'string',
      required: false,
      nullable: false,
      default: 'info',
      access: 'readonly'
    })
  })

  it('passes Tiptap validators through to ProseMirror checks', () => {
    const Validated = Alert.extend({
      addAttributes () {
        return { kind: { default: 'info', validate: 'string' } }
      }
    })
    const schema = new Awareness([StarterKit, Validated]).schema
    expect(() => {
      schema.nodeFromJSON({ type: 'alert', attrs: { kind: 42 } }).check()
    }).toThrow()
  })

  it('validates types inferred from defaults without modifying the ordinary editor schema', () => {
    const native = getSchema([StarterKit, Alert])
    const schema = new Awareness([StarterKit, Alert]).schema
    expect(native.nodes.alert.spec.attrs?.kind.validate).toBeUndefined()
    expect(() => {
      native.nodeFromJSON({ type: 'alert', attrs: { kind: 42 } }).check()
    }).not.toThrow()
    expect(() => {
      schema.nodeFromJSON({ type: 'alert', attrs: { kind: 42 } }).check()
    }).toThrow()
    expect(() => {
      schema.nodeFromJSON({ type: 'alert', attrs: { kind: null } }).check()
    }).toThrow()
    expect(() => {
      schema.nodeFromJSON({ type: 'alert', attrs: { kind: 'info' } }).check()
    }).not.toThrow()
  })

  it('validates examples against their owning type and the complete native schema', () => {
    const Example = Alert.extend({
      addSchemaAwareness () {
        return { example: { type: this.name, content: [{ type: 'text', text: 'An alert' }] } }
      }
    })
    expect(getEditorContext(new Awareness([StarterKit, Example])).nodes.alert.example?.type).toBe('alert')
    const Invalid = Example.extend({
      addSchemaAwareness () {
        return { example: { type: this.name, content: [{ type: 'paragraph' }] } }
      }
    })
    expect(() => new Awareness([StarterKit, Invalid])).toThrow()
    const WrongOwner = Example.extend({
      addSchemaAwareness () {
        return { example: { type: 'paragraph' } }
      }
    })
    expect(() => new Awareness([StarterKit, WrongOwner])).toThrow('owning node type')
  })

  it('allows hooks to inspect the complete compiled schema including global attributes', () => {
    const Globals = Extension.create({
      name: 'awarenessGlobals',
      addGlobalAttributes () {
        return [{ types: ['alert'], attributes: { color: { default: null } } }]
      }
    })
    const Aware = Alert.extend({
      addSchemaAwareness () {
        return { description: Object.keys(this.schema.nodes[this.name].spec.attrs ?? {}).join(',') }
      }
    })
    expect(getEditorContext(new Awareness([StarterKit, Aware, Globals])).nodes.alert.description).toBe('color,kind')
  })

  it('returns serializable data without touching options or running attribute validators', () => {
    const validate = jest.fn((_value: unknown) => {})
    const Validated = Node.create({
      name: 'validated',
      group: 'block',
      addAttributes () {
        return { value: { default: null, validate } }
      }
    })
    const options = Alert.options
    const context = getEditorContext(new Awareness([StarterKit, Alert, Validated]))
    const stored = JSON.parse(JSON.stringify(context))
    expect(stored.nodes.alert.attributes.kind).toMatchObject({ name: 'kind', type: 'string', required: false })
    expect(stored.nodes.validated.attributes.value.type).toBe('unknown')
    expect(validate).not.toHaveBeenCalled()
    expect(Alert.options).toEqual(options)
  })
})
