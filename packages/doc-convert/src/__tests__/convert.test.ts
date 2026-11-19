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
import { applyDocxCellFills, extractDocxCellFills } from '../word-utils'
import { htmlToMarkup } from '@hcengineering/text-html'
import JSZip from 'jszip'
import { CheckBox, Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'

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

  it('preserves direct DOCX table cell shading', async () => {
    const source: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.table,
          content: [
            {
              type: MarkupNodeType.table_row,
              content: [
                cell(MarkupNodeType.table_cell, 'Red', { backgroundColor: '#ff0000' }),
                cell(MarkupNodeType.table_cell, 'Plain')
              ]
            },
            {
              type: MarkupNodeType.table_row,
              content: [
                cell(MarkupNodeType.table_cell, 'Blue', { backgroundColor: '#0000ff' }),
                cell(MarkupNodeType.table_cell, 'Green', { backgroundColor: '#00ff00' })
              ]
            }
          ]
        }
      ]
    }

    const { markup } = await docxToMarkup(await markupToDocx(source))
    const importedCells = tableCells(markup)

    expect(importedCells.map((item) => item.attrs?.backgroundColor)).toEqual([
      '#FF0000',
      undefined,
      '#0000FF',
      '#00FF00'
    ])
  })

  it('keeps cell shading aligned across a vertical merge', async () => {
    // Mammoth folds a `w:vMerge` continuation into the cell above and drops it, while the
    // DOCX still carries a `<w:tc>` for it — a naive positional match shifts every later color.
    const source: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.table,
          content: [
            {
              type: MarkupNodeType.table_row,
              content: [
                cell(MarkupNodeType.table_cell, 'Merged', { backgroundColor: '#ff0000', rowspan: 2 }),
                cell(MarkupNodeType.table_cell, 'Plain')
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

    const { markup } = await docxToMarkup(await markupToDocx(source))
    const importedCells = tableCells(markup)

    expect(importedCells.map((item) => item.attrs?.backgroundColor)).toEqual(['#FF0000', undefined, '#00FF00'])
  })
})

describe('docxToMarkup: Word constructs that broke the editor', () => {
  // 1x1 transparent PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )

  // mammoth renders this as:
  // <p>H<sub>2</sub>O E=mc<sup>2</sup> after</p>
  // <p><input type="checkbox" checked="checked" /> yes <input type="checkbox" /> no</p>
  // <table><tr><td><ul><li>Point A</li></ul><p><img src="data:..." /></p></td></tr></table>
  // <p>END-SENTINEL</p>
  async function buildDocx (): Promise<Buffer> {
    const doc = new Document({
      numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: 'bullet', text: '•' }] }] },
      sections: [
        {
          children: [
            new Paragraph({
              children: [
                new TextRun('H'),
                new TextRun({ text: '2', subScript: true }),
                new TextRun('O E=mc'),
                new TextRun({ text: '2', superScript: true }),
                new TextRun(' after')
              ]
            }),
            new Paragraph({
              children: [
                new CheckBox({ checked: true }),
                new TextRun(' yes '),
                new CheckBox({ checked: false }),
                new TextRun(' no')
              ]
            }),
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      children: [
                        new Paragraph({ text: 'Point A', numbering: { reference: 'bullets', level: 0 } }),
                        new Paragraph({
                          children: [
                            new ImageRun({ type: 'png', data: png, transformation: { width: 10, height: 10 } })
                          ]
                        })
                      ]
                    })
                  ]
                })
              ]
            }),
            new Paragraph('END-SENTINEL')
          ]
        }
      ]
    })
    return await Packer.toBuffer(doc)
  }

  let markup: MarkupNode

  beforeAll(async () => {
    markup = (await docxToMarkup(await buildDocx())).markup
  })

  it('keeps the whole document (an unknown tag no longer swallows the rest)', () => {
    expect(markup.content?.map((node) => node.type)).toEqual([
      MarkupNodeType.paragraph,
      MarkupNodeType.paragraph,
      MarkupNodeType.table,
      MarkupNodeType.paragraph
    ])
    expect(JSON.stringify(markup)).toContain('END-SENTINEL')
  })

  it('imports subscript and superscript as marks', () => {
    const content = markup.content?.[0].content ?? []
    expect(content.map((node) => node.text)).toEqual(['H', '2', 'O E=mc', '2', ' after'])
    expect(content[1].marks).toEqual([{ type: MarkupMarkType.subscript }])
    expect(content[3].marks).toEqual([{ type: MarkupMarkType.superscript }])
  })

  it('replaces checkboxes with ballot box characters', () => {
    const text = (markup.content?.[1].content ?? []).map((node) => node.text).join('')
    expect(text).toEqual('☒ yes ☐ no')
  })

  it('lifts a list out of the table cell paragraph and keeps the image inline', () => {
    const cellContent = tableCells(markup)[0].content ?? []
    expect(cellContent.map((node) => node.type)).toEqual([MarkupNodeType.bullet_list, MarkupNodeType.paragraph])
    expect(cellContent[1].content?.map((node) => node.type)).toEqual([MarkupNodeType.image])
  })

  it('produces markup that follows the schema structure rules', () => {
    expect(schemaViolations(markup)).toEqual([])
  })
})

