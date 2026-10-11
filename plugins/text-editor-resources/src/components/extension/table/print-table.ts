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

const MIN_PRINT_COLUMN_PERCENT = 5

/** Returns column percentages with a soft minimum, sharing the remaining width proportionally. */
export function getPrintColumnWidths (widths: readonly number[]): number[] {
  if (widths.length === 0) return []

  const maximum = widths.reduce((max, width) => (Number.isFinite(width) && width > max ? width : max), 0)
  // Normalize first so very large widths cannot overflow the sum.
  const weights = widths.map((width) => (Number.isFinite(width) && width > 0 && maximum > 0 ? width / maximum : 0))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const minimum = Math.min(MIN_PRINT_COLUMN_PERCENT, 100 / widths.length)
  const remaining = 100 - minimum * widths.length

  return weights.map((weight) => minimum + remaining * (total > 0 ? weight / total : 1 / widths.length))
}

/** Creates a printable table without changing its source DOM or column widths. */
export function createPrintTable (source: HTMLTableElement, widths: readonly number[]): HTMLTableElement {
  const table = source.cloneNode(true) as HTMLTableElement
  const percentages = getPrintColumnWidths(widths)

  table.removeAttribute('width')
  table.style.width = '100%'
  table.style.minWidth = '0'
  table.style.maxWidth = '100%'
  table.style.tableLayout = 'fixed'

  Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col')).forEach((column, index) => {
    const percentage = percentages[index]
    if (percentage === undefined) return
    column.removeAttribute('width')
    column.style.setProperty('width', `${percentage}%`, 'important')
    column.style.minWidth = '0'
  })

  for (const cell of Array.from(table.querySelectorAll<HTMLTableCellElement>('td, th'))) {
    cell.style.minWidth = '0'
    cell.style.overflowWrap = 'anywhere'
  }
  for (const image of Array.from(table.querySelectorAll<HTMLImageElement>('img'))) {
    image.style.maxWidth = '100%'
    image.style.height = 'auto'
  }

  const body = table.tBodies.item(0)
  if (body !== null && table.tHead === null) {
    const headers: HTMLTableRowElement[] = []
    for (const row of Array.from(body.rows)) {
      if (row.cells.length === 0 || !Array.from(row.cells).every((cell) => cell.tagName === 'TH')) break
      headers.push(row)
    }
    if (headers.length > 0) {
      const head = source.ownerDocument.createElement('thead')
      head.append(...headers)
      table.insertBefore(head, body)
    }
  }

  return table
}

/** Keeps a print copy up to date outside real printing and releases its observers on destruction. */
export class TablePrintController {
  private measuredWidths: number[] = []
  private isPrinting = false
  private destroyed = false
  private readonly mediaQuery: MediaQueryList
  private readonly mutationObserver: MutationObserver
  private readonly resizeObserver: ResizeObserver

  constructor (
    private readonly source: HTMLTableElement,
    private readonly container: HTMLDivElement
  ) {
    this.mediaQuery = window.matchMedia('print')
    this.update()
    // ProseMirror and embedded node views update the DOM outside Svelte's lifecycle.
    this.mutationObserver = new MutationObserver(this.update)
    this.mutationObserver.observe(source, { childList: true, subtree: true, characterData: true, attributes: true })
    this.resizeObserver = new ResizeObserver(this.update)
    this.resizeObserver.observe(source)
    window.addEventListener('beforeprint', this.handleBeforePrint)
    window.addEventListener('afterprint', this.handleAfterPrint)
    this.mediaQuery.addEventListener('change', this.handleMediaChange)
  }

  /** Disconnects observers and removes every print listener registered by this controller. */
  destroy (): void {
    if (this.destroyed) return
    this.destroyed = true
    this.mutationObserver.disconnect()
    this.resizeObserver.disconnect()
    window.removeEventListener('beforeprint', this.handleBeforePrint)
    window.removeEventListener('afterprint', this.handleAfterPrint)
    this.mediaQuery.removeEventListener('change', this.handleMediaChange)
  }

  private readonly update = (): void => {
    // Keep the prepared copy stable while the browser paginates it.
    if (this.destroyed || (this.isPrinting && this.container.firstElementChild !== null)) return
    const columns = Array.from(this.source.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'))
    const measured = columns.map((column) => column.getBoundingClientRect().width)
    if (measured.length > 0 && measured.every((width) => Number.isFinite(width) && width > 0)) {
      this.measuredWidths = measured
    }
    const widths = this.measuredWidths.length === columns.length ? this.measuredWidths : columns.map(() => 1)
    this.container.replaceChildren(createPrintTable(this.source, widths))
  }

  private readonly handleBeforePrint = (): void => {
    this.isPrinting = true
  }

  private readonly handleAfterPrint = (): void => {
    this.isPrinting = false
    this.update()
  }

  private readonly handleMediaChange = (event: MediaQueryListEvent): void => {
    // Print emulation must keep accepting asynchronous content updates.
    if (!event.matches) this.handleAfterPrint()
  }
}
