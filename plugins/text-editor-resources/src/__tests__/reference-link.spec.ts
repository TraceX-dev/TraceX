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

import { Editor, Node, type JSONContent, type NodeViewRendererProps } from '@tiptap/core'
import { DOMParser, DOMSerializer, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { createQuery, getClient, type PrintContext } from '@hcengineering/presentation'
import { getResource } from '@hcengineering/platform'
import { ReferenceExtension, type ReferenceExtensionOptions } from '../components/extension/reference'

jest.mock('@hcengineering/text', () =>
  jest.requireActual('../../../../foundations/core/packages/text/src/nodes/reference')
)
jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn(),
  translate: jest.fn(async () => 'Everyone')
}))
jest.mock('@hcengineering/presentation', () => ({ createQuery: jest.fn(), getClient: jest.fn() }))
jest.mock('@hcengineering/view', () => ({
  __esModule: true,
  default: { function: { GetLink: 'get-link' }, mixin: {}, ids: { IconWithEmoji: 'emoji' } }
}))
jest.mock('@hcengineering/contact', () => ({
  __esModule: true,
  default: {
    mention: { Everyone: 'everyone', Here: 'here' },
    class: { Contact: 'contact' },
    string: { Everyone: 'everyone' }
  }
}))
jest.mock('@hcengineering/activity', () => ({ __esModule: true, default: { class: { ActivityMessage: 'message' } } }))
jest.mock('@hcengineering/ui', () => ({ tooltip: jest.fn() }))
jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))
jest.mock('../components/MentionList.svelte', () => ({}))
jest.mock('../components/node-view', () => ({ SvelteRenderer: jest.fn() }))
jest.mock('../components/extension/suggestion', () => ({ __esModule: true, default: jest.fn() }))

interface MountedReference {
  view: NodeView
  printContext: Partial<PrintContext>
  openDocument: jest.MockedFunction<NonNullable<ReferenceExtensionOptions['openDocument']>>
}

