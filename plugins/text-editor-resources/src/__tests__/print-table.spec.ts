/**
 * @jest-environment jsdom
 */
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

import { createPrintTable, getPrintColumnWidths, TablePrintController } from '../components/extension/table/print-table'

function cell (text: string, header = false): HTMLTableCellElement {
  const element = document.createElement(header ? 'th' : 'td')
  element.textContent = text
  return element
}

function row (...cells: HTMLTableCellElement[]): HTMLTableRowElement {
  const element = document.createElement('tr')
  element.append(...cells)
  return element
}

function sourceTable (...rows: HTMLTableRowElement[]): HTMLTableElement {
  const table = document.createElement('table')
  table.setAttribute('width', '2000')
  table.style.width = '2000px'
  table.style.minWidth = '2000px'
  const colgroup = document.createElement('colgroup')
  for (const width of [200, 1800]) {
    const column = document.createElement('col')
    column.setAttribute('width', String(width))
    column.style.width = `${width}px`
    colgroup.append(column)
  }
  table.append(colgroup)
  table.createTBody().append(...(rows.length > 0 ? rows : [row(cell('A'), cell('B'))]))
  return table
}

function columns (table: HTMLTableElement): HTMLTableColElement[] {
  return Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'))
}

describe('getPrintColumnWidths', () => {
  test.each([
    [[], []],
    [[12], [100]],
    [
      [1, 1],
      [50, 50]
    ],
    [
      [1, 99],
      [5.9, 94.1]
    ],
    [
      [1, 9],
      [14, 86]
    ],
    [
      [0, 0],
      [50, 50]
    ],
    [
      [NaN, -1, Infinity, 100],
      [5, 5, 5, 85]
    ],
    [
      [Number.MAX_VALUE, Number.MAX_VALUE],
      [50, 50]
    ]
  ])('distributes %j into %j', (input, expected) => {
    const result = getPrintColumnWidths(input)
    expect(result).toHaveLength(expected.length)
    result.forEach((width, index) => {
      expect(width).toBeCloseTo(expected[index])
    })
  })

  test.each([1, 2, 3, 9, 19, 20, 21, 40, 100])('fits %i columns without crossing their soft minimum', (count) => {
    const result = getPrintColumnWidths(Array.from({ length: count }, (_, index) => index + 1))
    expect(result.reduce((sum, width) => sum + width, 0)).toBeCloseTo(100)
    for (const width of result) {
      expect(Number.isFinite(width)).toBe(true)
      expect(width).toBeGreaterThanOrEqual(Math.min(5, 100 / count))
    }
  })

  test('preserves proportions above the minimum without mutating the input', () => {
    const input = Object.freeze([1, 3, 6])
    const result = getPrintColumnWidths(input)
    expect((result[1] - 5) / (result[0] - 5)).toBeCloseTo(3)
    expect(getPrintColumnWidths([10, 30, 60])).toEqual(result)
    expect(input).toEqual([1, 3, 6])
  })
})

