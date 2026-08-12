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

import { type Markup } from '@hcengineering/core'
import {
  markupToJSON,
  MarkupMarkType,
  type MarkupMark,
  type MarkupNode,
  MarkupNodeType
} from '@hcengineering/text-core'
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  type ILevelsOptions,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  type ParagraphChild,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import imageSize from 'image-size'

// Approx. usable content width of a default A4/Letter page at 96 dpi (points ~= px here).
const MAX_IMAGE_WIDTH = 600

type DocxImageType = 'png' | 'jpg' | 'gif' | 'bmp'

/** @public */
export interface MarkupToDocxOptions {
  /**
   * Raw image bytes keyed by the markup image node's `file-id`. The host is expected to
   * resolve blobs (storage/network) and pass them in — this package stays pure.
   */
  images?: Map<string, Uint8Array>
}

interface DocxCtx {
  configs: Array<{ reference: string, levels: ILevelsOptions[] }>
  images?: Map<string, Uint8Array>
}

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
]

type Block = Paragraph | Table

interface MarkState {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  underline?: boolean
  code?: boolean
  link?: string
}

// Each ordered list gets its own numbering instance, so two separate lists restart
// at 1 instead of sharing one continuous counter. `level` still drives nesting indent.
function allocateOrderedNumbering (ctx: DocxCtx): string {
  const reference = `ordered-${ctx.configs.length}`
  ctx.configs.push({
    reference,
    levels: [0, 1, 2, 3].map((level) => ({
      level,
      format: LevelFormat.DECIMAL,
      text: `%${level + 1}.`,
      alignment: AlignmentType.START
    }))
  })
  return reference
}

/**
 * Reference (blob id) an image markup node points at. Huly image nodes carry the blob
 * in the `file-id` attribute.
 *
 * @public
 */
export function imageRef (node: MarkupNode): string | undefined {
  const id = node.attrs?.['file-id']
  return typeof id === 'string' && id !== '' ? id : undefined
}

/**
 * Collect the unique blob references of every image in the markup, so a host can fetch
 * them before calling markupToDocx.
 *
 * @public
 */
export function collectImageRefs (markup: Markup | MarkupNode): string[] {
  const root = typeof markup === 'string' ? markupToJSON(markup) : markup
  const refs = new Set<string>()
  const visit = (node: MarkupNode): void => {
    if (node.type === MarkupNodeType.image) {
      const ref = imageRef(node)
      if (ref !== undefined) {
        refs.add(ref)
      }
    }
    for (const child of node.content ?? []) {
      visit(child)
    }
  }
  visit(root)
  return Array.from(refs)
}

/**
 * Convert collaborator markup (content body only) into a .docx buffer.
 *
 * Pure transformation: no storage/network. QMS metadata (title, approvals, revision
 * history) is intentionally NOT included — the goal is round-trip editing of the body.
 * Images are embedded only when their bytes are supplied via `options.images`.
 *
 * @public
 */
export async function markupToDocx (markup: Markup | MarkupNode, options: MarkupToDocxOptions = {}): Promise<Buffer> {
  const root = typeof markup === 'string' ? markupToJSON(markup) : markup
  const ctx: DocxCtx = { configs: [], images: options.images }
  const children = blocksFromContent(root.content ?? [], ctx)

  const doc = new Document({
    ...(ctx.configs.length > 0 ? { numbering: { config: ctx.configs } } : {}),
    sections: [{ children: children.length > 0 ? children : [new Paragraph({})] }]
  })

  return await Packer.toBuffer(doc)
}

function blocksFromContent (content: MarkupNode[], ctx: DocxCtx): Block[] {
  const out: Block[] = []
  for (const node of content) {
    appendBlock(out, node, ctx)
  }
  return out
}

