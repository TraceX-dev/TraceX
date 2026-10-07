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

import { type MarkupNode, MarkupMarkType, MarkupNodeType } from '@hcengineering/text'
import { markdownToMarkup } from '@hcengineering/text-markdown'

export interface TableDiffColumn {
  oldIndex?: number
  newIndex?: number
  oldHeader: string
  newHeader: string
}

export interface TableDiffRow {
  oldIndex?: number
  newIndex?: number
  moved: boolean
  cells: Array<{ oldValue: string, newValue: string, oldHref?: string, newHref?: string }>
}

export interface TableDiff {
  columns: TableDiffColumn[]
  rows: TableDiffRow[]
}

interface ParsedTable {
  headers: string[]
  rows: TableCell[][]
}

interface TableCell {
  value: string
  href?: string
}

function nodeText (node: MarkupNode): string {
  if (node.type === MarkupNodeType.hard_break) return '\n'
  if (node.text !== undefined) return node.text
  return (node.content ?? []).map(nodeText).join('')
}

function cellLink (node: MarkupNode): string | undefined {
  const links = new Set<string>()
  let hasUnlinkedText = false
  const visit = (current: MarkupNode): void => {
    if (current.text !== undefined && current.text.trim().length > 0) {
      const link = current.marks?.find(
        (mark) => mark.type === MarkupMarkType.link && typeof mark.attrs?.href === 'string'
      )
      if (link?.attrs?.href !== undefined) links.add(String(link.attrs.href))
      else hasUnlinkedText = true
    }
    for (const child of current.content ?? []) visit(child)
  }
  visit(node)
  return !hasUnlinkedText && links.size === 1 ? [...links][0] : undefined
}

function parseTable (markdown: string): ParsedTable | undefined {
  const content = markdownToMarkup(markdown).content ?? []
  const table = content.find((node) => node.type === MarkupNodeType.table)
  if (table === undefined) return undefined

  const rows: TableCell[][] = []
  for (const row of table.content ?? []) {
    if (row.type !== MarkupNodeType.table_row) return undefined
    const cells: TableCell[] = []
    for (const cell of row.content ?? []) {
      if (cell.type !== MarkupNodeType.table_cell && cell.type !== MarkupNodeType.table_header) return undefined
      if (Number(cell.attrs?.rowspan ?? 1) !== 1 || Number(cell.attrs?.colspan ?? 1) !== 1) return undefined
      cells.push({ value: nodeText(cell), href: cellLink(cell) })
    }
    rows.push(cells)
  }

  const headers = rows[0]
  if (headers === undefined || headers.length === 0 || rows.some((row) => row.length !== headers.length)) {
    return undefined
  }
  return { headers: headers.map((cell) => cell.value), rows: rows.slice(1) }
}

function uniqueMatches (oldValues: string[], newValues: string[]): Map<number, number> {
  const matches = new Map<number, number>()
  for (let oldIndex = 0; oldIndex < oldValues.length; oldIndex++) {
    const value = oldValues[oldIndex]
    if (oldValues.filter((item) => item === value).length !== 1) continue
    const newIndex = newValues.indexOf(value)
    if (newIndex >= 0 && newValues.lastIndexOf(value) === newIndex) matches.set(newIndex, oldIndex)
  }
  return matches
}

function matchColumns (oldTable: ParsedTable, newTable: ParsedTable): TableDiffColumn[] {
  const matches = uniqueMatches(oldTable.headers, newTable.headers)
  const usedOld = new Set(matches.values())
  const unmatchedOld = oldTable.headers.map((_, index) => index).filter((index) => !usedOld.has(index))
  const unmatchedNew = newTable.headers.map((_, index) => index).filter((index) => !matches.has(index))

  // Positional pairing is safe for a rename only when both sides have the same number of unmatched columns.
  if (unmatchedOld.length === unmatchedNew.length) {
    unmatchedNew.forEach((newIndex, index) => matches.set(newIndex, unmatchedOld[index]))
  }

  const columns: TableDiffColumn[] = newTable.headers.map((newHeader, newIndex) => {
    const oldIndex = matches.get(newIndex)
    return { oldIndex, newIndex, oldHeader: oldIndex === undefined ? '' : oldTable.headers[oldIndex], newHeader }
  })
  const matchedOld = new Set(matches.values())
  oldTable.headers.forEach((oldHeader, oldIndex) => {
    if (!matchedOld.has(oldIndex)) columns.push({ oldIndex, oldHeader, newHeader: '' })
  })
  return columns
}

