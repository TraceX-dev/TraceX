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

import { getSchema, type JSONContent } from '@tiptap/core'
import { EditorState } from '@tiptap/pm/state'
import type { MarkupNode } from '@hcengineering/text-core'
import { ServerKit } from '../../kits/server-kit'
import { jsonToPmNode, pmNodeToJSON } from '../../markup/utils'

const content: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Reviewed text',
          marks: [{ type: 'node-uuid', attrs: { 'node-uuid': 'first-comment' } }]
        }
      ]
    }
  ]
}

describe('server QMS comment schema', () => {
  it('preserves a comment identity through the default markup conversion', () => {
    const node = jsonToPmNode(content as MarkupNode)
    node.check()
    expect(pmNodeToJSON(node).content?.[0].content?.[0].marks).toEqual(content.content?.[0].content?.[0].marks)
  })

  it('allows overlapping comment identities on the same text', () => {
    const overlapping = structuredClone(content)
    overlapping.content?.[0].content?.[0].marks?.push({
      type: 'node-uuid',
      attrs: { 'node-uuid': 'second-comment' }
    })
    const node = jsonToPmNode(overlapping as MarkupNode)
    node.check()
    expect(pmNodeToJSON(node).content?.[0].content?.[0].marks).toEqual(overlapping.content?.[0].content?.[0].marks)
  })

  it('keeps anchors on existing text without extending them onto adjacent typing', () => {
    const schema = getSchema([ServerKit])
    const doc = schema.nodeFromJSON(content)
    const state = EditorState.create({ schema, doc })
    const end = 1 + 'Reviewed text'.length
    const edited = state.apply(state.tr.insertText(' appended', end))
    edited.doc.check()
    expect(edited.doc.firstChild?.firstChild?.marks.map((mark) => mark.toJSON())).toEqual(
      content.content?.[0].content?.[0].marks
    )
    expect(edited.doc.firstChild?.lastChild?.marks).toEqual([])
    expect(edited.doc.textContent).toBe('Reviewed text appended')
  })
})
