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
  LevelFormat,
  Packer,
  Paragraph,
  type ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'

interface NumberingCtx {
  configs: Array<{ reference: string, levels: ILevelsOptions[] }>
}

// Each ordered list gets its own numbering instance, so two separate lists restart
// at 1 instead of sharing one continuous counter. `level` still drives nesting indent.
function allocateOrderedNumbering (ctx: NumberingCtx): string {
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

/**
 * Convert collaborator markup (content body only) into a .docx buffer.
 *
 * Pure transformation: no storage/network. QMS metadata (title, approvals,
 * revision history) is intentionally NOT included — the goal is round-trip
 * editing of the document body in an external editor.
 *
 * @public
 */
export async function markupToDocx (markup: Markup | MarkupNode): Promise<Buffer> {
  const root = typeof markup === 'string' ? markupToJSON(markup) : markup
  const numbering: NumberingCtx = { configs: [] }
  const children = blocksFromContent(root.content ?? [], numbering)

  const doc = new Document({
    ...(numbering.configs.length > 0 ? { numbering: { config: numbering.configs } } : {}),
    sections: [{ children: children.length > 0 ? children : [new Paragraph({})] }]
  })

  return await Packer.toBuffer(doc)
}

function blocksFromContent (content: MarkupNode[], numbering: NumberingCtx): Block[] {
  const out: Block[] = []
  for (const node of content) {
    appendBlock(out, node, numbering)
  }
  return out
}

function appendBlock (out: Block[], node: MarkupNode, numbering: NumberingCtx): void {
  switch (node.type) {
    case MarkupNodeType.paragraph:
      out.push(new Paragraph({ children: inlines(node.content ?? []) }))
      break
    case MarkupNodeType.heading: {
      const level = Number(node.attrs?.level ?? 1)
      out.push(
        new Paragraph({
          heading: HEADINGS[Math.min(Math.max(level, 1), 6) - 1],
          children: inlines(node.content ?? [])
        })
      )
      break
    }
    case MarkupNodeType.bullet_list:
      appendList(out, node, false, 0, numbering)
      break
    case MarkupNodeType.ordered_list:
      appendList(out, node, true, 0, numbering)
      break
    case MarkupNodeType.blockquote:
      for (const child of node.content ?? []) {
        out.push(new Paragraph({ children: inlines(child.content ?? []), style: 'IntenseQuote' }))
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
    case MarkupNodeType.table:
      out.push(renderTable(node, numbering))
      break
    // image/file/embed: reference blobs; embedding is a host (I/O) concern, skipped here.
    default:
      if (node.content !== undefined && node.content.length > 0) {
        for (const child of node.content) {
          appendBlock(out, child, numbering)
        }
      }
  }
}

function appendList (
  out: Block[],
  list: MarkupNode,
  ordered: boolean,
  level: number,
  numbering: NumberingCtx
): void {
  const reference = ordered ? allocateOrderedNumbering(numbering) : undefined
  for (const item of list.content ?? []) {
    for (const child of item.content ?? []) {
      if (child.type === MarkupNodeType.bullet_list) {
        appendList(out, child, false, level + 1, numbering)
      } else if (child.type === MarkupNodeType.ordered_list) {
        appendList(out, child, true, level + 1, numbering)
      } else if (child.type === MarkupNodeType.paragraph) {
        out.push(
          new Paragraph({
            children: inlines(child.content ?? []),
            ...(reference !== undefined ? { numbering: { reference, level } } : { bullet: { level } })
          })
        )
      } else {
        appendBlock(out, child, numbering)
      }
    }
  }
}

function renderTable (node: MarkupNode, numbering: NumberingCtx): Table {
  const rows = (node.content ?? []).map(
    (row) =>
      new TableRow({
        children: (row.content ?? []).map(
          (cell) => new TableCell({ children: withFallback(blocksFromContent(cell.content ?? [], numbering)) })
        )
      })
  )
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

function withFallback (blocks: Block[]): Block[] {
  return blocks.length > 0 ? blocks : [new Paragraph({})]
}

function inlines (content: MarkupNode[], inherited: MarkState = {}): ParagraphChild[] {
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
    } else if (node.content !== undefined) {
      runs.push(...inlines(node.content, inherited))
    }
  }
  return runs
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
