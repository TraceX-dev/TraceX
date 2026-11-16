//
// Copyright © 2025 Hardcore Engineering Inc.
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

import {
  Blockquote,
  Bold,
  BulletList,
  Document,
  Dropcursor,
  Gapcursor,
  Heading,
  HorizontalRule,
  Italic,
  Link,
  ListItem,
  OrderedList,
  Paragraph,
  Strike,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  Text,
  TextAlign,
  TextStyle,
  Typography,
  Underline,
  UndoRedo
} from '../tiptapExtensions'

import { enumValidator } from '../nodes/utils'
import { ExtensionFactory, extensionKit } from '../kit'
import { BackgroundColor, TextColor } from '../marks/colors'
import { CellAlign } from '../marks/cellAlign'
import { InlineCommentMark } from '../marks/inlineComment'
import { CodeBlockExtension, codeBlockOptions, CommentNode, MarkdownNode, TodoItemNode, TodoListNode } from '../nodes'

import { CodeExtension, codeOptions } from '../marks/code'
import { MermaidExtension, mermaidOptions } from '../nodes/mermaid'
import type { AddSchemaAwareness, SchemaAwareness } from '@hcengineering/text-agent'

const tableCellAwareness: AddSchemaAwareness = function () {
  const supported = this.schema.nodes[this.name].spec.attrs ?? {}
  const attributes: NonNullable<SchemaAwareness['attributes']> = {
    colspan: { description: 'Number of columns spanned by the cell.' },
    rowspan: { description: 'Number of rows spanned by the cell.' },
    colwidth: { description: 'Column widths in pixels.' },
    align: { description: 'Native table cell alignment.' },
    backgroundColor: { description: 'Cell background color.' },
    textAlign: { description: 'Horizontal text alignment.' },
    verticalAlign: { description: 'Vertical content alignment.' }
  }
  return {
    label: this.name === 'tableHeader' ? 'Table header cell' : 'Table cell',
    description:
      'Cell containing block content. Span, width, color and alignment attributes apply only when enabled by the configured editor.',
    attributes: Object.fromEntries(Object.entries(attributes).filter(([name]) => Object.hasOwn(supported, name)))
  }
}

export const CommonKitFactory = (e: ExtensionFactory) =>
  ({
    text: e(Text.extend({ addSchemaAwareness: () => ({ description: 'Plain text.' }) })),
    document: e(Document.extend({ addSchemaAwareness: () => ({ description: 'Document root.' }) })),
    paragraph: e(
      Paragraph.extend({
        addSchemaAwareness () {
          const attributes: NonNullable<SchemaAwareness['attributes']> = Object.hasOwn(
            this.schema.nodes[this.name].spec.attrs ?? {},
            'textAlign'
          )
            ? { textAlign: { description: 'Horizontal text alignment.' } }
            : {}
          return {
            description: 'Text paragraph.',
            attributes,
            example: { type: this.name, content: [{ type: 'text', text: 'Example paragraph' }] }
          }
        }
      })
    ),

    bold: e(Bold.extend({ addSchemaAwareness: () => ({ description: 'Bold text.' }) })),
    italic: e(Italic.extend({ addSchemaAwareness: () => ({ description: 'Italic text.' }) })),
    strike: e(Strike.extend({ addSchemaAwareness: () => ({ description: 'Strikethrough text.' }) })),

    comment: e(CommentNode),
    markdown: e(MarkdownNode, { HTMLAttributes: { class: 'proseCodeBlock' } }),

    inlineComment: e(InlineCommentMark),

    horizontalRule: e(HorizontalRule.extend({ addSchemaAwareness: () => ({ description: 'Horizontal separator.' }) })),
    heading: e(
      Heading.extend({
        addSchemaAwareness () {
          return {
            description: `Section heading; levels ${this.options.levels.join(', ')}.`,
            attributes: {
              level: { description: 'Heading level.' },
              ...(Object.hasOwn(this.schema.nodes[this.name].spec.attrs ?? {}, 'textAlign')
                ? { textAlign: { description: 'Horizontal text alignment.' } }
                : {})
            }
          }
        }
      })
    ),
    underline: e(Underline.extend({ addSchemaAwareness: () => ({ description: 'Underlined text.' }) })),
    blockquote: e(Blockquote.extend({ addSchemaAwareness: () => ({ description: 'Quoted block content.' }) }), {
      HTMLAttributes: { class: 'proseBlockQuote' }
    }),
    link: e(
      Link.extend({
        inclusive: false,
        addSchemaAwareness () {
          return {
            description: 'Hyperlink.',
            attributes: {
              href: { description: 'Link destination URL.' },
              target: { description: 'Browsing context for the link.' },
              rel: { description: 'Link relationship tokens.' },
              class: { description: 'CSS class names.' },
              title: { description: 'Link tooltip text.' }
            }
          }
        }
      }),
      {
        openOnClick: false,
        HTMLAttributes: { class: 'cursor-pointer', rel: 'noopener noreferrer', target: '_blank' }
      }
    ),
    textAlign: e(
      TextAlign.extend({
        addGlobalAttributes () {
          return (this.parent?.() ?? []).map((group) => ({
            ...group,
            attributes: {
              ...group.attributes,
              textAlign: {
                ...group.attributes.textAlign,
                validate: enumValidator(this.options.alignments, this.options.defaultAlignment === null)
              }
            }
          }))
        }
      }),
      {
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right'],
        defaultAlignment: null
      }
    ),

    typography: e(Typography),

    dropcursor: e(Dropcursor),
    gapcursor: e(Gapcursor),
    undoRedo: e(UndoRedo)
  }) as const

