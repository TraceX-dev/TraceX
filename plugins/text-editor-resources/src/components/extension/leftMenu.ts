//
// Copyright © 2024 Hardcore Engineering Inc.
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

import { type Asset, type IntlString, getMetadata } from '@hcengineering/platform'
import {
  type AnySvelteComponent,
  type PopupAlignment,
  SelectPopup,
  getEventPositionElement,
  showPopup
} from '@hcengineering/ui'
import { Extension, type Editor } from '@tiptap/core'
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { blockStartAt, blockStartForDom } from './block-hover'
import { ButtonPositioner, firstLineRect } from './button-positioner'
import { type InsertTarget, trackInsertTarget } from './insert-target'

export interface InsertContext {
  editor: Editor
  target: InsertTarget
  anchor: PopupAlignment | undefined
}

export interface InsertMenuItem {
  id: string
  label: IntlString
  icon: Asset | AnySvelteComponent
  run: (context: InsertContext) => void | Promise<void>
}

export interface LeftMenuOptions {
  width: number
  height: number
  marginX: number
  className: string
  icon: Asset
  iconProps?: Record<string, string>
  items: () => readonly InsertMenuItem[]
}

function createButton (doc: Document, options: LeftMenuOptions): HTMLElement {
  const button = doc.createElement('div')
  button.className = options.className
  button.style.position = 'absolute'
  button.style.width = `${options.width}px`
  button.style.height = `${options.height}px`

  const svgNs = 'http://www.w3.org/2000/svg'
  const icon = doc.createElementNS(svgNs, 'svg')
  const { className, ...attributes } = options.iconProps ?? {}
  if (className !== undefined) icon.classList.add(...className.split(/\s+/).filter(Boolean))
  for (const [name, value] of Object.entries(attributes)) icon.setAttribute(name, value)

  const use = doc.createElementNS(svgNs, 'use')
  const href = options.icon === undefined ? undefined : getMetadata(options.icon)
  if (href !== undefined) use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href)
  icon.appendChild(use)
  button.appendChild(icon)
  return button
}

function mountMenu (
  editor: Editor,
  view: EditorView,
  options: LeftMenuOptions
): { update: (view: EditorView, previous: EditorState) => void, destroy: () => void } {
  const doc = view.dom.ownerDocument
  const button = createButton(doc, options)
  const positioner = new ButtonPositioner(button, options.marginX)

  let host: HTMLElement | null = null
  let hovered: HTMLElement | null = null
  let lastY: number | null = null
  let frame: number | null = null
  const targets = new Set<InsertTarget>()
  let pending: InsertTarget | undefined

  function hide (): void {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    hovered = null
    lastY = null
    positioner.hide()
  }

  function recompute (): void {
    frame = null
    const from = lastY !== null && view.editable && options.items().length > 0 ? blockStartAt(view, lastY) : null
    const block = from === null ? null : view.nodeDOM(from)
    if (!(block instanceof HTMLElement)) {
      hovered = null
      positioner.hide()
      return
    }
    hovered = block
    positioner.show(block, () => firstLineRect(view, blockStartForDom(view, block), block, options.height))
  }

  function schedule (): void {
    if (lastY !== null && frame === null) frame = requestAnimationFrame(recompute)
  }

  function onMove (event: PointerEvent): void {
    if (!view.editable || button.contains(event.target as Node)) return
    lastY = event.clientY
    schedule()
  }

  function detach (): void {
    if (host === null) return
    hide()
    host.removeEventListener('pointermove', onMove)
    host.removeEventListener('pointerleave', hide)
    host.removeEventListener('wheel', schedule)
    doc.removeEventListener('scroll', schedule, true)
    host.classList.remove('tiptap-insert-host')
    host.style.removeProperty('--insert-btn-size')
    host.style.removeProperty('--insert-btn-gap')
    button.remove()
    host = null
  }

  function releaseTargets (): void {
    for (const target of targets) target.release()
  }

  function update (_view: EditorView, previous?: EditorState): void {
    const parent = view.editable ? view.dom.parentElement : null
    const hostChanged = host !== parent
    if (hostChanged) {
      detach()
      if (parent !== null) {
        host = parent
        host.classList.add('tiptap-insert-host')
        host.style.setProperty('--insert-btn-size', `${options.width}px`)
        host.style.setProperty('--insert-btn-gap', `${options.marginX}px`)
        host.appendChild(button)
        host.addEventListener('pointermove', onMove)
        host.addEventListener('pointerleave', hide)
        host.addEventListener('wheel', schedule, { passive: true })
        doc.addEventListener('scroll', schedule, { capture: true, passive: true })
        if (typeof process !== 'undefined' && process.env.NODE_ENV === 'development') {
          console.assert(getComputedStyle(host).position !== 'static', 'Insert button host must be positioned')
        }
      }
    }
    if (!view.editable) {
      hide()
      releaseTargets()
    } else {
      if (hovered !== null && hovered.parentElement !== view.dom) {
        hovered = null
        positioner.hide()
      }
      if (
        hostChanged ||
        previous === undefined ||
        previous.doc !== view.state.doc ||
        !previous.selection.eq(view.state.selection)
      ) {
        schedule()
      }
    }
  }

  button.addEventListener('mousedown', (event) => {
    // Keep the editor selection intact while the popup takes focus.
    event.preventDefault()
    event.stopPropagation()
    if (!view.editable || hovered === null) return
    const from = blockStartForDom(view, hovered)
    const node = from === null ? null : view.state.doc.nodeAt(from)

    const items = options.items()
    if (from === null || node === null || items.length === 0) {
      hide()
      return
    }

    if (pending?.started === false) pending.release()
    const target = trackInsertTarget(editor, from, (released) => {
      targets.delete(released)
      if (pending === released) pending = undefined
    })
    targets.add(target)
    pending = target
    const anchor = getEventPositionElement(event)
    const value = items.map(({ id, label, icon }) => ({ id, label, icon }))
    showPopup(SelectPopup, { value }, anchor, async (id) => {
      const item = items.find((item) => item.id === id)
      if (item === undefined || target.pos === null) {
        target.release()
        return
      }
      try {
        await item.run({ editor, target, anchor })
      } catch (error) {
        target.release()
        throw error
      }
    })
  })

  update(view)
  return {
    update,
    destroy: () => {
      detach()
      releaseTargets()
    }
  }
}

/** @public */
export const LeftMenuExtension = Extension.create<LeftMenuOptions>({
  name: 'leftMenu',

  addProseMirrorPlugins () {
    const { editor, options } = this
    return [
      new Plugin({
        key: new PluginKey('left-menu'),
        view: (view) => mountMenu(editor, view, options)
      })
    ]
  }
})
