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
import { markupToJSON, MarkupMarkType, type MarkupNode, MarkupNodeType } from '@hcengineering/text-core'

/**
 * Normalize a markup tree to reduce spurious diffs across an export -> edit -> import
 * round-trip (mammoth/docx add or drop empty nodes that are semantically meaningless).
 *
 * - drops empty text nodes
 * - drops trailing empty paragraphs at every level
 *
 * @public
 */
export function normalizeMarkup (markup: Markup | MarkupNode): MarkupNode {
  const root = typeof markup === 'string' ? markupToJSON(markup) : markup
  return normalizeNode(root) ?? { type: MarkupNodeType.doc, content: [] }
}

function normalizeNode (node: MarkupNode): MarkupNode | undefined {
  if (node.type === MarkupNodeType.text) {
    if (node.text === undefined || node.text === '') {
      return undefined
    }
    return sanitizeMarks(node)
  }

  if (node.content === undefined) {
    return node
  }

  const content = node.content.map(normalizeNode).filter((child): child is MarkupNode => child !== undefined)

  while (content.length > 0) {
    const last = content[content.length - 1]
    const isEmptyParagraph =
      last.type === MarkupNodeType.paragraph && (last.content === undefined || last.content.length === 0)
    if (isEmptyParagraph) {
      content.pop()
    } else {
      break
    }
  }

  return { ...node, content }
}

const BLOCK_CONTAINERS = new Set<string>([
  MarkupNodeType.list_item,
  MarkupNodeType.table_cell,
  MarkupNodeType.table_header,
  MarkupNodeType.blockquote,
  MarkupNodeType.todoItem,
  MarkupNodeType.taskItem
])

const INLINE_TYPES = new Set<string>([
  MarkupNodeType.text,
  MarkupNodeType.hard_break,
  MarkupNodeType.reference,
  MarkupNodeType.emoji,
  MarkupNodeType.image,
  MarkupNodeType.file,
  MarkupNodeType.comment
])

/** Nodes whose content is `inline*` in the schema. */
const TEXT_BLOCKS = new Set<string>([MarkupNodeType.paragraph, MarkupNodeType.heading])

/** Nodes whose first child must be a paragraph (`paragraph block*`). */
const LIST_ITEMS = new Set<string>([MarkupNodeType.list_item, MarkupNodeType.todoItem])

/**
 * Make imported markup conform to the Huly ProseMirror schema. Converters such as
 * mammoth emit inline content directly inside block containers (a list item with
 * bare text and no inner paragraph), which the schema rejects ("Invalid content for
 * node listItem"). This wraps runs of inline children inside block containers into
 * paragraphs.
 *
 * @public
 */
export function conformToSchema (markup: Markup | MarkupNode): MarkupNode {
  const root = typeof markup === 'string' ? markupToJSON(markup) : markup
  return conformNode(root) ?? { type: MarkupNodeType.doc, content: [] }
}

function conformNode (node: MarkupNode): MarkupNode | undefined {
  // Drop malformed nodes (e.g. `{}` with no type) — they crash the PM schema and the diff.
  if (node === null || node === undefined || typeof node.type !== 'string') {
    return undefined
  }
  // Drop empty text nodes (invalid in the schema).
  if (node.type === MarkupNodeType.text) {
    if (node.text === undefined || node.text === '') {
      return undefined
    }
    return sanitizeMarks(node)
  }

  const isContainer = BLOCK_CONTAINERS.has(node.type)

  // Leaf nodes (image, hardBreak, horizontalRule, …) keep their shape untouched.
  if (node.content === undefined && !isContainer) {
    return node
  }

  let content = conformChildren(node.content ?? [])

  if (isContainer || node.type === MarkupNodeType.doc) {
    // Unwrapping unsupported nodes (see `subLink` below) may leave inline nodes directly
    // under the doc, which the schema rejects as well.
    content = wrapInlineChildren(content)
  }

  if (isContainer) {
    // A block container (list item, table cell, blockquote, …) must hold at least one
    // block node; an empty one (e.g. `<td></td>`) is rejected by the schema.
    if (content.length === 0) {
      content = [{ type: MarkupNodeType.paragraph, content: [] }]
    }
  }

  if (LIST_ITEMS.has(node.type) && content[0]?.type !== MarkupNodeType.paragraph) {
    content = [{ type: MarkupNodeType.paragraph, content: [] }, ...content]
  }

  return { ...node, content }
}

