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

import { type MarkupNode, MarkupNodeType } from '@hcengineering/text-core'
import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'

const WORD_DOCUMENT_PATH = 'word/document.xml'
const WORD_FILL_RE = /^[0-9a-fA-F]{6}$/

const XML_ATTRIBUTES = ':@'
const XML_TEXT = '#text'
const XML_ATTRIBUTE_PREFIX = '@_'

type XmlNode = Record<string, unknown>

/**
 * Cell fills of a DOCX, one entry per top-level table. Cells of nested tables are listed
 * inside their top-level table, right after the cell that holds them (mammoth's order).
 *
 * @public
 */
export type DocxTableFills = Array<Array<string | undefined>>

/**
 * Extract direct RGB table-cell shading from a DOCX file, in the order mammoth emits the
 * corresponding cells. Mammoth intentionally omits table formatting from its HTML output, so
 * the result can be applied to Mammoth's markup separately.
 * A failed best-effort extraction must not make an otherwise supported DOCX impossible to import.
 */
export async function extractDocxCellFills (buffer: Buffer): Promise<DocxTableFills> {
  try {
    const zip = await JSZip.loadAsync(buffer)
    const documentFile = zip.file(WORD_DOCUMENT_PATH)
    if (documentFile === null) {
      return []
    }

    const documentXml = await documentFile.async('string')
    const document = new XMLParser({
      attributeNamePrefix: XML_ATTRIBUTE_PREFIX,
      ignoreAttributes: false,
      parseAttributeValue: false,
      parseTagValue: false,
      preserveOrder: true,
      removeNSPrefix: true,
      trimValues: false
    }).parse(documentXml) as unknown

    const tables: DocxTableFills = []
    collectCellFills(document, tables)
    return tables
  } catch (e) {
    console.warn('Failed to extract cell colors', e)
    return []
  }
}

/**
 * Apply DOCX table-cell fills to the corresponding cells in imported markup.
 *
 * Fills are matched by position, table by table: a table whose cell count differs from the
 * DOCX (mammoth dropped or merged cells in a way not accounted for) keeps no colors, while
 * the other tables keep theirs.
 */
export function applyDocxCellFills (markup: MarkupNode, tables: DocxTableFills): MarkupNode {
  if (tables.length === 0) {
    return markup
  }

  const markupTables = collectTables(markup)
  if (markupTables.length !== tables.length) {
    console.warn(`Ignoring DOCX cell colors: ${tables.length} tables in the document, ${markupTables.length} imported`)
    return markup
  }

  const fillsByTable = new Map<MarkupNode, Array<string | undefined>>()
  markupTables.forEach((table, index) => {
    const fills = tables[index]
    const cells = countTableCells(table)
    if (cells === fills.length) {
      fillsByTable.set(table, fills)
    } else {
      const counts = `${fills.length} cells in the document, ${cells} in the imported markup`
      console.warn(`Ignoring DOCX cell colors of table ${index + 1}: ${counts}`)
    }
  })

  return applyTableFills(markup, fillsByTable)
}

function collectCellFills (nodes: unknown, tables: DocxTableFills, fills?: Array<string | undefined>): void {
  if (!Array.isArray(nodes)) {
    return
  }

  for (const node of nodes) {
    if (!isRecord(node)) {
      continue
    }
    for (const [name, children] of Object.entries(node)) {
      if (name === XML_ATTRIBUTES || name === XML_TEXT) {
        continue
      }
      if (name === 'tbl' && fills === undefined) {
        // A top-level table starts its own group; nested ones extend the current group.
        const tableFills: Array<string | undefined> = []
        tables.push(tableFills)
        collectCellFills(children, tables, tableFills)
        continue
      }
      // mammoth drops rows deleted with tracked changes (`w:trPr/w:del`) together with their
      // cells, so they must not consume positions either.
      if (name === 'tr' && isDeletedRow(children)) {
        continue
      }
      if (name !== 'tc' || fills === undefined) {
        collectCellFills(children, tables, fills)
        continue
      }
      // A vertical-merge continuation is folded into the cell above it and dropped from
      // mammoth's output (see `calculateRowSpans` in mammoth's body-reader), together with
      // everything nested inside it — so it must not consume a position here either.
      if (isVMergeContinuation(children)) {
        continue
      }
      fills.push(cellFill(children))
      // Nested tables belong to the cell and must retain document order.
      collectCellFills(children, tables, fills)
    }
  }
}

