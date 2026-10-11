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

import { buildTableDiff } from './tableDiff'

const oldTable = '| Name | State |\n| --- | --- |\n| Alpha | Open |\n| Beta | Closed |\n'

describe('buildTableDiff', () => {
  it('keeps an unchanged table unchanged', () => {
    const diff = buildTableDiff(oldTable, oldTable)

    expect(diff?.columns.every((column) => column.oldIndex === column.newIndex)).toBe(true)
    expect(diff?.rows.every((row) => row.oldIndex === row.newIndex && !row.moved)).toBe(true)
    expect(diff?.rows.every((row) => row.cells.every((cell) => cell.oldValue === cell.newValue))).toBe(true)
  })

  it('shows an inserted row as one row', () => {
    const diff = buildTableDiff(
      oldTable,
      '| Name | State |\n| --- | --- |\n| Alpha | Open |\n| Gamma | New |\n| Beta | Closed |\n'
    )

    expect(diff?.rows).toHaveLength(3)
    expect(diff?.rows[1]).toMatchObject({ oldIndex: undefined, newIndex: 1, moved: false })
    expect(diff?.rows[2]).toMatchObject({ oldIndex: 1, newIndex: 2, moved: false })
  })

  it('shows a deleted row as one row', () => {
    const diff = buildTableDiff(oldTable, '| Name | State |\n| --- | --- |\n| Beta | Closed |\n')

    expect(diff?.rows.filter((row) => row.newIndex === undefined)).toMatchObject([{ oldIndex: 0, moved: false }])
    expect(diff?.rows.map((row) => row.oldIndex)).toEqual([0, 1])
    expect(diff?.rows[1]).toMatchObject({ oldIndex: 1, newIndex: 0, moved: false })
  })

  it('keeps a deleted middle row beside its former neighbours', () => {
    const old = '| Name | State |\n| --- | --- |\n| Alpha | Open |\n| Beta | Closed |\n| Gamma | New |\n'
    const fresh = '| Name | State |\n| --- | --- |\n| Alpha | Open |\n| Gamma | New |\n'

    expect(buildTableDiff(old, fresh)?.rows.map((row) => row.oldIndex)).toEqual([0, 1, 2])
  })

  it('shows an inserted column without changing shared cells', () => {
    const diff = buildTableDiff(
      oldTable,
      '| Name | Owner | State |\n| --- | --- | --- |\n| Alpha | Jane | Open |\n| Beta | John | Closed |\n'
    )

    expect(diff?.columns[1]).toMatchObject({ oldIndex: undefined, newIndex: 1, newHeader: 'Owner' })
    expect(diff?.rows[0].cells).toEqual([
      { oldValue: 'Alpha', newValue: 'Alpha' },
      { oldValue: '', newValue: 'Jane' },
      { oldValue: 'Open', newValue: 'Open' }
    ])
  })

  it('matches repeated headers before marking a new column', () => {
    const old = '| Name | Name |\n| --- | --- |\n| Alpha | One |\n'
    const fresh = '| Name | Name | Owner |\n| --- | --- | --- |\n| Alpha | One | Jane |\n'
    const diff = buildTableDiff(old, fresh)

    expect(diff?.columns.map((column) => column.oldIndex)).toEqual([0, 1, undefined])
    expect(diff?.rows[0]).toMatchObject({ oldIndex: 0, newIndex: 0 })
    expect(diff?.rows[0].cells[0]).toMatchObject({ oldValue: 'Alpha', newValue: 'Alpha' })
  })

  it('shows a removed column without changing shared cells', () => {
    const diff = buildTableDiff(oldTable, '| Name |\n| --- |\n| Alpha |\n| Beta |\n')

    expect(diff?.columns[1]).toMatchObject({ oldIndex: 1, oldHeader: 'State' })
    expect(diff?.columns[1].newIndex).toBeUndefined()
    expect(diff?.rows[0]).toMatchObject({ oldIndex: 0, newIndex: 0 })
    expect(diff?.rows[0].cells[0]).toMatchObject({ oldValue: 'Alpha', newValue: 'Alpha' })
    expect(diff?.rows[0].cells[1]).toMatchObject({ oldValue: 'Open', newValue: '' })
  })

  it('matches reordered columns by header', () => {
    const diff = buildTableDiff(oldTable, '| State | Name |\n| --- | --- |\n| Open | Alpha |\n| Closed | Beta |\n')

    expect(diff?.columns.map((column) => column.oldIndex)).toEqual([1, 0])
    expect(diff?.rows[0]).toMatchObject({ oldIndex: 0, newIndex: 0, moved: false })
    expect(diff?.rows[0].cells[0]).toMatchObject({ oldValue: 'Open', newValue: 'Open' })
  })

  it('pairs a renamed column by position when the width is unchanged', () => {
    const diff = buildTableDiff(oldTable, '| Name | Status |\n| --- | --- |\n| Alpha | Open |\n| Beta | Closed |\n')

    expect(diff?.columns[1]).toMatchObject({ oldIndex: 1, newIndex: 1, oldHeader: 'State', newHeader: 'Status' })
    expect(diff?.rows[0]).toMatchObject({ oldIndex: 0, newIndex: 0 })
  })

  it('compares a changed cell inside its matched row', () => {
    const diff = buildTableDiff(oldTable, '| Name | State |\n| --- | --- |\n| Alpha | Done |\n| Beta | Closed |\n')

    expect(diff?.rows[0]).toMatchObject({ oldIndex: 0, newIndex: 0 })
    expect(diff?.rows[0].cells[1]).toEqual({ oldValue: 'Open', newValue: 'Done' })
  })

  it('does not pair distinct rows that only share a status', () => {
    const old = '| Name | State |\n| --- | --- |\n| Alpha | Open |\n'
    const fresh = '| Name | State |\n| --- | --- |\n| Beta | Open |\n'
    const diff = buildTableDiff(old, fresh)

    expect(diff?.rows.map((row) => [row.oldIndex, row.newIndex])).toEqual([
      [undefined, 0],
      [0, undefined]
    ])
  })

  it('keeps the row match when a column and a cell change together', () => {
    const fresh = '| Name | Owner | State |\n| --- | --- | --- |\n| Alpha | Jane | Done |\n| Beta | John | Closed |\n'
    const diff = buildTableDiff(oldTable, fresh)

    expect(diff?.rows[0]).toMatchObject({ oldIndex: 0, newIndex: 0 })
    expect(diff?.rows[0].cells[2]).toMatchObject({ oldValue: 'Open', newValue: 'Done' })
  })

  it('marks an unambiguous reorder', () => {
    const diff = buildTableDiff(oldTable, '| Name | State |\n| --- | --- |\n| Beta | Closed |\n| Alpha | Open |\n')

    expect(diff?.rows.map((row) => row.oldIndex)).toEqual([1, 0])
    expect(diff?.rows.every((row) => row.moved)).toBe(true)
  })

  it('does not guess a match for duplicate rows', () => {
    const old = '| Name |\n| --- |\n| Alpha |\n| Alpha |\n'
    const fresh = '| Name |\n| --- |\n| Alpha |\n'
    const diff = buildTableDiff(old, fresh)

    expect(diff?.rows.filter((row) => row.oldIndex === undefined)).toHaveLength(1)
    expect(diff?.rows.filter((row) => row.newIndex === undefined)).toHaveLength(2)
  })

  it('keeps a link in a newly added cell', () => {
    const fresh = '| Name | State |\n| --- | --- |\n| [Alpha](https://example.com/a) | Open |\n| Beta | Closed |\n'
    const diff = buildTableDiff(oldTable, fresh)

    expect(diff?.rows[0].cells[0]).toMatchObject({
      oldValue: 'Alpha',
      newValue: 'Alpha',
      newHref: 'https://example.com/a'
    })
  })

  it('retains both link targets when only the target changes', () => {
    const old = '| Name | State |\n| --- | --- |\n| [Alpha](https://example.com/old) | Open |\n'
    const fresh = '| Name | State |\n| --- | --- |\n| [Alpha](https://example.com/new) | Open |\n'
    const diff = buildTableDiff(old, fresh)

    expect(diff?.rows[0].cells[0]).toMatchObject({
      oldValue: 'Alpha',
      newValue: 'Alpha',
      oldHref: 'https://example.com/old',
      newHref: 'https://example.com/new'
    })
  })

  it('matches a renamed linked row by its stable target', () => {
    const old = '| Name | State |\n| --- | --- |\n| [Alpha](https://example.com/item) | Open |\n'
    const fresh = '| Name | State |\n| --- | --- |\n| [Renamed](https://example.com/item) | Open |\n'
    const diff = buildTableDiff(old, fresh)

    expect(diff?.rows[0]).toMatchObject({ oldIndex: 0, newIndex: 0 })
    expect(diff?.rows[0].cells[0]).toMatchObject({ oldValue: 'Alpha', newValue: 'Renamed' })
  })

  it('leaves merged tables to the existing viewer', () => {
    const merged = '<table><tr><th>Name</th><th>State</th></tr><tr><td colspan="2">Alpha</td></tr></table>'

    expect(buildTableDiff(merged, oldTable)).toBeUndefined()
  })

  it('supports a table with a header and no body rows', () => {
    const headerOnly = '| Name | State |\n| --- | --- |\n'
    const diff = buildTableDiff(headerOnly, oldTable)

    expect(diff?.rows).toHaveLength(2)
    expect(diff?.rows.every((row) => row.oldIndex === undefined)).toBe(true)
  })

  it('leaves non-table input to the existing viewer', () => {
    expect(buildTableDiff('plain text', oldTable)).toBeUndefined()
  })
})
