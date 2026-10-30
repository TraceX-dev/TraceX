/**
 * @jest-environment jsdom
 */
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

import { Editor, Node } from '@tiptap/core'
import tippy from 'tippy.js'
import { ToolbarExtension } from '../components/extension/toolbar/toolbar'

jest.mock('@hcengineering/core', () => ({ notEmpty: (value: unknown) => value != null }))
jest.mock('@hcengineering/ui', () => ({
  DebouncedCaller: class {
    private timer?: ReturnType<typeof setTimeout>

    call (callback: () => void): void {
      clearTimeout(this.timer)
      this.timer = setTimeout(callback, 250)
    }
  }
}))
jest.mock('../components/extension/toolbar/EditorToolbar.svelte', () => ({}))
jest.mock('../components/node-view', () => ({
  SvelteRenderer: class {
    constructor (_component: unknown, { element }: { element: HTMLElement }) {
      element.innerHTML = '<button><svg><path /></svg></button>'
    }

    updateProps (): void {}
  }
}))
jest.mock('tippy.js', () => ({ __esModule: true, default: jest.fn() }))

class ToolbarResizeObserver implements ResizeObserver {
  static instances: ToolbarResizeObserver[] = []
  readonly observe = jest.fn()
  readonly unobserve = jest.fn()
  readonly disconnect = jest.fn()

  constructor (private readonly callback: ResizeObserverCallback) {
    ToolbarResizeObserver.instances.push(this)
  }

  resize (): void {
    this.callback([], this)
  }
}

describe('toolbar positioning', () => {
  let editor: Editor
  let container: HTMLElement
  const setProps = jest.fn()
  const forceUpdate = jest.fn()

  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    ToolbarResizeObserver.instances = []
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: ToolbarResizeObserver })
    jest.mocked(tippy).mockImplementation((_element, props) => {
      container = props?.content as HTMLElement
      document.body.append(container)
      return {
        state: { isShown: false },
        setProps,
        show: jest.fn(),
        hide: jest.fn(),
        destroy: jest.fn(),
        popperInstance: { forceUpdate }
      } as unknown as ReturnType<typeof tippy>
    })

    editor = new Editor({
      extensions: [
        Node.create({ name: 'doc', topNode: true, content: 'paragraph+' }),
        Node.create({ name: 'paragraph', content: 'text*', renderHTML: () => ['p', 0] }),
        Node.create({ name: 'text', group: 'inline' }),
        ToolbarExtension.configure({ providers: [], context: { mode: 'full' } })
      ],
      content: '<p>Comment on this text</p>'
    })
    document.body.append(editor.view.dom)
    jest.spyOn(editor.view, 'posAtCoords').mockReturnValue(null)
    jest.runOnlyPendingTimers()
    setProps.mockClear()
  })

  afterEach(() => {
    editor.view.dom.remove()
    editor.destroy()
    container.remove()
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  test('repositions when asynchronously rendered actions change the toolbar size', () => {
    const observer = ToolbarResizeObserver.instances[0]
    expect(observer.observe).toHaveBeenCalledWith(container)
    observer.resize()
    expect(forceUpdate).toHaveBeenCalledTimes(1)
  })

  test.each(['button', 'svg', 'path'])('keeps the toolbar still while clicking its %s', (selector) => {
    const target = container.querySelector(selector)
    expect(target).not.toBeNull()
    const click = jest.fn()
    container.addEventListener('click', click)

    target?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    target?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(click).toHaveBeenCalledTimes(1)
    expect(setProps).not.toHaveBeenCalled()
  })

  test('continues updating the toolbar when selecting in the editor and releasing over the toolbar', () => {
    editor.view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    expect(setProps).toHaveBeenCalledTimes(2)
  })

  test('disconnects the size observer when the editor is destroyed', () => {
    const observer = ToolbarResizeObserver.instances[0]
    editor.destroy()
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
  })
})