function cellFill (cell: unknown): string | undefined {
  const shading = xmlChild(xmlChildren(cell, 'tcPr'), 'shd')
  const fill = xmlAttribute(shading, 'fill')
  return fill !== undefined && WORD_FILL_RE.test(fill) ? `#${fill.toUpperCase()}` : undefined
}

function isDeletedRow (row: unknown): boolean {
  return xmlChild(xmlChildren(row, 'trPr'), 'del') !== undefined
}

function isVMergeContinuation (cell: unknown): boolean {
  const vMerge = xmlChild(xmlChildren(cell, 'tcPr'), 'vMerge')
  if (vMerge === undefined) {
    return false
  }
  const value = xmlAttribute(vMerge, 'val')
  return value === undefined || value === 'continue'
}

/** The named element among `nodes`, as the wrapper object carrying its attributes. */
function xmlChild (nodes: unknown, name: string): XmlNode | undefined {
  if (!Array.isArray(nodes)) {
    return undefined
  }
  for (const node of nodes) {
    if (isRecord(node) && Array.isArray(node[name])) {
      return node
    }
  }
  return undefined
}

function xmlChildren (nodes: unknown, name: string): unknown {
  return xmlChild(nodes, name)?.[name]
}

function xmlAttribute (node: XmlNode | undefined, name: string): string | undefined {
  const attributes = node?.[XML_ATTRIBUTES]
  if (!isRecord(attributes)) {
    return undefined
  }
  const value = attributes[`${XML_ATTRIBUTE_PREFIX}${name}`]
  return typeof value === 'string' ? value : undefined
}

function isRecord (value: unknown): value is XmlNode {
  return value !== null && typeof value === 'object'
}

function countTableCells (node: MarkupNode): number {
  let count = isTableCell(node) ? 1 : 0
  for (const child of node.content ?? []) {
    count += countTableCells(child)
  }
  return count
}

/** Top-level tables of the markup, in document order (nested tables belong to their holder). */
function collectTables (node: MarkupNode, tables: MarkupNode[] = []): MarkupNode[] {
  if (node.type === MarkupNodeType.table) {
    tables.push(node)
    return tables
  }
  for (const child of node.content ?? []) {
    collectTables(child, tables)
  }
  return tables
}

function applyTableFills (node: MarkupNode, fillsByTable: Map<MarkupNode, Array<string | undefined>>): MarkupNode {
  const fills = fillsByTable.get(node)
  if (fills !== undefined) {
    return applyCellFills(node, fills)
  }
  if (node.type === MarkupNodeType.table || node.content === undefined) {
    return node
  }
  return { ...node, content: node.content.map((child) => applyTableFills(child, fillsByTable)) }
}

function applyCellFills (
  node: MarkupNode,
  fills: Array<string | undefined>,
  index: { value: number } = { value: 0 }
): MarkupNode {
  const fill = isTableCell(node) ? fills[index.value++] : undefined
  const content = node.content?.map((child) => applyCellFills(child, fills, index))
  if (fill === undefined) {
    return content === undefined ? node : { ...node, content }
  }
  return {
    ...node,
    attrs: { ...node.attrs, backgroundColor: fill },
    ...(content !== undefined ? { content } : {})
  }
}

function isTableCell (node: MarkupNode): boolean {
  return node.type === MarkupNodeType.table_cell || node.type === MarkupNodeType.table_header
}
