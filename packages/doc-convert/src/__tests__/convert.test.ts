//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { MarkupMarkType, type MarkupNode, MarkupNodeType } from '@hcengineering/text-core'
import {
  collectImageRefs,
  computeColumnWidths,
  conformToSchema,
  docxToMarkup,
  markupToDocx,
  markupToMd,
  mdToMarkup,
  normalizeMarkup,
  resolveDocxFill
} from '..'

const sample: MarkupNode = {
  type: MarkupNodeType.doc,
  content: [
    {
      type: MarkupNodeType.heading,
      attrs: { level: 1 },
      content: [{ type: MarkupNodeType.text, text: 'Title' }]
    },
    {
      type: MarkupNodeType.paragraph,
      content: [
        { type: MarkupNodeType.text, text: 'Hello ' },
        { type: MarkupNodeType.text, text: 'world', marks: [{ type: MarkupMarkType.bold }] }
      ]
    },
    {
      type: MarkupNodeType.bullet_list,
      content: [
        {
          type: MarkupNodeType.list_item,
          content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'first' }] }]
        },
        {
          type: MarkupNodeType.list_item,
          content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'second' }] }]
        }
      ]
    }
  ]
}

describe('markupToDocx', () => {
  it('produces a non-empty docx (zip) buffer', async () => {
    const buf = await markupToDocx(sample)
    expect(buf.length).toBeGreaterThan(0)
    // .docx is a zip archive: first two bytes are the "PK" magic
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('handles an empty document without throwing', async () => {
    const buf = await markupToDocx({ type: MarkupNodeType.doc, content: [] })
    expect(buf.length).toBeGreaterThan(0)
  })
})

describe('docxToMarkup', () => {
  it('round-trips text content through docx', async () => {
    const buf = await markupToDocx(sample)
    const { markup } = await docxToMarkup(buf)
    const serialized = JSON.stringify(markup)
    expect(serialized).toContain('Title')
    expect(serialized).toContain('world')
    expect(serialized).toContain('first')
  })
})

describe('normalizeMarkup', () => {
  it('drops empty text nodes and trailing empty paragraphs', () => {
    const messy: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'keep' }] },
        { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: '' }] },
        { type: MarkupNodeType.paragraph, content: [] }
      ]
    }
    const normalized = normalizeMarkup(messy)
    expect(normalized.content).toHaveLength(1)
    expect(JSON.stringify(normalized)).toContain('keep')
  })
})

describe('conformToSchema', () => {
  it('wraps bare text in a list item into a paragraph (schema validity)', () => {
    const invalid: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.bullet_list,
          content: [
            {
              type: MarkupNodeType.list_item,
              content: [{ type: MarkupNodeType.text, text: 'bare' }]
            }
          ]
        }
      ]
    }
    const fixed = conformToSchema(invalid)
    const listItem = fixed.content?.[0].content?.[0]
    expect(listItem?.content?.[0].type).toBe(MarkupNodeType.paragraph)
    expect(JSON.stringify(fixed)).toContain('bare')
  })
})

describe('images', () => {
  // 1x1 transparent PNG
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
  const withImage: MarkupNode = {
    type: MarkupNodeType.doc,
    content: [{ type: MarkupNodeType.image, attrs: { 'file-id': 'blob-1' } }]
  }

  it('collectImageRefs returns image blob references', () => {
    expect(collectImageRefs(withImage)).toEqual(['blob-1'])
  })

  it('embeds an image when its bytes are supplied', async () => {
    const images = new Map<string, Uint8Array>([['blob-1', png1x1]])
    const buf = await markupToDocx(withImage, { images })
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('skips images without supplied bytes (no throw)', async () => {
    const buf = await markupToDocx(withImage)
    expect(buf.length).toBeGreaterThan(0)
  })
})

describe('conformToSchema (schema validity)', () => {
  it('gives an empty table cell a fallback paragraph', () => {
    const table: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.table,
          content: [
            {
              type: MarkupNodeType.table_row,
              content: [{ type: MarkupNodeType.table_cell, content: [] }]
            }
          ]
        }
      ]
    }
    const fixed = conformToSchema(table)
    const cell = fixed.content?.[0].content?.[0].content?.[0]
    expect(cell?.content).toHaveLength(1)
    expect(cell?.content?.[0].type).toBe(MarkupNodeType.paragraph)
  })

  it('strips non-code marks from inline code (mark exclusivity)', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.paragraph,
          content: [
            {
              type: MarkupNodeType.text,
              text: 'x',
              marks: [{ type: MarkupMarkType.bold }, { type: MarkupMarkType.code }]
            }
          ]
        }
      ]
    }
    const fixed = conformToSchema(doc)
    const marks = fixed.content?.[0].content?.[0].marks
    expect(marks).toHaveLength(1)
    expect(marks?.[0].type).toBe(MarkupMarkType.code)
  })

  it('drops malformed nodes without a type', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'ok' }] },
        {} as unknown as MarkupNode
      ]
    }
    const fixed = conformToSchema(doc)
    expect(fixed.content).toHaveLength(1)
    expect(JSON.stringify(fixed)).toContain('ok')
  })
})

function cell(
  type: MarkupNodeType.table_cell | MarkupNodeType.table_header,
  text: string,
  attrs?: MarkupNode['attrs']
): MarkupNode {
  return {
    type,
    attrs,
    content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text }] }]
  }
}

