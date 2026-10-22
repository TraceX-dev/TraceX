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
 * Default display for a newly inserted image: `inline` if the paragraph already has content,
 * otherwise `null` (block). Stored in the document, so existing content is unaffected.
 * @param ignoreText temporary placeholder text that does not count as content
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