function rowValues (row: TableCell[], columns: TableDiffColumn[], old: boolean): string[] {
  return columns
    .filter((column) => column.oldIndex !== undefined && column.newIndex !== undefined)
    .map((column) => {
      const index = old ? column.oldIndex : column.newIndex
      return index === undefined ? '' : (row[index]?.value ?? '')
    })
}

function similarity (oldValues: string[], newValues: string[]): number {
  if (oldValues.length === 0) return 0
  let same = 0
  for (let index = 0; index < oldValues.length; index++) {
    if (oldValues[index] === newValues[index]) same++
  }
  return same / oldValues.length
}

function movedRows (matches: Map<number, number>): Set<number> {
  const entries = [...matches.entries()].sort(([a], [b]) => a - b)
  const moved = new Set<number>()
  // A row is marked as moved only if its relative order crosses another matched row.
  for (let index = 0; index < entries.length; index++) {
    if (
      entries.some(
        ([newIndex, oldIndex], other) =>
          other !== index && (newIndex - entries[index][0]) * (oldIndex - entries[index][1]) < 0
      )
    ) {
      moved.add(entries[index][0])
    }
  }
  return moved
}

/** Compare table structure before comparing text inside corresponding cells. */
export function buildTableDiff (oldMarkdown: string, newMarkdown: string): TableDiff | undefined {
  const oldTable = parseTable(oldMarkdown)
  const newTable = parseTable(newMarkdown)
  if (oldTable === undefined || newTable === undefined) return undefined

  const columns = matchColumns(oldTable, newTable)
  const oldValues = oldTable.rows.map((row) => rowValues(row, columns, true))
  const newValues = newTable.rows.map((row) => rowValues(row, columns, false))
  const matches = uniqueMatches(
    oldValues.map((values) => JSON.stringify(values)),
    newValues.map((values) => JSON.stringify(values))
  )
  const usedOld = new Set(matches.values())

  // Pair edited rows only when both the best match and its reverse are unambiguous.
  for (let newIndex = 0; newIndex < newValues.length; newIndex++) {
    if (matches.has(newIndex)) continue
    const candidates = oldValues
      .map((values, oldIndex) => ({
        oldIndex,
        score: usedOld.has(oldIndex) ? 0 : similarity(values, newValues[newIndex])
      }))
      .sort((a, b) => b.score - a.score)
    const best = candidates[0]
    if (best === undefined || best.score < 0.5 || best.score === candidates[1]?.score) continue
    const reverse = newValues
      .map((values, candidateIndex) => ({
        candidateIndex,
        score: matches.has(candidateIndex) ? 0 : similarity(oldValues[best.oldIndex], values)
      }))
      .sort((a, b) => b.score - a.score)
    if (reverse[0]?.candidateIndex !== newIndex || reverse[0].score === reverse[1]?.score) continue
    matches.set(newIndex, best.oldIndex)
    usedOld.add(best.oldIndex)
  }

  const moved = movedRows(matches)
  const rows: TableDiffRow[] = newTable.rows.map((row, newIndex) => {
    const oldIndex = matches.get(newIndex)
    const oldRow = oldIndex === undefined ? undefined : oldTable.rows[oldIndex]
    return {
      oldIndex,
      newIndex,
      moved: moved.has(newIndex),
      cells: columns.map((column) => ({
        oldValue: oldRow === undefined || column.oldIndex === undefined ? '' : oldRow[column.oldIndex].value,
        newValue: column.newIndex === undefined ? '' : row[column.newIndex].value,
        oldHref: oldRow === undefined || column.oldIndex === undefined ? undefined : oldRow[column.oldIndex].href,
        newHref: column.newIndex === undefined ? undefined : row[column.newIndex].href
      }))
    }
  })
  oldTable.rows.forEach((row, oldIndex) => {
    if (!usedOld.has(oldIndex)) {
      rows.push({
        oldIndex,
        moved: false,
        cells: columns.map((column) => ({
          oldValue: column.oldIndex === undefined ? '' : row[column.oldIndex].value,
          oldHref: column.oldIndex === undefined ? undefined : row[column.oldIndex].href,
          newValue: ''
        }))
      })
    }
  })
  return { columns, rows }
}
