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
import { type ImageDisplay } from '@hcengineering/text'
import { type Node } from '@tiptap/pm/model'

/**
 * Default display mode for a newly inserted image, decided by context at insertion time:
 * - the target paragraph already has content (text, other inlines) -> `inline`;
 * - the paragraph is empty (or the position is not inside a text block) -> `null`, i.e. the
 *   image stays a block on its own line, exactly as before.
 *
 * The result is stored in the document, so rendering is the same everywhere
 * and existing documents are never affected.
 *
 * @param ignoreText text of a temporary placeholder that should not count as content
 * @public
 */
export function getDefaultImageDisplay (doc: Node, pos: number, ignoreText?: string): ImageDisplay | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)))
  const parent = $pos.parent
  if (!parent.isTextblock) return null

  if (ignoreText !== undefined && parent.childCount === 1 && parent.textContent === ignoreText) {
    return null
  }
  return parent.childCount > 0 ? 'inline' : null
}