describe('extractDocxCellFills', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('reads cell fills per table in document order, including tables in a content control', async () => {
    // fast-xml-parser groups same-named siblings, so without `preserveOrder` the table inside
    // `w:sdt` would be collected after the plain table that follows it.
    const fills = await extractDocxCellFills(
      await documentXml(`
        ${table(shadedCell('FF0000'))}
        <w:sdt><w:sdtContent>${table(shadedCell('00FF00'))}</w:sdtContent></w:sdt>
        ${table(shadedCell('0000FF'))}
      `)
    )

    expect(fills).toEqual([['#FF0000'], ['#00FF00'], ['#0000FF']])
  })

  it('reads a nested table right after the cell that holds it', async () => {
    const fills = await extractDocxCellFills(
      await documentXml(table(shadedCell('FF0000', table(shadedCell('00FF00'))) + shadedCell('0000FF')))
    )

    expect(fills).toEqual([['#FF0000', '#00FF00', '#0000FF']])
  })

  it('ignores automatic shading and non-hex fills', async () => {
    const fills = await extractDocxCellFills(
      await documentXml(table(shadedCell('auto') + shadedCell('') + '<w:tc><w:p/></w:tc>'))
    )

    expect(fills).toEqual([[undefined, undefined, undefined]])
  })

  it('skips rows deleted with tracked changes, as mammoth does', async () => {
    const deletion = '<w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"/>'
    const rows = [
      `<w:tr>${shadedCell('FF0000')}</w:tr>`,
      `<w:tr><w:trPr>${deletion}</w:trPr>${shadedCell('00FF00')}</w:tr>`,
      `<w:tr>${shadedCell('0000FF')}</w:tr>`
    ]
    const fills = await extractDocxCellFills(await documentXml(`<w:tbl>${rows.join('')}</w:tbl>`))

    expect(fills).toEqual([['#FF0000', '#0000FF']])
  })

  it('returns no fills for a buffer that is not a docx', async () => {
    await expect(extractDocxCellFills(Buffer.from('definitely not a zip'))).resolves.toEqual([])
    expect(warn).toHaveBeenCalled()
  })
})

