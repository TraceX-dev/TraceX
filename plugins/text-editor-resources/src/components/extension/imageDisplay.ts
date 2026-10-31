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
import { type EditorState, type Transaction } from '@tiptap/pm/state'

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

/** True if the text block has content other than the image itself (whitespace-only text is ignored). */
export function hasInlineNeighbors (parent: Node): boolean {
  let count = 0
  parent.forEach((child) => {
    if (!(child.isText && (child.text ?? '').trim() === '')) count++
  })
  return count > 1
}

function getChangedRanges (transactions: readonly Transaction[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  transactions.forEach((tr, i) => {
    tr.mapping.maps.forEach((map, j) => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        let from = newStart
        let to = newEnd
        const rest = [...tr.mapping.maps.slice(j + 1), ...transactions.slice(i + 1).flatMap((t) => t.mapping.maps)]
        for (const m of rest) {
          from = m.map(from, -1)
          to = m.map(to, 1)
        }
        ranges.push([from, to])
      })
    })
  })
  return ranges
}

/**
 * Images that arrive by paste or drag-and-drop (including moving an existing image)
 * keep a `null` display. If such an image lands among other content, make it inline,
 * otherwise it breaks the line. An explicit choice is never downgraded.
 */
export function normalizeInsertedImages (transactions: readonly Transaction[], state: EditorState): Transaction | null {
  const uiEvent = transactions.map((tr) => tr.getMeta('uiEvent')).find((it) => it !== undefined)
  if (uiEvent !== 'paste' && uiEvent !== 'drop') return null

  const size = state.doc.content.size
  const clamp = (n: number): number => Math.max(0, Math.min(n, size))
  const positions = new Set<number>()
  for (const [from, to] of getChangedRanges(transactions)) {
    state.doc.nodesBetween(clamp(from), clamp(to), (node, pos) => {
      if (node.type.name === 'image' && node.attrs.display == null) {
        const parent = state.doc.resolve(pos).parent
        if (parent.isTextblock && hasInlineNeighbors(parent)) positions.add(pos)
      }
    })
  }
  if (positions.size === 0) return null

  const tr = state.tr
  positions.forEach((pos) => {
    const node = state.doc.nodeAt(pos)
    if (node !== null) tr.setNodeMarkup(pos, undefined, { ...node.attrs, display: 'inline' })
  })
  return tr
}
