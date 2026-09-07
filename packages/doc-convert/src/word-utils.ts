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

import { type MarkupNode } from '@hcengineering/text-core'
import { XMLParser } from 'fast-xml-parser'
import * as JSZip from 'jszip'

const WORD_DOCUMENT_PATH = 'word/document.xml'
const WORD_FILL_RE = /^[0-9a-fA-F]{6}$/

/**
 * Extract direct RGB table-cell shading from a DOCX file. Mammoth intentionally omits table
 * formatting from its HTML output, so the result can be applied to Mammoth's markup separately.
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
      attributeNamePrefix: '',
      ignoreAttributes: false,
      parseAttributeValue: false,
      parseTagValue: false,
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

/** Apply DOCX table-cell fills to the corresponding cells in imported markup. */
export function applyDocxCellFills (markup: MarkupNode, fills: Array<string | undefined>): MarkupNode {
  return applyCellFills(markup, fills)
}

function collectCellFills (node: unknown, fills: Array<string | undefined>): void {
  if (Array.isArray(node)) {
    for (const child of node) {
      collectCellFills(child, fills)
    }
    return
  }
  if (!isRecord(node)) {
    return
  }

  for (const [name, value] of Object.entries(node)) {
    if (name === 'tc') {
      for (const cell of toArray(value)) {
        fills.push(cellFill(cell))
        // Nested tables are part of a cell and must retain document order.
        collectCellFills(cell, fills)
      }
    } else {
      collectCellFills(value, fills)
    }
  }
}

function cellFill (cell: unknown): string | undefined {
  const properties = xmlChild(cell, 'tcPr')
  const shading = xmlChild(properties, 'shd')
  const fill = xmlAttribute(shading, 'fill')
  return typeof fill === 'string' && WORD_FILL_RE.test(fill) ? `#${fill.toUpperCase()}` : undefined
}

function xmlChild (node: unknown, name: string): unknown {
  if (!isRecord(node)) {
    return undefined
  }
  return node[name] ?? node[`w:${name}`]
}

function xmlAttribute (node: unknown, name: string): unknown {
  if (!isRecord(node)) {
    return undefined
  }
  return node[name] ?? node[`w:${name}`] ?? node[`@_${name}`] ?? node[`@_w:${name}`]
}

function toArray (value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value]
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
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
  return node.type === 'tableCell' || node.type === 'tableHeader'
}