function appendBlock (out: Block[], node: MarkupNode, ctx: DocxCtx): void {
  switch (node.type) {
    case MarkupNodeType.paragraph:
      out.push(new Paragraph({ children: inlines(node.content ?? [], ctx) }))
      break
    case MarkupNodeType.heading: {
      const level = Number(node.attrs?.level ?? 1)
      out.push(
        new Paragraph({
          heading: HEADINGS[Math.min(Math.max(level, 1), 6) - 1],
          children: inlines(node.content ?? [], ctx)
        })
      )
      break
    }
    case MarkupNodeType.bullet_list:
      appendList(out, node, false, 0, ctx)
      break
    case MarkupNodeType.ordered_list:
      appendList(out, node, true, 0, ctx)
      break
    case MarkupNodeType.blockquote:
      for (const child of node.content ?? []) {
        out.push(new Paragraph({ children: inlines(child.content ?? [], ctx), style: 'IntenseQuote' }))
      }
      break
    case MarkupNodeType.code_block:
      out.push(
        new Paragraph({
          children: [new TextRun({ text: plainText(node), font: 'Courier New' })]
        })
      )
      break
    case MarkupNodeType.horizontal_rule:
      out.push(new Paragraph({ thematicBreak: true }))
      break
    case MarkupNodeType.image: {
      const run = makeImageRun(node, ctx)
      if (run !== undefined) {
        out.push(new Paragraph({ children: [run] }))
      }
      break
    }
    case MarkupNodeType.table:
      out.push(renderTable(node, ctx))
      break
    // file/embed: reference blobs; embedding is out of scope here.
    default:
      if (node.content !== undefined && node.content.length > 0) {
        for (const child of node.content) {
          appendBlock(out, child, ctx)
        }
      }
  }
}

function appendList (out: Block[], list: MarkupNode, ordered: boolean, level: number, ctx: DocxCtx): void {
  const reference = ordered ? allocateOrderedNumbering(ctx) : undefined
  for (const item of list.content ?? []) {
    for (const child of item.content ?? []) {
      if (child.type === MarkupNodeType.bullet_list) {
        appendList(out, child, false, level + 1, ctx)
      } else if (child.type === MarkupNodeType.ordered_list) {
        appendList(out, child, true, level + 1, ctx)
      } else if (child.type === MarkupNodeType.paragraph) {
        out.push(
          new Paragraph({
            children: inlines(child.content ?? [], ctx),
            ...(reference !== undefined ? { numbering: { reference, level } } : { bullet: { level } })
          })
        )
      } else {
        appendBlock(out, child, ctx)
      }
    }
  }
}

// The table cell color picker's swatches store the *CSS variable reference* as the attribute
// value (see plugins/text-editor-resources/src/components/extension/colors.ts), e.g.
// "var(--theme-text-editor-palette-bg-yellow)" — never a resolved hex. That's fine for the web
// editor (the browser resolves the variable), but the `docx` library's shading fill requires a
// strict 6-digit hex and throws (crashing the whole export) on anything else. This table mirrors
// the *light*-theme palette in packages/theme/styles/_colors.scss (`.theme-light`) so named
// colors still render in the exported document instead of silently disappearing; light is used
// because exported/printed documents are conventionally viewed on a white page regardless of the
// editor's active theme. doc-convert has no CSS tooling, so this is a hand-kept copy — if the
// palette in _colors.scss changes, update this too.
const PALETTE_BG_RGBA: Record<string, [number, number, number, number]> = {
  gray: [241, 241, 239, 1],
  brown: [244, 238, 238, 1],
  orange: [251, 236, 221, 1],
  yellow: [251, 243, 219, 1],
  green: [237, 243, 236, 1],
  blue: [231, 243, 248, 1],
  purple: [244, 240, 247, 0.8],
  pink: [249, 238, 243, 0.8],
  red: [253, 235, 236, 1]
}

const VAR_PALETTE_RE = /^var\(--theme-text-editor-palette-bg-([a-z]+)\)$/
const HEX_RE = /^#?([0-9a-fA-F]{6})$/
const SHORT_HEX_RE = /^#?([0-9a-fA-F]{3})$/
const RGB_RE = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/