describe('Reference links without embedded previews', () => {
  const query = jest.fn()
  const finish = jest.fn()
  const getLink = jest.fn(async () => 'https://tracex.example/workbench/workspace/drive/file/file')

  beforeEach(() => {
    jest.clearAllMocks()
    const hierarchy: Partial<ReturnType<ReturnType<typeof getClient>['getHierarchy']>> = {
      isDerived: jest.fn(() => false),
      findClass: jest.fn(() => undefined),
      classHierarchyMixin: jest.fn(() => undefined)
    }
    const client: Partial<ReturnType<typeof getClient>> = {
      getHierarchy: () => hierarchy as ReturnType<ReturnType<typeof getClient>['getHierarchy']>
    }
    const liveQuery: Partial<ReturnType<typeof createQuery>> = { query, unsubscribe: jest.fn() }
    jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)
    jest.mocked(createQuery).mockReturnValue(liveQuery as ReturnType<typeof createQuery>)
    jest.mocked(getResource).mockResolvedValue(getLink)
  })

  function mount (id = 'file', printing = true): MountedReference {
    const printContext: Partial<PrintContext> = { registerResource: jest.fn(() => finish) }
    const openDocument = jest.fn()
    const options: Partial<ReferenceExtensionOptions> = {
      printContext: printing ? (printContext as PrintContext) : undefined,
      openDocument,
      HTMLAttributes: {},
      suggestion: { char: '@' }
    }
    const createView: ReturnType<NonNullable<typeof ReferenceExtension.config.addNodeView>> = Reflect.apply(
      ReferenceExtension.config.addNodeView!,
      { options, name: 'reference' },
      []
    )
    if (createView === null) throw new Error('Reference node view is unavailable')
    const node: Partial<ProseMirrorNode> = { attrs: { id, objectclass: 'file-class', label: 'Document', fixed: true } }
    const props: Partial<NodeViewRendererProps> = { node: node as ProseMirrorNode, HTMLAttributes: {} }
    return { view: createView(props as NodeViewRendererProps), printContext, openDocument }
  }

  it('renders an anchor and waits for the canonical object URL before printing', async () => {
    const { view, printContext } = mount()
    expect(view.dom.nodeName).toBe('A')
    expect(printContext.registerResource).toHaveBeenCalled()
    expect(finish).not.toHaveBeenCalled()
    await query.mock.calls[0][2]([{ _id: 'file', _class: 'file-class' }])
    expect((view.dom as HTMLAnchorElement).href).toBe('https://tracex.example/workbench/workspace/drive/file/file')
    expect(finish).toHaveBeenCalled()
    view.destroy?.()
  })

  it('keeps group mentions as text instead of linking to nonexistent documents', () => {
    const { view, printContext } = mount('everyone')
    expect(view.dom.nodeName).toBe('SPAN')
    expect(printContext.registerResource).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
    view.destroy?.()
  })

  it('releases printing without attaching a late URL after destruction', async () => {
    const { view } = mount()
    view.destroy?.()
    await query.mock.calls[0][2]([{ _id: 'file', _class: 'file-class' }])
    expect(getLink).not.toHaveBeenCalled()
    expect(view.dom.hasAttribute('href')).toBe(false)
    expect(finish).toHaveBeenCalled()
  })

  it('allows native link activation in the print view', async () => {
    const { view, openDocument } = mount()
    await query.mock.calls[0][2]([{ _id: 'file', _class: 'file-class' }])
    const event = new MouseEvent('click', { cancelable: true })
    view.dom.addEventListener('click', (event) => {
      expect(event.defaultPrevented).toBe(false)
      event.preventDefault()
    })
    view.dom.dispatchEvent(event)
    expect(openDocument).not.toHaveBeenCalled()
    view.destroy?.()
  })

  it('keeps the original editor markup without resolving a URL', async () => {
    const { view, printContext } = mount('file', false)
    await query.mock.calls[0][2]([{ _id: 'file', _class: 'file-class' }])
    expect(view.dom.nodeName).toBe('SPAN')
    expect(view.dom.getAttribute('data-id')).toBe('file')
    expect(view.dom.getAttribute('data-objectclass')).toBe('file-class')
    expect(view.dom.getAttribute('data-type')).toBe('reference')
    expect(view.dom.hasAttribute('href')).toBe(false)
    expect(getLink).not.toHaveBeenCalled()
    expect(printContext.registerResource).not.toHaveBeenCalled()
    view.destroy?.()
  })

  it('retains editor navigation through the original span', () => {
    const { view, openDocument } = mount('file', false)
    const event = new MouseEvent('click', { cancelable: true })
    view.dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(openDocument).toHaveBeenCalledTimes(1)
    view.destroy?.()
  })

  it.each([false, true])('preserves reference HTML and its import in print mode %s', (printing) => {
    const printContext: Partial<PrintContext> = { registerResource: jest.fn(() => jest.fn()) }
    const options: Partial<ReferenceExtensionOptions> = {
      suggestion: { char: '@' },
      printContext: printing ? (printContext as PrintContext) : undefined
    }
    const content: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'reference',
              attrs: { id: 'file', objectclass: 'file-class', label: 'Document', fixed: true }
            }
          ]
        }
      ]
    }
    const editor = new Editor({
      extensions: [
        Node.create({ name: 'doc', topNode: true, content: 'paragraph+' }),
        Node.create({
          name: 'paragraph',
          content: 'inline*',
          renderHTML: () => ['p', 0],
          parseHTML: () => [{ tag: 'p' }]
        }),
        Node.create({ name: 'text', group: 'inline' }),
        ReferenceExtension.extend({ addProseMirrorPlugins: () => [] }).configure(options)
      ],
      content
    })
    try {
      const html = editor.getHTML()
      const fragment = document.createElement('div')
      fragment.innerHTML = html
      expect(fragment.querySelector('a')).toBeNull()
      expect(fragment.querySelector('span[data-type="reference"]')?.getAttribute('data-fixed')).toBe('true')
      expect(fragment.querySelector('span[data-type="reference"]')?.hasAttribute('href')).toBe(false)
      const clipboard = document.createElement('div')
      clipboard.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content))
      expect(clipboard.innerHTML).toBe(html)
      expect(DOMParser.fromSchema(editor.schema).parse(clipboard).toJSON()).toEqual(content)
      editor.commands.setContent(html)
      expect(editor.getJSON()).toEqual(content)
    } finally {
      editor.destroy()
    }
  })
})
