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

import { TableMap } from '@tiptap/pm/tables'
import { Fragment, type Node } from '@tiptap/pm/model'
import {
  tableCellsEqual,
  tableSnapshotFromMarkup,
  type TableCellValue,
  type TableMetadata,
  type TableSnapshot
} from '@hcengineering/view'

/** Attach source identities to editor nodes so edits and moves retain their identity. */
export function attachTableSnapshot (node: Node, metadata: TableMetadata): Node {
  const snapshot = metadata.snapshot
  const attrs = { ...node.attrs, tableMetadata: JSON.stringify(metadata) }
  if (snapshot === undefined || metadata.version !== '2.0') {
    return node.type.create(attrs, node.content, node.marks)
  }
  const rows: Node[] = []
  const map = TableMap.get(node)
  node.forEach((row, rowOffset, rowIndex) => {
    const cells: Node[] = []
    row.forEach((cell, cellOffset) => {
      const columnIndex = map.findCell(rowOffset + 1 + cellOffset).left
      cells.push(
        cell.type.create(
          { ...cell.attrs, sourceColumnId: snapshot.columnIds[columnIndex] ?? null },
          cell.content,
          cell.marks
        )
      )
    })
    const sourceRowId = rowIndex === 0 ? null : (snapshot.rowIds[rowIndex - 1] ?? null)
    rows.push(row.type.create({ ...row.attrs, sourceRowId }, Fragment.fromArray(cells), row.marks))
  })
  return node.type.create(attrs, Fragment.fromArray(rows), node.marks)
}

/** Canonical values of the table as it is now, read from the editor nodes rather than Markdown. */
export function editorTableSnapshot (node: Node): TableSnapshot {
  const map = TableMap.get(node)
  const columnIds = Array.from({ length: map.width }, (_, column) =>
    String(node.nodeAt(map.map[column])?.attrs.sourceColumnId ?? '')
  )
  const rowIds: string[] = []
  node.forEach((row, _offset, index) => {
    if (index > 0) rowIds.push(String(row.attrs.sourceRowId ?? ''))
  })
  return tableSnapshotFromMarkup(node.toJSON(), rowIds, columnIds)
}

export interface TableConflictCell {
  /** Empty for the header row. */
  rowId: string
  columnId: string
}

export interface TableEditSummary {
  localChanges: boolean
  conflicts: boolean
  conflictCells?: TableConflictCell[]
}

function cellAt (
  snapshot: TableSnapshot,
  row: number | undefined,
  column: number | undefined
): TableCellValue | undefined {
  return row === undefined || column === undefined ? undefined : snapshot.cells[row]?.[column]
}

/**
 * Three-way comparison against the copied values. Conflicts are reported, never merged silently:
 * replacing the table keeps the source values.
 */
export function summarizeTableEdits (
  current: TableSnapshot,
  fresh: TableSnapshot,
  baseline?: TableSnapshot
): TableEditSummary {
  if (baseline === undefined) return { localChanges: false, conflicts: false }
  const index = (ids: string[]): Map<string, number> => new Map(ids.map((id, i) => [id, i]))
  const currentRows = index(current.rowIds)
  const freshRows = index(fresh.rowIds)
  const currentColumns = index(current.columnIds)
  const freshColumns = index(fresh.columnIds)
  let localChanges =
    JSON.stringify(current.rowIds) !== JSON.stringify(baseline.rowIds) ||
    JSON.stringify(current.columnIds) !== JSON.stringify(baseline.columnIds)
  const conflictCells: TableConflictCell[] = []
  // Row 0 is the header; data rows are addressed by their ids.
  const rows: Array<[string, number, number | undefined, number | undefined]> = [
    ['', 0, 0, 0],
    ...baseline.rowIds.map((id, i): [string, number, number | undefined, number | undefined] => {
      const currentRow = currentRows.get(id)
      const freshRow = freshRows.get(id)
      return [
        id,
        i + 1,
        currentRow === undefined ? undefined : currentRow + 1,
        freshRow === undefined ? undefined : freshRow + 1
      ]
    })
  ]
  for (const [rowId, baseRow, currentRow, freshRow] of rows) {
    baseline.columnIds.forEach((columnId, baseColumn) => {
      const original = cellAt(baseline, baseRow, baseColumn)
      const local = cellAt(current, currentRow, currentColumns.get(columnId))
      if (local !== undefined && tableCellsEqual(local, original)) return
      localChanges = true
      const source = cellAt(fresh, freshRow, freshColumns.get(columnId))
      const sourceChanged = source === undefined ? original !== undefined : !tableCellsEqual(source, original)
      // Both sides made the same change (including removing the same row): nothing to resolve.
      const sameChange =
        local === undefined ? source === undefined : source !== undefined && tableCellsEqual(local, source)
      if (sourceChanged && !sameChange) conflictCells.push({ rowId, columnId })
    })
  }
  return {
    localChanges,
    conflicts: conflictCells.length > 0,
    ...(conflictCells.length > 0 ? { conflictCells } : {})
  }
}
