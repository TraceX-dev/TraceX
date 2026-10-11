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
 * Extract direct RGB table-cell shading from a DOCX file, in the order mammoth emits the
 * corresponding cells. Mammoth intentionally omits table formatting from its HTML output, so
 * the result can be applied to Mammoth's markup separately.
 * A failed best-effort extraction must not make an otherwise supported DOCX impossible to import.
 */
export async function extractDocxCellFills (buffer: Buffer): Promise<Array<string | undefined>> {
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

    const fills: Array<string | undefined> = []
    collectCellFills(document, fills)
    return fills
  } catch (e) {
    console.warn('Failed to extract cell colors', e)
    return []
  }
}

/**
 * Apply DOCX table-cell fills to the corresponding cells in imported markup.
 */
export function applyDocxCellFills (markup: MarkupNode, fills: Array<string | undefined>): MarkupNode {
  if (fills.length === 0) {
    return markup
  }

  const cells = countTableCells(markup)
  if (cells !== fills.length) {
    console.warn(`Ignoring DOCX cell colors: ${fills.length} cells in the document, ${cells} in the imported markup`)
    return markup
  }

  return applyCellFills(markup, fills)
}

function collectCellFills (nodes: unknown, fills: Array<string | undefined>): void {
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
      if (name !== 'tc') {
        collectCellFills(children, fills)
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
      collectCellFills(children, fills)
    }
  }
}

function cellFill (cell: unknown): string | undefined {
  const shading = xmlChild(xmlChildren(cell, 'tcPr'), 'shd')
  const fill = xmlAttribute(shading, 'fill')
  return fill !== undefined && WORD_FILL_RE.test(fill) ? `#${fill.toUpperCase()}` : undefined
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
