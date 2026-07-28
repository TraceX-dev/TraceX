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

import type { TableData } from '@hcengineering/converter'

const UTF8_BOM = '﻿'
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

/**
 * Neutralise spreadsheet formula injection.
 *
 * A cell starting with `=`, `+`, `-` or `@` is executed as a formula when the file is opened, so a
 * document title like `=cmd|...` becomes code. The leading apostrophe makes the spreadsheet treat
 * the cell as text and is not displayed.
 */
export function escapeFormula (value: string): string {
  if (value.length === 0) return value
  return FORMULA_PREFIXES.includes(value[0]) ? `'${value}` : value
}

/** A quoted multi-line cell is valid CSV but breaks most downstream consumers. */
export function flattenCell (value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function quote (value: string, delimiter: string): string {
  const needsQuotes = value.includes(delimiter) || value.includes('"') || value.includes('\n')
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value
}

/**
 * Serialize table data as CSV.
 *
 * A UTF-8 BOM is always written: without it Excel on Windows misreads non-ASCII, which is the whole
 * point of the format for most users.
 * @public
 */
export function serializeCsv (data: TableData, delimiter: string = ','): string {
  const lines: string[] = []
  lines.push(data.headers.map((h) => quote(flattenCell(h), delimiter)).join(delimiter))
  for (const row of data.rows) {
    lines.push(row.map((cell) => quote(escapeFormula(flattenCell(cell ?? '')), delimiter)).join(delimiter))
  }
  return UTF8_BOM + lines.join('\n') + '\n'
}