describe('applyDocxCellFills', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  function markupTable (...texts: string[]): MarkupNode {
    return {
      type: MarkupNodeType.table,
      content: [{ type: MarkupNodeType.table_row, content: texts.map((text) => cell(MarkupNodeType.table_cell, text)) }]
    }
  }

  it('keeps the colors of other tables when one table does not match', () => {
    const markup: MarkupNode = { type: MarkupNodeType.doc, content: [markupTable('a', 'b'), markupTable('c')] }

    const result = applyDocxCellFills(markup, [['#FF0000', '#00FF00', '#0000FF'], ['#FFFF00']])

    expect(tableCells(result).map((item) => item.attrs?.backgroundColor)).toEqual([undefined, undefined, '#FFFF00'])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('ignores all colors when the number of tables differs', () => {
    const markup: MarkupNode = { type: MarkupNodeType.doc, content: [markupTable('a')] }

    const result = applyDocxCellFills(markup, [['#FF0000'], ['#00FF00']])

    expect(tableCells(result).map((item) => item.attrs?.backgroundColor)).toEqual([undefined])
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

function shadedCell (fill: string, nested: string = ''): string {
  const shading = fill === '' ? '' : `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>`
  return `<w:tc><w:tcPr>${shading}</w:tcPr>${nested}<w:p/></w:tc>`
}

function table (cells: string): string {
  return `<w:tbl><w:tr>${cells}</w:tr></w:tbl>`
}

async function documentXml (body: string): Promise<Buffer> {
  // jszip's typings describe the singleton, not its constructor.
  const zip = new (JSZip as unknown as new () => typeof JSZip)()
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
     <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
       <w:body>${body}</w:body>
     </w:document>`
  )
  return await zip.generateAsync({ type: 'nodebuffer' })
}

function tableCells (node: MarkupNode): MarkupNode[] {
  const cells: MarkupNode[] = []
  const visit = (current: MarkupNode): void => {
    if (current.type === MarkupNodeType.table_cell || current.type === MarkupNodeType.table_header) {
      cells.push(current)
    }
    for (const child of current.content ?? []) {
      visit(child)
    }
  }
  visit(node)
  return cells
}

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

  it('replaces a subLink node (from <sub>) with subscript-marked text', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.paragraph,
          content: [
            { type: MarkupNodeType.text, text: 'H' },
            { type: MarkupNodeType.subLink, content: [{ type: MarkupNodeType.text, text: '2' }] },
            { type: MarkupNodeType.text, text: 'O' }
          ]
        },
        { type: MarkupNodeType.subLink, content: [{ type: MarkupNodeType.text, text: 'top-level' }] }
      ]
    }
    const fixed = conformToSchema(doc)
    expect(JSON.stringify(fixed)).not.toContain(MarkupNodeType.subLink)
    const paragraph = fixed.content?.[0]
    expect(paragraph?.content?.map((node) => node.text)).toEqual(['H', '2', 'O'])
    expect(paragraph?.content?.[1].marks).toEqual([{ type: 'subscript' }])
    // Inline content left directly under the doc is wrapped into a paragraph.
    expect(fixed.content?.[1].type).toBe(MarkupNodeType.paragraph)
    expect(fixed.content?.[1].content?.[0].marks).toEqual([{ type: 'subscript' }])
  })

  it('does not leave subLink nodes for <sub> in mammoth HTML output', async () => {
    const html = '<p>H<sub>2</sub>O</p>'
    const fixed = conformToSchema(htmlToMarkup(html))
    expect(JSON.stringify(fixed)).not.toContain(MarkupNodeType.subLink)
  })

  it('lifts block nodes out of a paragraph (list + image in a table cell)', () => {
    const html = '<table><tbody><tr><td><ul><li>A</li></ul><p><img src="x.png" alt="i" /></p></td></tr></tbody></table>'
    const fixed = conformToSchema(htmlToMarkup(html))
    const cellContent = fixed.content?.[0].content?.[0].content?.[0].content
    expect(cellContent?.map((node) => node.type)).toEqual([MarkupNodeType.bullet_list, MarkupNodeType.paragraph])
    expect(cellContent?.[1].content?.[0].type).toBe(MarkupNodeType.image)
  })

  it('starts a list item with a paragraph', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.bullet_list,
          content: [
            {
              type: MarkupNodeType.list_item,
              content: [
                {
                  type: MarkupNodeType.bullet_list,
                  content: [
                    {
                      type: MarkupNodeType.list_item,
                      content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'x' }] }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
    const item = conformToSchema(doc).content?.[0].content?.[0]
    expect(item?.content?.map((node) => node.type)).toEqual([MarkupNodeType.paragraph, MarkupNodeType.bullet_list])
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

function cell (
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

const INLINE_NODES = new Set<string>([
  MarkupNodeType.text,
  MarkupNodeType.hard_break,
  MarkupNodeType.reference,
  MarkupNodeType.emoji,
  MarkupNodeType.image,
  MarkupNodeType.file,
  MarkupNodeType.comment
])
const TEXT_BLOCK_NODES = new Set<string>([MarkupNodeType.paragraph, MarkupNodeType.heading])
const LIST_ITEM_NODES = new Set<string>([MarkupNodeType.list_item, MarkupNodeType.todoItem])
/** Nodes whose content is `text*`. */
const TEXT_CONTENT_NODES = new Set<string>([
  MarkupNodeType.code_block,
  MarkupNodeType.mermaid,
  MarkupNodeType.markdown,
  MarkupNodeType.comment
])

/**
 * Structural rules of the editor schema that imports used to break (the schema itself lives
 * in `@hcengineering/text`; pod-export tests validate against it).
 */
function schemaViolations (node: MarkupNode, path = 'doc'): string[] {
  const out: string[] = []
  const content = node.content ?? []
  if (node.type === MarkupNodeType.subLink) {
    out.push(`${path}: subLink is unknown to the editor schema`)
  }
  if (node.type === MarkupNodeType.text && /<\/?[a-z]/i.test(node.text ?? '')) {
    out.push(`${path}: raw HTML in text "${node.text ?? ''}"`)
  }
  if (TEXT_BLOCK_NODES.has(node.type)) {
    content
      .filter((child) => !INLINE_NODES.has(child.type))
      .forEach((child) => out.push(`${path}: block ${child.type} inside ${node.type}`))
  } else if (!TEXT_CONTENT_NODES.has(node.type)) {
    content
      .filter((child) => INLINE_NODES.has(child.type))
      .forEach((child) => out.push(`${path}: inline ${child.type} inside ${node.type}`))
  }
  if (LIST_ITEM_NODES.has(node.type) && content[0]?.type !== MarkupNodeType.paragraph) {
    out.push(`${path}: ${node.type} does not start with a paragraph`)
  }
  content.forEach((child, index) => out.push(...schemaViolations(child, `${path}/${index}:${child.type}`)))
  return out
}