// Alpha-composite an rgba() color over a white backdrop (the assumption a printed/exported page
// is white regardless of the editor's active theme) and return a 6-digit hex string.
function flattenToHex (r: number, g: number, b: number, a: number): string {
  const blend = (fg: number): number => Math.round(a * fg + (1 - a) * 255)
  return [blend(r), blend(g), blend(b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()
}

/**
 * Resolve a `MarkupNode` `backgroundColor` attribute value into a hex color the `docx` library's
 * `shading.fill` will accept, or `undefined` if it can't be resolved (in which case the caller
 * should omit shading rather than pass the raw value through — an invalid fill throws and takes
 * down the entire export).
 *
 * @public
 */
export function resolveDocxFill (value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed === 'transparent' || trimmed === 'inherit' || trimmed === 'none') {
    return undefined
  }

  const hexMatch = HEX_RE.exec(trimmed)
  if (hexMatch !== null) {
    return hexMatch[1].toUpperCase()
  }

  const shortHexMatch = SHORT_HEX_RE.exec(trimmed)
  if (shortHexMatch !== null) {
    return shortHexMatch[1]
      .split('')
      .map((c) => c + c)
      .join('')
      .toUpperCase()
  }

  const varMatch = VAR_PALETTE_RE.exec(trimmed)
  if (varMatch !== null) {
    const rgba = PALETTE_BG_RGBA[varMatch[1]]
    return rgba !== undefined ? flattenToHex(rgba[0], rgba[1], rgba[2], rgba[3]) : undefined
  }

  const rgbMatch = RGB_RE.exec(trimmed)
  if (rgbMatch !== null) {
    const [, r, g, b, a] = rgbMatch
    return flattenToHex(Number(r), Number(g), Number(b), a !== undefined ? Number(a) : 1)
  }

  // Unrecognized format (e.g. a future/unknown CSS variable or color keyword) — skip shading
  // rather than risk another unhandled-format crash in the docx library.
  return undefined
}

// Fallback total table width used when cell `colwidth` (captured in px from the editor's
// column-resize state) isn't available for a column. ~6.25in of content at 1440 twips/inch,
// a reasonable default for an A4/Letter page with standard margins.
const DEFAULT_TABLE_WIDTH_DXA = 9000
// prosemirror-tables stores `colwidth` in CSS pixels (96 dpi); OOXML column widths are in
// twentieths of a point (dxa), and 1in = 96px = 1440dxa, so 1px = 15dxa.
const PX_TO_DXA = 15

function renderTable (node: MarkupNode, ctx: DocxCtx): Table {
  const rows = node.content ?? []
  const columnWidths = computeColumnWidths(rows)

  const tableRows = rows.map(
    (row) =>
      new TableRow({
        children: (row.content ?? []).map((cell) => {
          const colspan = toSpan(cell.attrs?.colspan)
          const rowspan = toSpan(cell.attrs?.rowspan)
          const fill = resolveDocxFill(
            typeof cell.attrs?.backgroundColor === 'string' ? cell.attrs.backgroundColor : undefined
          )
          return new TableCell({
            children: withFallback(blocksFromContent(cell.content ?? [], ctx)),
            ...(colspan > 1 ? { columnSpan: colspan } : {}),
            ...(rowspan > 1 ? { rowSpan: rowspan } : {}),
            ...(fill !== undefined ? { shading: { fill, type: ShadingType.CLEAR } } : {})
          })
        })
      })
  )

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths,
    // FIXED (as opposed to the docx default AUTOFIT) tells readers to respect the explicit
    // column widths below instead of recomputing them from content, which is what several
    // readers (notably Google Docs) get wrong when no widths are supplied at all.
    layout: TableLayoutType.FIXED
  })
}

/**
 * Walk the table grid (accounting for colspan/rowspan) to work out a width per column, in dxa.
 * Columns whose width we know (from a cell's `colwidth` attr) keep that width; the rest split
 * the remaining budget evenly. Without this, cells default to a near-zero grid width and
 * readers wrap the text one character per line per cell.
 *
 * Exported for unit testing — the `docx` Table it feeds into is otherwise opaque (a binary
 * zip), so this is the layer where the width-assignment logic can actually be verified.
 *
 * @public
 */
