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
// See the License for the specific language governing permissions and
// limitations under the License.
//

import {
  parseTableMetadata,
  tableCellHref,
  tableCellRich,
  tableCellText,
  tableCellValue,
  tableColumnIds,
  tableSnapshotFromMarkup,
  tableSnapshotToMarkup
} from './table'

const p = (...content: any[]): any => ({ type: 'paragraph', content })
const t = (text: string, ...marks: any[]): any => ({ type: 'text', text, ...(marks.length > 0 ? { marks } : {}) })
const cell = (...content: any[]): any => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content })

const metadata = {
  version: '2.0',
  cardClass: 'doc',
  documentIds: ['a'],
  timestamp: 1,
  source: { kind: 'table', mode: 'frozen' },
  snapshot: { rowIds: ['a'], columnIds: ['name'], cells: [[[['Name']]], [[['Alpha']]]] }
}

describe('table metadata contract', () => {
  it('validates the clipboard payload and rejects unsupported or malformed versions', () => {
    expect(parseTableMetadata(metadata)).toEqual(metadata)
    for (const invalid of [
      null,
      {},
      { ...metadata, version: '3.0' },
      { ...metadata, source: null },
      { ...metadata, source: { kind: 'table', mode: 'dynamic' } },
      { ...metadata, source: { kind: 'table', mode: 'savedView' } },
      { ...metadata, snapshot: null },
      { ...metadata, snapshot: { ...metadata.snapshot, rowIds: ['a', 'a'] } },
      { ...metadata, snapshot: { ...metadata.snapshot, cells: [[[['Name']]]] } },
      { ...metadata, snapshot: { ...metadata.snapshot, markdown: '|a|', cells: undefined } }
    ]) {
      expect(parseTableMetadata(invalid)).toBeUndefined()
    }
  })

  it('retains support for legacy metadata', () => {
    const legacy = { version: '1.0', cardClass: 'doc', documentIds: ['a'], timestamp: 1 }
    expect(parseTableMetadata(legacy)).toEqual(legacy)
  })

  it('keeps column identity stable through renaming, restyling and property changes', () => {
    expect(tableColumnIds([{ key: 'name', label: 'A' as any, props: { a: 1 } }])).toEqual(
      tableColumnIds([{ key: 'name', label: 'B' as any, props: { b: 2 } }])
    )
    expect(tableColumnIds(['name'])).toEqual(tableColumnIds([{ key: 'name' }]))
    expect(new Set(tableColumnIds(['name', 'name'])).size).toBe(2)
    const objects = tableColumnIds([
      { key: '', presenter: 'a' as any },
      { key: '', presenter: 'b' as any }
    ])
    expect(
      tableColumnIds([
        { key: '', presenter: 'b' as any },
        { key: '', presenter: 'a' as any }
      ])
    ).toEqual([...objects].reverse())
  })
})

describe('canonical cell values', () => {
  it('keeps text, links and meaningful formatting but ignores colors and spacing', () => {
    const link = { type: 'link', attrs: { href: 'https://example.com', target: '_blank' } }
    const value = tableCellValue(
      cell(
        p(
          t('  A ', link),
          t('| B', link, { type: 'textColor', attrs: { color: 'red' } }),
          t(' bold ', { type: 'bold' })
        )
      )
    )
    expect(value).toEqual([
      ['A | B', 'link:https://example.com'],
      [' bold', 'bold']
    ])
    expect(tableCellText(value)).toBe('A | B bold')
    expect(tableCellRich(value)).toBe(true)
    expect(tableCellHref(tableCellValue(cell(p(t('A', link)))))).toBe('https://example.com')
    expect(tableCellHref(value)).toBeUndefined()
  })

  it('treats paragraphs and hard breaks as the same line break', () => {
    expect(tableCellValue(cell(p(t('a')), p(t('b'))))).toEqual(
      tableCellValue(cell(p(t('a'), { type: 'hardBreak' }, t('b'))))
    )
  })

  it('expands merged cells and round-trips through display markup', () => {
    const table = {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell(p(t('H1'))), cell(p(t('H2')))] },
        { type: 'tableRow', content: [{ ...cell(p(t('x'))), attrs: { colspan: 1, rowspan: 2 } }, cell(p(t('1')))] },
        { type: 'tableRow', content: [cell(p(t('2')))] }
      ]
    }
    const snapshot = tableSnapshotFromMarkup(table, ['r1', 'r2'], ['c1', 'c2'])
    expect(snapshot.cells.map((row) => row.map(tableCellText))).toEqual([
      ['H1', 'H2'],
      ['x', '1'],
      ['x', '2']
    ])
    const again = tableSnapshotFromMarkup(tableSnapshotToMarkup(snapshot), snapshot.rowIds, snapshot.columnIds)
    expect(again).toEqual(snapshot)
  })
})
