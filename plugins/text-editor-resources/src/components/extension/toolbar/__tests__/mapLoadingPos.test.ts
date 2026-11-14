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
import { Schema } from '@tiptap/pm/model'
import { EditorState } from '@tiptap/pm/state'

import { mapLoadingPos } from '../mapLoadingPos'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    image: { group: 'inline', inline: true, atom: true }
  }
})

// paragraph: a b [image] c d  -> image at position 3
const state = EditorState.create({
  doc: schema.node('doc', null, [
    schema.node('paragraph', null, [schema.text('ab'), schema.node('image'), schema.text('cd')])
  ])
})
const imagePos = 3

describe('mapLoadingPos', () => {
  it('follows the node when text is typed before it at the same position', () => {
    const tr = state.tr.insertText('Z', imagePos)
    const mapped = mapLoadingPos(imagePos, tr.mapping, state.doc, tr.doc)
    expect(mapped).toBe(imagePos + 1)
    expect(tr.doc.nodeAt(mapped as number)?.type.name).toBe('image')
  })

  it('shifts with text typed earlier in the paragraph', () => {
    const tr = state.tr.insertText('Z', 1)
    expect(mapLoadingPos(imagePos, tr.mapping, state.doc, tr.doc)).toBe(imagePos + 1)
  })

  it('keeps the position when text is typed after the node', () => {
    const tr = state.tr.insertText('Z', imagePos + 1)
    expect(mapLoadingPos(imagePos, tr.mapping, state.doc, tr.doc)).toBe(imagePos)
  })

  it('drops the entry when the node is deleted', () => {
    const tr = state.tr.delete(imagePos, imagePos + 1)
    expect(mapLoadingPos(imagePos, tr.mapping, state.doc, tr.doc)).toBeUndefined()
  })

  it('drops the entry when the position does not point at a node', () => {
    const tr = state.tr.insertText('Z', 1)
    expect(mapLoadingPos(9999, tr.mapping, state.doc, tr.doc)).toBeUndefined()
  })
})