describe('createPrintTable', () => {
  test('preserves all content and leaves the source unchanged', () => {
    const content = cell(`${'Long content '.repeat(2000)}END`)
    content.colSpan = 2
    const source = sourceTable(row(cell('Header A', true), cell('Header B', true)), row(content))
    const original = source.outerHTML
    const copy = createPrintTable(source, [1, 9])
    expect(source.outerHTML).toBe(original)
    expect(copy).not.toBe(source)
    expect(copy.textContent).toBe(source.textContent)
    expect(copy.textContent?.endsWith('END')).toBe(true)
    expect(copy.rows).toHaveLength(source.rows.length)
    expect(copy.querySelector('[colspan="2"]')).not.toBeNull()
  })

  test('fits the page width and overrides screen column sizes', () => {
    const copy = createPrintTable(sourceTable(), [1, 9])
    expect(copy.hasAttribute('width')).toBe(false)
    expect(copy.style.width).toBe('100%')
    expect(copy.style.minWidth).toBe('0')
    expect(copy.style.maxWidth).toBe('100%')
    expect(copy.style.tableLayout).toBe('fixed')
    columns(copy).forEach((column, index) => {
      expect(parseFloat(column.style.width)).toBeCloseTo([14, 86][index])
    })
    for (const column of columns(copy)) {
      expect(column.hasAttribute('width')).toBe(false)
      expect(column.style.getPropertyPriority('width')).toBe('important')
    }
  })

  test('only uses the outer table colgroup for width distribution', () => {
    const nested = sourceTable(row(cell('Nested')))
    columns(nested)[0].style.width = '123px'
    const nestedCell = cell('')
    nestedCell.append(nested)
    const source = sourceTable(row(nestedCell, cell('B')))
    const copy = createPrintTable(source, [1, 9])
    expect(copy.querySelector<HTMLTableColElement>('td col')?.style.width).toBe('123px')
    columns(copy).forEach((column, index) => {
      expect(parseFloat(column.style.width)).toBeCloseTo([14, 86][index])
    })
  })

  test('promotes consecutive full header rows, not row headers', () => {
    const copy = createPrintTable(
      sourceTable(
        row(cell('A', true), cell('B', true)),
        row(cell('C', true), cell('D', true)),
        row(cell('Row header', true), cell('Value'))
      ),
      [1, 1]
    )
    expect(copy.tHead?.rows).toHaveLength(2)
    expect(copy.tBodies[0].rows).toHaveLength(1)
    expect(copy.tBodies[0].textContent).toBe('Row headerValue')
    expect(createPrintTable(sourceTable(row(cell('Row header', true), cell('Value'))), [1, 1]).tHead).toBeNull()
  })

  test('preserves existing headers and handles an empty table', () => {
    const source = sourceTable()
    source.createTHead().append(row(cell('Existing', true), cell('Header', true)))
    const copy = createPrintTable(source, [1, 1])
    expect(copy.querySelectorAll('thead')).toHaveLength(1)
    expect(copy.tHead?.textContent).toBe('ExistingHeader')
    expect(copy.tBodies[0].rows).toHaveLength(1)
    expect(createPrintTable(document.createElement('table'), []).rows).toHaveLength(0)
  })

  test('wraps long cell text and constrains images', () => {
    const image = document.createElement('img')
    image.style.height = '800px'
    image.style.width = '1200px'
    const imageCell = cell('')
    imageCell.append(image)
    const copy = createPrintTable(sourceTable(row(cell('A', true), imageCell)), [1, 1])
    for (const cell of Array.from(copy.querySelectorAll<HTMLTableCellElement>('td,th'))) {
      expect(cell.style.overflowWrap).toBe('anywhere')
      expect(cell.style.minWidth).toBe('0')
    }
    expect(copy.querySelector('img')?.style.maxWidth).toBe('100%')
    expect(copy.querySelector('img')?.style.height).toBe('auto')
  })
})

class PrintMediaQuery extends EventTarget {
  matches = false
  readonly media = 'print'
  onchange = null
  readonly addListener = jest.fn()
  readonly removeListener = jest.fn()

  change (matches: boolean): void {
    this.matches = matches
    const event = new Event('change')
    Object.defineProperty(event, 'matches', { value: matches })
    this.dispatchEvent(event)
  }
}

class TableResizeObserver implements ResizeObserver {
  static instances: TableResizeObserver[] = []
  readonly observe = jest.fn()
  readonly unobserve = jest.fn()
  readonly disconnect = jest.fn()

  constructor (private readonly callback: ResizeObserverCallback) {
    TableResizeObserver.instances.push(this)
  }

  resize (): void {
    this.callback([], this)
  }
}