export function computeColumnWidths (rows: MarkupNode[]): number[] {
  const colWidths: Array<number | undefined> = []
  // Number of upcoming rows (including the one being processed) a column is still covered by
  // a vertical merge (rowspan) started in an earlier row.
  const carry: number[] = []

  for (const row of rows) {
    let col = 0
    for (const cell of row.content ?? []) {
      while ((carry[col] ?? 0) > 0) col++

      const span = toSpan(cell.attrs?.colspan)
      const rowspan = toSpan(cell.attrs?.rowspan)
      const width = toPositiveNumber(cell.attrs?.colwidth)
      if (width !== undefined && colWidths[col] === undefined) {
        colWidths[col] = Math.round(width * PX_TO_DXA)
      }
      for (let i = 0; i < span; i++) {
        carry[col + i] = rowspan
      }
      col += span
    }
    for (let i = 0; i < carry.length; i++) {
      if (carry[i] > 0) carry[i] -= 1
    }
  }

  // `carry` grows to the highest column index ever touched (it's set for every column a cell
  // occupies, whether or not that cell's width is known), so it's the reliable column count —
  // unlike `colWidths`, which only grows where a width was actually recorded.
  const columnCount = Math.max(1, carry.length)
  const fallback = Math.round(DEFAULT_TABLE_WIDTH_DXA / columnCount)
  return Array.from({ length: columnCount }, (_, i) => colWidths[i] ?? fallback)
}

function toSpan (value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : NaN
  return Number.isFinite(n) && n > 0 ? n : 1
}

function toPositiveNumber (value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function withFallback (blocks: Block[]): Block[] {
  return blocks.length > 0 ? blocks : [new Paragraph({})]
}

function inlines (content: MarkupNode[], ctx: DocxCtx, inherited: MarkState = {}): ParagraphChild[] {
  const runs: ParagraphChild[] = []
  for (const node of content) {
    if (node.type === MarkupNodeType.text) {
      const state = applyMarks(inherited, node.marks ?? [])
      const text = node.text ?? ''
      const run = new TextRun({
        text,
        bold: state.bold,
        italics: state.italics,
        strike: state.strike,
        underline: state.underline === true ? {} : undefined,
        font: state.code === true ? 'Courier New' : undefined
      })
      if (state.link !== undefined && state.link !== '') {
        runs.push(new ExternalHyperlink({ children: [run], link: state.link }))
      } else {
        runs.push(run)
      }
    } else if (node.type === MarkupNodeType.hard_break) {
      runs.push(new TextRun({ break: 1 }))
    } else if (node.type === MarkupNodeType.image) {
      const run = makeImageRun(node, ctx)
      if (run !== undefined) {
        runs.push(run)
      }
    } else if (node.content !== undefined) {
      runs.push(...inlines(node.content, ctx, inherited))
    }
  }
  return runs
}

function makeImageRun (node: MarkupNode, ctx: DocxCtx): ImageRun | undefined {
  const ref = imageRef(node)
  if (ref === undefined || ctx.images === undefined) {
    return undefined
  }
  const data = ctx.images.get(ref)
  if (data === undefined) {
    return undefined
  }

  let dimensions: { width?: number, height?: number, type?: string }
  try {
    dimensions = imageSize(Buffer.from(data))
  } catch {
    return undefined
  }

  const type = docxImageType(dimensions.type)
  if (type === undefined || dimensions.width == null || dimensions.height == null) {
    return undefined
  }

  const { width, height } = scaleToFit(dimensions.width, dimensions.height, MAX_IMAGE_WIDTH)
  return new ImageRun({ type, data, transformation: { width, height } })
}

function docxImageType (type?: string): DocxImageType | undefined {
  switch (type) {
    case 'png':
      return 'png'
    case 'jpg':
    case 'jpeg':
      return 'jpg'
    case 'gif':
      return 'gif'
    case 'bmp':
      return 'bmp'
    default:
      return undefined
  }
}

function scaleToFit (width: number, height: number, maxWidth: number): { width: number, height: number } {
  if (width <= maxWidth) {
    return { width, height }
  }
  const ratio = maxWidth / width
  return { width: maxWidth, height: Math.round(height * ratio) }
}

function applyMarks (base: MarkState, marks: MarkupMark[]): MarkState {
  const state: MarkState = { ...base }
  for (const mark of marks) {
    switch (mark.type) {
      case MarkupMarkType.bold:
        state.bold = true
        break
      case MarkupMarkType.em:
        state.italics = true
        break
      case MarkupMarkType.strike:
        state.strike = true
        break
      case MarkupMarkType.underline:
        state.underline = true
        break
      case MarkupMarkType.code:
        state.code = true
        break
      case MarkupMarkType.link:
        state.link = String(mark.attrs?.href ?? '')
        break
    }
  }
  return state
}

function plainText (node: MarkupNode): string {
  if (node.type === MarkupNodeType.text) {
    return node.text ?? ''
  }
  return (node.content ?? []).map(plainText).join('')
}
