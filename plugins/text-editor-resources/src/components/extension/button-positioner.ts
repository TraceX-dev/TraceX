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

import { autoUpdate, computePosition, offset } from '@floating-ui/dom'
import { Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export function firstLineRect (view: EditorView, from: number | null, block: HTMLElement, height: number): DOMRect {
  const base = block.getBoundingClientRect()
  if (from !== null) {
    try {
      const node = view.state.doc.nodeAt(from)
      const selection = Selection.findFrom(view.state.doc.resolve(from), 1, true)
      if (node !== null && selection !== null && selection.from < from + node.nodeSize) {
        const { top, bottom } = view.coordsAtPos(selection.from)
        if (bottom > top) return new DOMRect(base.left, top, base.width, bottom - top)
      }
    } catch (error) {
      if (!(error instanceof RangeError)) throw error
    }
  }
  return new DOMRect(base.left, base.top, base.width, Math.min(base.height, height))
}

export class ButtonPositioner {
  private block: HTMLElement | null = null
  private cleanup: (() => void) | undefined
  private update: (() => void) | undefined
  private seq = 0

  constructor (
    private readonly button: HTMLElement,
    private readonly gap: number
  ) {
    this.hide()
  }

  show (block: HTMLElement, getRect: () => DOMRect): void {
    if (this.block === block) {
      this.update?.()
      return
    }

    this.hide()
    this.block = block
    this.button.style.display = ''
    this.button.style.visibility = 'hidden'
    const reference = { contextElement: block, getBoundingClientRect: getRect }
    this.update = () => {
      const seq = ++this.seq
      void computePosition(reference, this.button, {
        placement: 'left-start',
        strategy: 'absolute',
        middleware: [
          offset(({ rects }) => ({
            mainAxis: this.gap,
            crossAxis: (rects.reference.height - rects.floating.height) / 2
          }))
        ]
      })
        .then(({ x, y }) => {
          if (seq !== this.seq) return
          this.button.style.left = `${x}px`
          this.button.style.top = `${y}px`
          this.button.style.visibility = ''
          if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') this.checkHostBounds()
        })
        .catch((error) => {
          if (seq !== this.seq) return
          this.hide()
          console.error('Failed to position the insert button:', error)
        })
    }
    this.cleanup = autoUpdate(reference, this.button, this.update)
  }

  hide (): void {
    this.seq++
    this.cleanup?.()
    this.cleanup = undefined
    this.update = undefined
    this.block = null
    this.button.style.display = 'none'
  }

  private checkHostBounds (): void {
    const host = this.button.parentElement
    if (host === null) return
    const hostRect = host.getBoundingClientRect()
    const rect = this.button.getBoundingClientRect()
    console.assert(
      rect.left >= hostRect.left - 1 &&
        rect.right <= hostRect.right + 1 &&
        rect.top >= hostRect.top - 1 &&
        rect.bottom <= hostRect.bottom + 1,
      'Insert button must fit inside the editor host'
    )
  }
}