describe('TablePrintController', () => {
  let media: PrintMediaQuery
  let source: HTMLTableElement
  let container: HTMLDivElement
  let controller: TablePrintController
  let bounds: Array<jest.SpyInstance<DOMRect, []>>

  beforeEach(() => {
    media = new PrintMediaQuery()
    TableResizeObserver.instances = []
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn(() => media) })
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: TableResizeObserver })
    source = sourceTable()
    container = document.createElement('div')
    document.body.append(source, container)
    bounds = columns(source).map((column, index) =>
      jest.spyOn(column, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, index === 0 ? 100 : 900, 0))
    )
    controller = new TablePrintController(source, container)
  })

  afterEach(() => {
    controller.destroy()
    document.body.replaceChildren()
    jest.restoreAllMocks()
  })

  function copy (): HTMLTableElement {
    return container.firstElementChild as HTMLTableElement
  }

  test('prepares the copy ahead of printing without a mutation loop', async () => {
    const initial = copy()
    expect(initial.textContent).toBe('AB')
    expect(columns(initial)[0].style.width).toBe('14%')
    await Promise.resolve()
    expect(copy()).toBe(initial)
    window.dispatchEvent(new Event('beforeprint'))
    expect(copy()).toBe(initial)
  })

  test('tracks asynchronous source content and attribute updates', async () => {
    source.rows[0].cells[0].textContent = 'Updated'
    const image = document.createElement('img')
    source.rows[0].cells[1].append(image)
    await Promise.resolve()
    expect(copy().textContent).toBe('UpdatedB')
    image.setAttribute('src', '/loaded.png')
    await Promise.resolve()
    expect(copy().querySelector('img')?.getAttribute('src')).toBe('/loaded.png')
  })

  test('remeasures resized columns and retains widths when screen content is hidden', () => {
    bounds[0].mockReturnValue(new DOMRect(0, 0, 900, 0))
    bounds[1].mockReturnValue(new DOMRect(0, 0, 100, 0))
    TableResizeObserver.instances[0].resize()
    expect(parseFloat(columns(copy())[0].style.width)).toBeCloseTo(86)
    bounds.forEach((bound) => bound.mockReturnValue(new DOMRect()))
    TableResizeObserver.instances[0].resize()
    expect(parseFloat(columns(copy())[0].style.width)).toBeCloseTo(86)
  })

  test('falls back to equal widths when new columns cannot be measured', async () => {
    bounds.forEach((bound) => bound.mockReturnValue(new DOMRect()))
    source.querySelector('colgroup')?.append(document.createElement('col'))
    await Promise.resolve()
    columns(copy()).forEach((column) => {
      expect(parseFloat(column.style.width)).toBeCloseTo(100 / 3)
    })
  })

  test('prepares initially hidden tables and tracks rows added later', async () => {
    controller.destroy()
    source.tBodies[0].replaceChildren()
    bounds.forEach((bound) => bound.mockReturnValue(new DOMRect()))
    controller = new TablePrintController(source, container)
    expect(copy().rows).toHaveLength(0)
    columns(copy()).forEach((column) => {
      expect(column.style.width).toBe('50%')
    })
    source.tBodies[0].append(row(cell('Loaded'), cell('Later')))
    await Promise.resolve()
    expect(copy().rows).toHaveLength(1)
    expect(copy().textContent).toBe('LoadedLater')
  })

  test('freezes the copy during real printing and refreshes afterwards', async () => {
    const initial = copy()
    window.dispatchEvent(new Event('beforeprint'))
    source.rows[0].cells[0].textContent = 'Changed during printing'
    await Promise.resolve()
    TableResizeObserver.instances[0].resize()
    expect(copy()).toBe(initial)
    window.dispatchEvent(new Event('afterprint'))
    expect(copy()).not.toBe(initial)
    expect(copy().textContent).toContain('Changed during printing')
  })

  test('keeps updating in emulated print mode', async () => {
    media.change(true)
    source.rows[0].cells[0].textContent = 'Late diagram content'
    await Promise.resolve()
    expect(copy().textContent).toContain('Late diagram content')
  })

  test('unfreezes on print media exit even without afterprint', async () => {
    window.dispatchEvent(new Event('beforeprint'))
    source.rows[0].cells[0].textContent = 'Changed'
    await Promise.resolve()
    media.change(false)
    expect(copy().textContent).toBe('ChangedB')
  })

  test('disconnects observers and print listeners on destruction', async () => {
    const removeWindowListener = jest.spyOn(window, 'removeEventListener')
    const removeMediaListener = jest.spyOn(media, 'removeEventListener')
    const initial = copy()
    controller.destroy()
    controller.destroy()
    expect(TableResizeObserver.instances[0].disconnect).toHaveBeenCalledTimes(1)
    expect(removeWindowListener.mock.calls.map(([event]) => event)).toEqual(['beforeprint', 'afterprint'])
    expect(removeMediaListener).toHaveBeenCalledTimes(1)
    source.rows[0].cells[0].textContent = 'After destruction'
    await Promise.resolve()
    TableResizeObserver.instances[0].resize()
    window.dispatchEvent(new Event('afterprint'))
    media.change(false)
    expect(copy()).toBe(initial)
  })
})
