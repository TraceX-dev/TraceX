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

import { jsonToPmNode } from '@hcengineering/text'
import { markdownToInlineCell, markdownToMarkup, markupToMarkdown } from '@hcengineering/text-markdown'

import { escapeMarkdownTableCellContent } from '../markdown/escape'

// The markdown a copied table carries through the clipboard is parsed back by
// TableMetadataPastePlugin via `Node.fromJSON(view.state.schema, markupNode)`. `fromJSON`
// itself does not validate content, so an invalid cell only surfaces later — as content
// silently dropped while fitting the slice, or as a throw that the plugin swallows and
// falls back to a plain-text paste. `Node.check()` is what actually validates the tree
// against the schema, so these tests assert on it.
//
// The schema comes from ServerKit (@hcengineering/text), the server-side twin of the
// editor kit in plugins/text-editor-resources/src/kits/editor-kit.ts — same table, list,
// hard break and image nodes.

type PmNode = ReturnType<typeof jsonToPmNode>

function buildTable (rows: string[][]): string {
  let markdown = '| Title | Rich text |\n| --- | --- |\n'
  for (const row of rows) {
    markdown += '| ' + row.join(' | ') + ' |\n'
  }
  return markdown
}

/** Mirrors what tableBuilder writes for a non-title column. */
function cell (value: string): string {
  return escapeMarkdownTableCellContent(value)
}

/** Mirrors what the card formatter produces for a markup (rich text) attribute. */
function markupCell (markup: any): string {
  return cell(markdownToInlineCell(markupToMarkdown(markup)))
}

function pmDocFor (markdown: string): PmNode {
  return jsonToPmNode(markdownToMarkup(markdown))
}

function expectValid (markdown: string): PmNode {
  const doc = pmDocFor(markdown)
  expect(() => {
    doc.check()
  }).not.toThrow()
  return doc
}

function collect (doc: PmNode, typeName: string): PmNode[] {
  const found: PmNode[] = []
  doc.descendants((node: PmNode) => {
    if (node.type.name === typeName) {
      found.push(node)
    }
    return true
  })
  return found
}

describe('copied table cells satisfy the editor schema', () => {
  it('accepts a plain text cell', () => {
    const doc = expectValid(buildTable([[cell('TC-1'), cell('nothing special')]]))
    expect(collect(doc, 'table')).toHaveLength(1)
    expect(collect(doc, 'tableCell')).toHaveLength(2)
  })

  it('accepts a document link cell', () => {
    const doc = expectValid(
      buildTable([[cell('TC-1'), cell('[Suite A](http://huly.local:8080/workbench/t/card/69d3cfb2a78c161c977dd6a0)')]])
    )
    const links = collect(doc, 'text').filter((n) => n.marks.some((m: any) => m.type.name === 'link'))
    expect(links).toHaveLength(1)
  })

  it('accepts an image copied from a markup field and keeps its file-id', () => {
    const markup = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'image', attrs: { 'file-id': 'blob-abc', width: 320, alt: 'screenshot' } }]
        }
      ]
    }

    const doc = expectValid(buildTable([[cell('TC-1'), markupCell(markup)]]))

    const images = collect(doc, 'image')
    expect(images).toHaveLength(1)
    expect(images[0].attrs['file-id']).toBe('blob-abc')

    // and it really landed inside the table, not next to it
    const cells = collect(doc, 'tableCell')
    expect(collect(cells[1], 'image')).toHaveLength(1)
  })

  it('accepts bullet points copied from a markup field', () => {
    const markup = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Steps' }] },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] }
          ]
        }
      ]
    }

    const doc = expectValid(buildTable([[cell('TC-1'), markupCell(markup)]]))

    expect(collect(doc, 'hardBreak')).toHaveLength(2)
    expect(doc.textBetween(0, doc.content.size, '\n', '')).toContain('• one')
  })

  it('accepts emphasis, an escaped pipe and a line break in one cell', () => {
    const markup = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a | b ' },
            { type: 'text', marks: [{ type: 'bold' }], text: 'bold' }
          ]
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'second line' }] }
      ]
    }

    const doc = expectValid(buildTable([[cell('TC-1'), markupCell(markup)]]))

    expect(collect(doc, 'hardBreak')).toHaveLength(1)
    const bold = collect(doc, 'text').filter((n) => n.marks.some((m: any) => m.type.name === 'bold'))
    expect(bold).toHaveLength(1)
    // the pipe survived as text instead of splitting the row into a third column
    expect(collect(doc, 'tableCell')).toHaveLength(2)
    expect(doc.textBetween(0, doc.content.size, '\n', '')).toContain('a | b')
  })

  it('accepts a markup field that itself contains a table', () => {
    const markup = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h' }] }] }
              ]
            },
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] }]
            }
          ]
        }
      ]
    }

    const doc = expectValid(buildTable([[cell('TC-1'), markupCell(markup)]]))

    // the inner table is flattened, so the pasted document holds exactly one table
    expect(collect(doc, 'table')).toHaveLength(1)
  })

  it('accepts a multi-row table', () => {
    const doc = expectValid(
      buildTable([
        [cell('TC-1'), cell('first')],
        [cell('TC-2'), cell('second')],
        [cell('TC-3'), cell('')]
      ])
    )
    expect(collect(doc, 'tableRow')).toHaveLength(4)
  })
})

describe('block html inside a cell is rejected by the schema', () => {
  // These are the shapes markdownToInlineCell exists to prevent. They are not produced
  // any more; the tests pin down that they would be invalid if they ever came back,
  // which is what makes the assertions above meaningful.

  it('rejects a bullet list left as raw html in a cell', () => {
    const doc = pmDocFor(buildTable([['TC-1', '<ul><li>one</li><li>two</li></ul>']]))
    expect(() => {
      doc.check()
    }).toThrow(/Invalid content for node paragraph/)
  })

  it('rejects a nested table left as raw html in a cell', () => {
    const doc = pmDocFor(buildTable([['TC-1', '<table><tr><td>1</td></tr></table>']]))
    expect(() => {
      doc.check()
    }).toThrow(/Invalid content for node paragraph/)
  })
})
