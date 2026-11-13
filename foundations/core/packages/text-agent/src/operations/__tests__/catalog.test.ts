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

import { Mark, Node } from '@tiptap/core'
import type { Attributes, MarkConfig, NodeConfig } from '@tiptap/core'
import { Awareness } from '../../schema'
import type { SchemaAwareness } from '../../schema'
import { getAgentSchemaCatalog } from '../index'

function createAwareness (
  nodes: NodeConfig[] = [],
  marks: MarkConfig[] = [],
  content = 'block+',
  topNode = 'doc'
): Awareness {
  const root: NodeConfig = { name: topNode, topNode: true, content }
  const paragraph: NodeConfig = { name: 'paragraph', group: 'block', content: 'inline*' }
  const text: NodeConfig = { name: 'text', group: 'inline' }
  return new Awareness([
    ...[root, paragraph, text, ...nodes].map((config) => Node.create(config)),
    ...marks.map((config) => Mark.create(config))
  ])
}

describe('getAgentSchemaCatalog', () => {
  it('lists each type in its block, inline or mark section without requiring metadata', () => {
    const hardBreak: NodeConfig = { name: 'hardBreak', group: 'inline', inline: true }
    const bold: MarkConfig = { name: 'bold' }

    expect(getAgentSchemaCatalog(createAwareness([hardBreak], [bold]))).toBe(
      [
        'Nodes (block):',
        'doc',
        'paragraph',
        'Nodes (inline):',
        'text',
        'hardBreak',
        'Marks:',
        'bold',
        'Nesting (native content expressions):',
        ''
      ].join('\n')
    )
  })

  const descriptions: Array<[SchemaAwareness, string]> = [
    [{ label: 'Fallback label', description: 'First sentence. Second sentence.' }, 'First sentence.'],
    [{ description: 'First sentence.\nSecond sentence.' }, 'First sentence.'],
    [{ description: 'Description without a period' }, 'Description without a period'],
    [{ label: 'Fallback label' }, 'Fallback label']
  ]
  it.each(descriptions)('describes nodes and marks using metadata %j', (metadata, expected) => {
    const callout: NodeConfig = {
      name: 'callout',
      group: 'block',
      addSchemaAwareness: () => metadata
    }
    const note: MarkConfig = { name: 'note', addSchemaAwareness: () => metadata }
    const lines = getAgentSchemaCatalog(createAwareness([callout], [note])).split('\n')

    expect(lines).toContain(`callout: ${expected}`)
    expect(lines).toContain(`note: ${expected}`)
    expect(lines).not.toContain('Second sentence.')
  })

  it('prints writable attributes and enums while omitting hidden and readonly attributes on nodes and marks', () => {
    const enumMetadata: { values: readonly string[] } = { values: ['left', 'center', 'right'] }
    const validate = Object.assign((value: unknown): void => {
      if (typeof value !== 'string' || !enumMetadata.values.includes(value)) {
        throw new RangeError('Invalid alignment')
      }
    }, enumMetadata)
    const attributes: Attributes = {
      title: { default: '' },
      align: { default: 'left', validate },
      editable: { default: false },
      hidden: { default: '' },
      identity: { default: '' }
    }
    const metadata: SchemaAwareness = {
      description: 'Editable annotation.',
      attributes: {
        editable: { hidden: false, access: 'readwrite' },
        hidden: { hidden: true },
        identity: { access: 'readonly' }
      }
    }
    const callout: NodeConfig = {
      name: 'callout',
      group: 'block',
      addAttributes: () => attributes,
      addSchemaAwareness: () => metadata
    }
    const note: MarkConfig = {
      name: 'note',
      addAttributes: () => attributes,
      addSchemaAwareness: () => metadata
    }
    const catalog = getAgentSchemaCatalog(createAwareness([callout], [note]))
    const lines = catalog.split('\n')

    expect(lines).toContain('callout(title, align=left|center|right, editable): Editable annotation.')
    expect(lines).toContain('note(title, align=left|center|right, editable): Editable annotation.')
    expect(catalog).not.toContain('hidden')
    expect(catalog).not.toContain('identity')
  })

  it('omits parentheses when every attribute is hidden or readonly and supports an empty marks section', () => {
    const attributes: Attributes = { secret: { default: '' }, identity: { default: '' } }
    const metadata: SchemaAwareness = {
      attributes: { secret: { hidden: true }, identity: { access: 'readonly' } }
    }
    const callout: NodeConfig = {
      name: 'callout',
      group: 'block',
      addAttributes: () => attributes,
      addSchemaAwareness: () => metadata
    }
    const catalog = getAgentSchemaCatalog(createAwareness([callout]))

    expect(catalog.split('\n')).toContain('callout')
    expect(catalog).not.toContain('callout(')
    expect(catalog).toContain('Marks:\n\nNesting (native content expressions):\n')
  })

  it('expands custom groups and lists every allowed parent of nested nodes', () => {
    const nodes: NodeConfig[] = [
      { name: 'bulletList', group: 'block', content: 'list_entry2+' },
      { name: 'orderedList', group: 'block', content: 'list_entry2+' },
      { name: 'listItem', group: 'list_entry2', content: 'paragraph block*' },
      { name: 'todoItem', group: 'other list_entry2', content: 'block+' },
      { name: 'unrelated', group: 'list_entry2Suffix' }
    ]
    const catalog = getAgentSchemaCatalog(createAwareness(nodes))

    expect(catalog.split('Nesting (native content expressions):\n')[1]).toBe(
      [
        'bulletList: (listItem|todoItem)+',
        'orderedList: (listItem|todoItem)+',
        'listItem: paragraph block*; only inside bulletList|orderedList',
        'todoItem: block+; only inside bulletList|orderedList'
      ].join('\n')
    )
  })

  it('preserves ordered native expressions, alternatives and quantifiers for a custom root', () => {
    const nodes: NodeConfig[] = [
      { name: 'heading', group: 'block', content: 'inline*' },
      { name: 'section', group: 'block', content: 'heading (paragraph|divider){1,3}' },
      { name: 'divider', group: 'block' }
    ]
    const catalog = getAgentSchemaCatalog(createAwareness(nodes, [], 'heading block+', 'article'))

    expect(catalog.split('Nesting (native content expressions):\n')[1]).toBe(
      'article: heading block+\nsection: heading (paragraph|divider){1,3}'
    )
    expect(catalog.split('\n')).toContain('article')
    expect(catalog).not.toContain('doc')
    expect(catalog).not.toContain('only inside')
  })

  it('documents simple content only for restricted blocks and excludes inline and leaf nodes from nesting', () => {
    const nodes: NodeConfig[] = [
      { name: 'blockquote', group: 'block', content: 'block+' },
      { name: 'codeBlock', group: 'block', content: 'text*' },
      { name: 'divider', group: 'block' },
      { name: 'container', group: 'block', content: 'restricted+' },
      { name: 'blockCell', group: 'restricted', content: 'block+' },
      { name: 'inlineCell', group: 'restricted', content: 'inline*' },
      { name: 'textCell', group: 'restricted', content: 'text*' },
      { name: 'inlineContainer', group: 'inline', inline: true, content: 'text{0,3}' }
    ]
    const catalog = getAgentSchemaCatalog(createAwareness(nodes))

    expect(catalog.split('Nesting (native content expressions):\n')[1]).toBe(
      [
        'container: (blockCell|inlineCell|textCell)+',
        'blockCell: block+; only inside container',
        'inlineCell: inline*; only inside container',
        'textCell: text*; only inside container'
      ].join('\n')
    )
  })

  it('uses only the supplied editor configuration on consecutive calls', () => {
    const callout: NodeConfig = { name: 'callout', group: 'block' }
    const note: MarkConfig = { name: 'note' }
    const configured = createAwareness([callout], [note])
    const minimal = createAwareness()
    const before = getAgentSchemaCatalog(configured)
    const other = getAgentSchemaCatalog(minimal)

    expect(before.split('\n')).toContain('callout')
    expect(before.split('\n')).toContain('note')
    expect(other).not.toContain('callout')
    expect(other).not.toContain('note')
    expect(getAgentSchemaCatalog(configured)).toBe(before)
  })
})
