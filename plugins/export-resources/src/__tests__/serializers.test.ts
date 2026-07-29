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
import { escapeFormula, flattenCell, serializeCsv } from '../serializers/csv'
import { serializeJson, uniqueHeaders } from '../serializers/json'

const table: TableData = {
  headers: ['ID', 'Название', 'Заметка'],
  rows: [
    ['SOP-1', 'Уборка', 'ок'],
    ['SOP-2', 'Мойка, сушка', 'строка\nвторая'],
    ['SOP-3', 'Кавычки "внутри"', '']
  ],
  docs: [],
  linkColumns: [0]
}

describe('escapeFormula', () => {
  it('neutralises cells a spreadsheet would execute', () => {
    expect(escapeFormula('=1+1')).toBe("'=1+1")
    expect(escapeFormula('+SUM(A1)')).toBe("'+SUM(A1)")
    expect(escapeFormula('-2')).toBe("'-2")
    expect(escapeFormula('@cmd')).toBe("'@cmd")
  })

  it('leaves ordinary text alone', () => {
    expect(escapeFormula('SOP-1')).toBe('SOP-1')
    expect(escapeFormula('Уборка')).toBe('Уборка')
    expect(escapeFormula('')).toBe('')
  })
})

describe('flattenCell', () => {
  it('collapses newlines that would break downstream parsers', () => {
    expect(flattenCell('a\nb\r\nc')).toBe('a b c')
    expect(flattenCell('  spaced   out  ')).toBe('spaced out')
  })
})

describe('serializeCsv', () => {
  it('starts with a UTF-8 BOM so Excel on Windows reads Cyrillic correctly', () => {
    expect(serializeCsv(table).charCodeAt(0)).toBe(0xfeff)
  })

  it('quotes a cell containing the delimiter', () => {
    expect(serializeCsv(table)).toContain('"Мойка, сушка"')
  })

  it('doubles quotes inside a cell', () => {
    expect(serializeCsv(table)).toContain('"Кавычки ""внутри"""')
  })

  it('flattens embedded newlines instead of emitting a multi-line cell', () => {
    const csv = serializeCsv(table)
    expect(csv).toContain('строка вторая')
    // header + 3 rows + trailing newline
    expect(csv.trimEnd().split('\n')).toHaveLength(4)
  })

  it('honours a custom delimiter', () => {
    const csv = serializeCsv(table, ';')
    expect(csv.split('\n')[0]).toBe('﻿ID;Название;Заметка')
  })

  it('escapes formulas in the body but not in headers', () => {
    const dangerous: TableData = { ...table, rows: [['=HYPERLINK("http://x")', 'a', 'b']] }
    expect(serializeCsv(dangerous)).toContain("'=HYPERLINK")
  })

  it('produces just a header line for an empty table', () => {
    expect(
      serializeCsv({ ...table, rows: [] })
        .trimEnd()
        .split('\n')
    ).toHaveLength(1)
  })
})

describe('uniqueHeaders', () => {
  it('leaves distinct headers untouched', () => {
    expect(uniqueHeaders(['A', 'B'])).toEqual(['A', 'B'])
  })

  it('suffixes repeats so a keyed format cannot lose a column', () => {
    expect(uniqueHeaders(['Шаблон', 'Шаблон', 'Шаблон'])).toEqual(['Шаблон', 'Шаблон_2', 'Шаблон_3'])
  })
})

describe('serializeJson', () => {
  it('keys rows by the human readable heading', () => {
    const payload = JSON.parse(serializeJson(table))
    expect(payload.rows[0]).toEqual({ ID: 'SOP-1', Название: 'Уборка', Заметка: 'ок' })
    expect(payload.meta.columns).toEqual(table.headers)
    expect(payload.meta.rowCount).toBe(3)
  })

  it('keeps cell text verbatim, including newlines', () => {
    const payload = JSON.parse(serializeJson(table))
    expect(payload.rows[1].Заметка).toBe('строка\nвторая')
  })

  it('merges caller supplied metadata', () => {
    const payload = JSON.parse(serializeJson(table, { class: 'documents:class:Document' }))
    expect(payload.meta.class).toBe('documents:class:Document')
  })
})
