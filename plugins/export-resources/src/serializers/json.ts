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

/**
 * Make headers unique so a keyed serializer cannot lose a column: controlled documents render two
 * different columns from the same lookup, and they can end up with the same heading.
 */
export function uniqueHeaders (headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((header) => {
    const count = seen.get(header) ?? 0
    seen.set(header, count + 1)
    return count === 0 ? header : `${header}_${count + 1}`
  })
}

/**
 * Serialize table data as JSON, keyed by the human readable column heading.
 * @public
 */
export function serializeJson (data: TableData, meta: Record<string, unknown> = {}): string {
  const headers = uniqueHeaders(data.headers)
  const rows = data.rows.map((row) => {
    const record: Record<string, string> = {}
    headers.forEach((header, index) => {
      record[header] = row[index] ?? ''
    })
    return record
  })

  return JSON.stringify(
    {
      meta: { columns: headers, rowCount: rows.length, ...meta },
      rows
    },
    null,
    2
  )
}
