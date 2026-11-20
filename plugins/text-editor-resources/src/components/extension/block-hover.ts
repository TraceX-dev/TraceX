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

import type { EditorView } from '@tiptap/pm/view'

export function blockStartAt (view: EditorView, y: number): number | null {
  const rect = view.dom.getBoundingClientRect()
  if (!Number.isFinite(y) || y < rect.top || y > rect.bottom || rect.width <= 0) return null

  const style = getComputedStyle(view.dom)
  const left = rect.left + view.dom.clientLeft + (parseFloat(style.paddingLeft) || 0) + 1
  const hit = view.posAtCoords({ left: Math.min(left, rect.right - Math.min(1, rect.width / 2)), top: y })
  if (hit === null) return null

  const $pos = view.state.doc.resolve(hit.inside >= 0 ? hit.inside : hit.pos)
  const from =
    $pos.depth > 0 ? $pos.before(1) : $pos.nodeAfter !== null ? $pos.pos : $pos.pos - ($pos.nodeBefore?.nodeSize ?? 0)
  const node = view.state.doc.nodeAt(from)
  return node !== null ? from : null
}

export function blockStartForDom (view: EditorView, block: HTMLElement): number | null {
  if (block.parentElement !== view.dom) return null
  try {
    const $pos = view.state.doc.resolve(view.posAtDOM(block, 0))
    const from = $pos.depth === 0 ? $pos.pos : $pos.before(1)
    return view.nodeDOM(from) === block ? from : null
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
}
