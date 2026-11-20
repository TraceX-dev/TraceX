/** @jest-environment jsdom */

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

import type { Asset, IntlString } from '@hcengineering/platform'
import { showPopup } from '@hcengineering/ui'
import { Editor } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { autoUpdate, computePosition } from '@floating-ui/dom'
import { type InsertContext, LeftMenuExtension } from '../leftMenu'

jest.mock('@hcengineering/platform', () => ({ getMetadata: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({
  SelectPopup: {},
  getEventPositionElement: jest.fn(),
  showPopup: jest.fn()
}))
jest.mock('@floating-ui/dom', () => ({
  autoUpdate: jest.fn(),
  computePosition: jest.fn(),
  offset: jest.fn()
}))

describe('left menu', () => {
  let editor: Editor
  let host: HTMLElement
  let menu: HTMLElement
  const cleanup = jest.fn()
  let available: boolean
  const run = jest.fn(async (_context: InsertContext) => {})
  const menuIcon = 'test:left-menu' as Asset
  const menuLabel = 'test:left-menu' as IntlString

  beforeEach(() => {
    available = true
    jest.useFakeTimers()
    jest.clearAllMocks()
    jest.mocked(autoUpdate).mockImplementation((_reference, _element, update) => {
      update()
      return cleanup
    })
    jest.mocked(computePosition).mockResolvedValue({
      x: 0,
      y: 20,
      placement: 'left-start',
      strategy: 'absolute',
      middlewareData: {}
    })
    host = document.createElement('div')
    document.body.append(host)
    editor = new Editor({
      element: host,
      extensions: [
        StarterKit,
        LeftMenuExtension.configure({
          width: 20,
          height: 20,
          marginX: 8,
          className: 'left-menu',
          items: () => (available ? [{ id: 'mermaid', label: menuLabel, icon: menuIcon, run }] : [])
        })
      ],
      content: '<p>first</p><p>second</p>'
    })
    const button = host.querySelector<HTMLElement>('.left-menu')
    if (button === null) throw new Error('Left menu was not mounted')
    menu = button
    jest.spyOn(editor.view.dom, 'getBoundingClientRect').mockReturnValue(new DOMRect(405, 335, 100, 50))
    jest.spyOn(editor.view, 'coordsAtPos').mockReturnValue({ left: 406, right: 406, top: 340, bottom: 360 })
  })

  afterEach(() => {
    editor.destroy()
    host.remove()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  function move (y: number): void {
    host.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 504, clientY: y }))
  }

  function press (): void {
    menu.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  }

  function showSecond (): number {
    const pos = editor.state.doc.child(0).nodeSize
    jest.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: pos + 1, inside: pos })
    move(370)
    jest.advanceTimersToNextFrame()
    return pos
  }

  it('mounts the button hidden and starts no positioning before the first hover', () => {
    expect(menu.style.display).toBe('none')
    expect(autoUpdate).not.toHaveBeenCalled()
  })

  it('uses the last pointer position, including at the right edge and between blocks', async () => {
    const boundary = editor.state.doc.child(0).nodeSize
    const hitTest = jest.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: boundary, inside: -1 })
    move(341)
    move(360)
    jest.advanceTimersToNextFrame()
    expect(hitTest).toHaveBeenCalledTimes(1)
    expect(hitTest).toHaveBeenCalledWith({ left: 406, top: 360 })
    hitTest.mockReturnValue(null)
    press()
    expect(hitTest).toHaveBeenCalledTimes(1)
    await jest.mocked(showPopup).mock.calls[0][3]?.('mermaid')
    expect(run.mock.calls[0][0].target.pos).toBe(boundary)
  })

  it('keeps the target through popup and hover changes', async () => {
    showSecond()
    press()
    const onClose = jest.mocked(showPopup).mock.calls[0][3]
    editor.commands.insertContentAt(0, '<p>prefix</p>')
    jest.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 })
    move(340)
    jest.advanceTimersToNextFrame()
    await onClose?.('mermaid')
    expect(run.mock.calls[0][0].target.pos).toBe(
      editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize
    )
  })

  it('ignores a hover whose DOM was removed before the next frame', () => {
    const pos = showSecond()
    editor.commands.deleteRange({ from: pos, to: editor.state.doc.content.size })
    press()
    expect(showPopup).not.toHaveBeenCalled()
    expect(menu.style.display).toBe('none')
  })

  it('skips hit testing outside the editor and does not open on a miss', () => {
    const hitTest = jest.spyOn(editor.view, 'posAtCoords').mockReturnValue(null)
    move(330)
    jest.advanceTimersToNextFrame()
    expect(hitTest).not.toHaveBeenCalled()
    move(340)
    jest.advanceTimersToNextFrame()
    press()
    expect(showPopup).not.toHaveBeenCalled()
  })

  it('refreshes the hover on scroll and stops observing when the pointer leaves the host', () => {
    showSecond()
    const hitTest = jest.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 1, inside: 0 })
    document.dispatchEvent(new Event('scroll'))
    jest.advanceTimersToNextFrame()
    expect(hitTest).toHaveBeenLastCalledWith({ left: 406, top: 370 })
    expect(autoUpdate).toHaveBeenCalledTimes(2)
    host.dispatchEvent(new Event('pointerleave'))
    expect(cleanup).toHaveBeenCalledTimes(2)
    expect(menu.style.display).toBe('none')
  })

  it('keeps the latest positioning result when two requests for the same block finish out of order', async () => {
    type Position = Awaited<ReturnType<typeof computePosition>>
    const finish: Array<(result: Position) => void> = []
    const position = (y: number): Position => ({
      x: 0,
      y,
      placement: 'left-start',
      strategy: 'absolute',
      middlewareData: {}
    })
    jest.mocked(computePosition).mockImplementation(
      async () =>
        await new Promise((resolve) => {
          finish.push(resolve)
        })
    )
    showSecond()
    move(372)
    jest.advanceTimersToNextFrame()
    expect(autoUpdate).toHaveBeenCalledTimes(1)
    expect(finish).toHaveLength(2)
    finish[1](position(44))
    await jest.advanceTimersByTimeAsync(0)
    finish[0](position(22))
    await jest.advanceTimersByTimeAsync(0)
    expect(menu.style.top).toBe('44px')
  })

  it('runs the command from the open menu snapshot even if the supplied items change', async () => {
    const pos = showSecond()
    press()
    const popup = jest.mocked(showPopup).mock.calls[0]
    expect(popup[1].value).toEqual([{ id: 'mermaid', label: menuLabel, icon: menuIcon }])
    available = false
    await popup[3]?.('mermaid')
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ editor, target: expect.objectContaining({ pos }) }))
  })

  it('does not run an action after the first popup is cancelled', async () => {
    showSecond()
    press()
    await jest.mocked(showPopup).mock.calls[0][3]?.(undefined)
    expect(run).not.toHaveBeenCalled()
  })

  it('supersedes a pending popup and preserves a started insertion across another click', async () => {
    const pos = showSecond()
    press()
    press()
    const popups = jest.mocked(showPopup).mock.calls
    await popups[0][3]?.('mermaid')
    expect(run).not.toHaveBeenCalled()

    await popups[1][3]?.('mermaid')
    const target = run.mock.calls[0][0].target
    target.begin()
    press()
    await popups[2][3]?.(undefined)
    expect(target.pos).toBe(pos)

    editor.setEditable(false)
    editor.setEditable(true)
    expect(target.pos).toBeNull()
  })

  it('releases a target when the editor becomes read-only and recovers on a fresh hover', async () => {
    showSecond()
    press()
    const onClose = jest.mocked(showPopup).mock.calls[0][3]
    editor.setEditable(false)
    expect(host.contains(menu)).toBe(false)
    expect(host.classList.contains('tiptap-insert-host')).toBe(false)
    editor.setEditable(true)
    await onClose?.('mermaid')
    expect(run).not.toHaveBeenCalled()
    expect(menu.style.display).toBe('none')
    expect(host.contains(menu)).toBe(true)
    showSecond()
    press()
    expect(showPopup).toHaveBeenCalledTimes(2)
  })

  it('removes the button and cancels pending work on destroy', () => {
    showSecond()
    move(340)
    editor.destroy()
    jest.advanceTimersToNextFrame()
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(host.contains(menu)).toBe(false)
    expect(host.style.getPropertyValue('--insert-btn-size')).toBe('')
    expect(autoUpdate).toHaveBeenCalledTimes(1)
  })
})