export const CommonKit = extensionKit('common-kit', CommonKitFactory)

export const TextColorStylingKit = extensionKit(
  'text-color-styling',
  (e) =>
    ({
      textStyle: e(
        TextStyle.extend({
          addSchemaAwareness () {
            const attrs = this.schema.marks[this.name].spec.attrs ?? {}
            return {
              label: 'Text style',
              description: 'Text styling attributes provided by the configured editor, including foreground color.',
              attributes: Object.fromEntries(
                Object.entries({ color: { description: 'Foreground text color.' } }).filter(([name]) =>
                  Object.hasOwn(attrs, name)
                )
              )
            }
          }
        })
      ),
      testColor: e(TextColor),
      // tableHeader was missing here, so header cells always fell back to prose.scss's
      // hardcoded grey and couldn't be recolored.
      backgroundColor: e(BackgroundColor, { types: ['tableCell', 'tableHeader'] }),
      cellAlign: e(CellAlign, { types: ['tableCell'] })
    }) as const
)

export const TableKit = extensionKit(
  'table-kit',
  (e) =>
    ({
      table: e(Table.extend({ addSchemaAwareness: () => ({ description: 'Table of rows.' }) }), {
        resizable: false,
        HTMLAttributes: { class: 'proseTable' }
      }),
      tableRow: e(TableRow.extend({ addSchemaAwareness: () => ({ description: 'Row of table cells.' }) })),
      tableHeader: e(TableHeader.extend({ addSchemaAwareness: tableCellAwareness })),
      tableCell: e(TableCell.extend({ addSchemaAwareness: tableCellAwareness }))
    }) as const
)

export const CodeSnippetsKit = extensionKit(
  'code-snippet-kit',
  (e) =>
    ({
      codeBlock: e(CodeBlockExtension, codeBlockOptions),
      codeBlockMermaid: e(MermaidExtension, mermaidOptions),
      codeInline: e(CodeExtension, codeOptions)
    }) as const
)

export const CommonListKitFactory = (e: ExtensionFactory) =>
  ({
    listItem: e(
      ListItem.extend({
        group: 'listItems',
        addSchemaAwareness: () => ({ description: 'List entry starting with a paragraph.' })
      })
    ),
    bulletList: e(
      BulletList.extend({
        content: 'listItems+',
        addSchemaAwareness: () => ({ description: 'Unordered list.' })
      })
    ),
    orderedList: e(
      OrderedList.extend({
        content: 'listItems+',
        addSchemaAwareness () {
          return {
            description: 'Numbered list.',
            attributes: {
              start: { description: 'Starting item number.' },
              type: { description: 'Ordered list numbering style.' }
            }
          }
        }
      })
    )
  }) as const

export const ListKit = extensionKit(
  'list-kit',
  (e) =>
    ({
      ...CommonListKitFactory(e),
      todoItem: e(TodoItemNode),
      todoList: e(TodoListNode)
    }) as const
)
