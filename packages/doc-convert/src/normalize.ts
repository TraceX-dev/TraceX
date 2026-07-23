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
import { markupToJSON, type MarkupNode, MarkupNodeType } from '@hcengineering/text-core'

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
    return node.text === undefined || node.text === '' ? undefined : node
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
  MarkupNodeType.emoji
])

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
  return conformNode(root)
}

function conformNode (node: MarkupNode): MarkupNode {
  if (node.content === undefined) {
    return node
  }
  const content = node.content.map(conformNode)
  if (BLOCK_CONTAINERS.has(node.type)) {
    return { ...node, content: wrapInlineChildren(content) }
  }
  return { ...node, content }
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
