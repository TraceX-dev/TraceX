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

import { QMSInlineCommentMark as SharedQMSInlineCommentMark } from '@hcengineering/text'
import { Editor, getSchema, Node, type AnyExtension, type JSONContent } from '@tiptap/core'
import { DOMParser, DOMSerializer } from '@tiptap/pm/model'
import { QMSInlineCommentMark, qmsInlineCommentMarkName } from '../components/extension/qms/qmsInlineCommentMark'

jest.mock('@hcengineering/text', () =>
  jest.requireActual('../../../../foundations/core/packages/text/src/marks/qmsInlineCommentMark')
)

const nodes: AnyExtension[] = [
  Node.create({ name: 'doc', topNode: true, content: 'block+' }),
  Node.create({ name: 'text', group: 'inline' }),
  Node.create({
    name: 'paragraph',
    group: 'block',
    content: 'inline*',
    parseHTML: () => [{ tag: 'p' }],
    renderHTML: () => ['p', 0]
  })
]

const content: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reviewed text' }] }]
}

describe('shared QMS comment mark', () => {
  it('uses the same persisted schema in the client and server', () => {
    const server = getSchema([...nodes, SharedQMSInlineCommentMark]).marks[qmsInlineCommentMarkName]
    const client = getSchema([...nodes, QMSInlineCommentMark]).marks[qmsInlineCommentMarkName]
    expect(client.spec.attrs).toEqual(server.spec.attrs)
    expect(client.spec.inclusive).toBe(server.spec.inclusive)
    expect(client.spec.excludes).toBe(server.spec.excludes)
  })

  it('keeps the client commands and click handler for overlapping anchors', () => {
    const onNodeClicked = jest.fn()
    const editor = new Editor({
      extensions: [...nodes, QMSInlineCommentMark.configure({ onNodeClicked })],
      content
    })
    try {
      editor.commands.setTextSelection({ from: 1, to: 9 })
      expect(editor.commands.setQMSInlineCommentMark('first-comment')).toBe(true)
      expect(editor.commands.setQMSInlineCommentMark('second-comment')).toBe(true)
      const ids = editor.state.doc.firstChild?.firstChild?.marks.map((mark) => mark.attrs[qmsInlineCommentMarkName])
      expect(ids).toEqual(['first-comment', 'second-comment'])
      editor.commands.setTextSelection(2)
      editor.view.someProp('handleClick', (handler) => handler(editor.view, 2, new MouseEvent('click')))
      expect(onNodeClicked).toHaveBeenCalledWith(['first-comment', 'second-comment'])
    } finally {
      editor.destroy()
    }
  })

  it('preserves comment IDs when client HTML is read by the shared schema', () => {
    const client = getSchema([
      ...nodes,
      QMSInlineCommentMark.configure({ HTMLAttributes: { class: 'comment-anchor' } })
    ])
    const server = getSchema([...nodes, SharedQMSInlineCommentMark])
    const doc = client.nodeFromJSON(content)
    const mark = client.marks[qmsInlineCommentMarkName].create({ [qmsInlineCommentMarkName]: 'comment-id' })
    const marked = client.nodes.doc.create(
      null,
      client.nodes.paragraph.create(null, client.text(doc.textContent, [mark]))
    )
    const container = document.createElement('div')
    container.appendChild(DOMSerializer.fromSchema(client).serializeFragment(marked.content))
    expect(container.querySelector('span')?.className).toBe('comment-anchor')
    const restored = DOMParser.fromSchema(server).parse(container)
    restored.check()
    expect(restored.toJSON()).toEqual(marked.toJSON())
  })
})
