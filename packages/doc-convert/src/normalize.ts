//
// Copyright © 2025 Hardcore Engineering Inc.
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