describe('computeColumnWidths', () => {
  it('splits an unweighted table evenly across columns', () => {
    const rows: MarkupNode[] = [
      {
        type: MarkupNodeType.table_row,
        content: [cell(MarkupNodeType.table_cell, 'a'), cell(MarkupNodeType.table_cell, 'b')]
      }
    ]
    const widths = computeColumnWidths(rows)
    expect(widths).toHaveLength(2)
    expect(widths[0]).toBe(widths[1])
    expect(widths[0]).toBeGreaterThan(0)
  })

  it('honors an explicit colwidth (px) over the even split, converted to dxa', () => {
    const rows: MarkupNode[] = [
      {
        type: MarkupNodeType.table_row,
        content: [cell(MarkupNodeType.table_cell, 'a', { colwidth: 200 }), cell(MarkupNodeType.table_cell, 'b')]
      }
    ]
    const widths = computeColumnWidths(rows)
    expect(widths[0]).toBe(3000) // 200px * 15 dxa/px
  })

  it('accounts for colspan so a merged cell does not shrink the real column count', () => {
    const rows: MarkupNode[] = [
      { type: MarkupNodeType.table_row, content: [cell(MarkupNodeType.table_cell, 'wide', { colspan: 2 })] },
      {
        type: MarkupNodeType.table_row,
        content: [cell(MarkupNodeType.table_cell, 'a'), cell(MarkupNodeType.table_cell, 'b')]
      }
    ]
    const widths = computeColumnWidths(rows)
    expect(widths).toHaveLength(2)
  })

  it('accounts for rowspan so the next row does not double-count the covered column', () => {
    const rows: MarkupNode[] = [
      {
        type: MarkupNodeType.table_row,
        content: [cell(MarkupNodeType.table_cell, 'tall', { rowspan: 2 }), cell(MarkupNodeType.table_cell, 'a')]
      },
      // first column still covered by the rowspan above, so this row only lists one cell
      { type: MarkupNodeType.table_row, content: [cell(MarkupNodeType.table_cell, 'b')] }
    ]
    const widths = computeColumnWidths(rows)
    expect(widths).toHaveLength(2)
  })

  it('falls back to a sane default column count for an empty table', () => {
    expect(computeColumnWidths([])).toEqual([expect.any(Number)])
  })
})

describe('markupToDocx (tables)', () => {
  it('produces a valid docx buffer for a table with merged cells and cell background color', async () => {
    const table: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.table,
          content: [
            {
              type: MarkupNodeType.table_row,
              content: [cell(MarkupNodeType.table_header, 'Risk', { backgroundColor: '#ffffff', colspan: 2 })]
            },
            {
              type: MarkupNodeType.table_row,
              content: [
                cell(MarkupNodeType.table_cell, 'High', { backgroundColor: '#ff0000', rowspan: 2 }),
                cell(MarkupNodeType.table_cell, 'Amber', { backgroundColor: '#ffbf00' })
              ]
            },
            {
              type: MarkupNodeType.table_row,
              content: [cell(MarkupNodeType.table_cell, 'Green', { backgroundColor: '#00ff00' })]
            }
          ]
        }
      ]
    }

    const buf = await markupToDocx(table)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})

describe('resolveDocxFill', () => {
  it('passes through a plain 6-digit hex, normalized to uppercase without #', () => {
    expect(resolveDocxFill('#ff0000')).toBe('FF0000')
    expect(resolveDocxFill('00ff00')).toBe('00FF00')
  })

  it('expands a 3-digit hex', () => {
    expect(resolveDocxFill('#f00')).toBe('FF0000')
  })

  it('treats transparent/empty/undefined as no fill', () => {
    expect(resolveDocxFill(undefined)).toBeUndefined()
    expect(resolveDocxFill('')).toBeUndefined()
    expect(resolveDocxFill('transparent')).toBeUndefined()
  })

  it('resolves a table color picker swatch (CSS var reference) to a real hex', () => {
    const fill = resolveDocxFill('var(--theme-text-editor-palette-bg-yellow)')
    expect(fill).toMatch(/^[0-9A-F]{6}$/)
  })

  it('flattens a semi-transparent rgba() swatch (e.g. purple/pink) against white', () => {
    const fill = resolveDocxFill('var(--theme-text-editor-palette-bg-purple)')
    expect(fill).toBe('F6F3F9')
  })

  it('parses a raw rgb()/rgba() value', () => {
    expect(resolveDocxFill('rgb(255, 0, 0)')).toBe('FF0000')
    expect(resolveDocxFill('rgba(255, 0, 0, 1)')).toBe('FF0000')
  })

  it('gives up gracefully (undefined, not a throw) on an unrecognized format', () => {
    expect(resolveDocxFill('var(--some-unrelated-token)')).toBeUndefined()
    expect(resolveDocxFill('lightblue')).toBeUndefined()
  })
})

describe('markupToDocx (var() background color)', () => {
  it('does not throw when a cell backgroundColor is a CSS var() reference', async () => {
    // Regression: this used to throw "Invalid hex value '...'. Expected 6 digit hex value"
    // deep inside the docx library and crash the whole export.
    const table: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.table,
          content: [
            {
              type: MarkupNodeType.table_row,
              content: [
                cell(MarkupNodeType.table_cell, 'Yellow', {
                  backgroundColor: 'var(--theme-text-editor-palette-bg-yellow)'
                })
              ]
            }
          ]
        }
      ]
    }

    const buf = await markupToDocx(table)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})

describe('markdown table round trip', () => {
  it('preserves table cell background color through markupToMd -> mdToMarkup', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.table,
          content: [
            {
              type: MarkupNodeType.table_row,
              content: [cell(MarkupNodeType.table_cell, 'Green', { backgroundColor: '#00ff00' })]
            }
          ]
        }
      ]
    }

    const md = markupToMd(doc)
    const roundTripped = mdToMarkup(md)
    const serialized = JSON.stringify(roundTripped)
    expect(serialized).toContain('Green')
    expect(serialized).toContain('#00ff00')
  })
})