function conformChildren (children: MarkupNode[]): MarkupNode[] {
  const out: MarkupNode[] = []
  for (const child of children) {
    if (child?.type === MarkupNodeType.subLink) {
      // `<sub>` is parsed by text-html into a `subLink` node, which exists only in the
      // read-only markup model and is unknown to the editor schema. Loading it into the
      // editor throws "Unknown node type: subLink" and breaks the editor, so replace it
      // with its children carrying the subscript mark.
      out.push(...conformChildren((child.content ?? []).map(addSubscriptMark)))
      continue
    }
    const conformed = conformNode(child)
    if (conformed !== undefined) {
      out.push(...splitTextBlock(conformed))
    }
  }
  return out
}

/**
 * A paragraph or heading may hold inline content only. The HTML parser nests block nodes
 * into them in some cases (e.g. `<td><ul>…</ul><p>…</p></td>`: the cell's implicit
 * paragraph receives the list), so lift such blocks out and keep the inline runs around
 * them as separate text blocks with the same attributes.
 */
function splitTextBlock (node: MarkupNode): MarkupNode[] {
  if (!TEXT_BLOCKS.has(node.type) || node.content === undefined) {
    return [node]
  }
  if (node.content.every((child) => INLINE_TYPES.has(child.type))) {
    return [node]
  }

  const out: MarkupNode[] = []
  let buffer: MarkupNode[] = []
  const flush = (): void => {
    if (buffer.length > 0) {
      out.push({ ...node, content: buffer })
      buffer = []
    }
  }
  for (const child of node.content) {
    if (INLINE_TYPES.has(child.type)) {
      buffer.push(child)
    } else {
      flush()
      out.push(...splitTextBlock(child))
    }
  }
  flush()
  return out
}

function addSubscriptMark (node: MarkupNode): MarkupNode {
  if (node?.type !== MarkupNodeType.text) {
    return node?.content !== undefined ? { ...node, content: node.content.map(addSubscriptMark) } : node
  }
  const marks = node.marks ?? []
  // `code` excludes all other marks; keep such text as is.
  if (marks.some((mark) => mark.type === MarkupMarkType.code || mark.type === MarkupMarkType.subscript)) {
    return node
  }
  return { ...node, marks: [...marks, { type: MarkupMarkType.subscript }] }
}

function wrapInlineChildren (children: MarkupNode[]): MarkupNode[] {
  const out: MarkupNode[] = []
  let buffer: MarkupNode[] = []
  const flush = (): void => {
    if (buffer.length > 0) {
      out.push({ type: MarkupNodeType.paragraph, content: buffer })
      buffer = []
    }
  }
  for (const child of children) {
    if (INLINE_TYPES.has(child.type)) {
      buffer.push(child)
    } else {
      flush()
      out.push(child)
    }
  }
  flush()
  return out
}

/**
 * Enforce mark-exclusivity rules the schema requires. `code` is an exclusive mark: a
 * text node cannot carry `code` together with bold/italic/etc. Markdown like
 * `**\`x\`**` yields such a combination and would be rejected ("Invalid collection of
 * marks for node text"), corrupting the editor/Y.Doc.
 */
function sanitizeMarks (node: MarkupNode): MarkupNode {
  const marks = node.marks
  if (marks === undefined || marks.length <= 1) {
    return node
  }
  if (marks.some((mark) => mark.type === MarkupMarkType.code)) {
    return { ...node, marks: marks.filter((mark) => mark.type === MarkupMarkType.code) }
  }
  return node
}
