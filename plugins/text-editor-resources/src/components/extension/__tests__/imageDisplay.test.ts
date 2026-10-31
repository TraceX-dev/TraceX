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

import { getDefaultImageDisplay, normalizeInsertedImages } from '../imageDisplay'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    image: { group: 'inline', inline: true, atom: true, attrs: { display: { default: null } } }
  }
})

const doc = schema.node('doc', null, [
  schema.node('paragraph'), // 0: empty paragraph, cursor at 1
  schema.node('paragraph', null, [schema.text('hello')]), // starts at 2, text 3..8
  schema.node('paragraph', null, [schema.text('[Uploading image 1]')]), // starts at 9
  schema.node('paragraph', null, [schema.node('image'), schema.text(' tail')]) // starts at 30
])

describe('getDefaultImageDisplay', () => {
  it('keeps a block image in an empty paragraph', () => {
    expect(getDefaultImageDisplay(doc, 1)).toBeNull()
  })

  it('makes the image inline when the paragraph has text', () => {
    expect(getDefaultImageDisplay(doc, 3)).toBe('inline')
    expect(getDefaultImageDisplay(doc, 8)).toBe('inline')
  })

  it('makes the image inline next to another image', () => {
    expect(getDefaultImageDisplay(doc, 31)).toBe('inline')
  })

  it('does not count the upload placeholder as content', () => {
    expect(getDefaultImageDisplay(doc, 12, '[Uploading image 1]')).toBeNull()
    expect(getDefaultImageDisplay(doc, 12)).toBe('inline')
  })

  it('returns block outside of a text block', () => {
    expect(getDefaultImageDisplay(doc, 0)).toBeNull()
  })

  it('clamps an out-of-range position', () => {
    expect(getDefaultImageDisplay(doc, -5)).toBeNull()
    expect(getDefaultImageDisplay(doc, 10000)).toBeNull()
  })
})

describe('normalizeInsertedImages', () => {
  const img = (display: string | null = null): any => schema.node('image', { display })
  const para = (...kids: any[]): any => schema.node('paragraph', null, kids)
  const make = (...paragraphs: any[]): EditorState => EditorState.create({ doc: schema.node('doc', null, paragraphs) })
  const displayAt = (state: EditorState, pos: number): unknown => state.doc.nodeAt(pos)?.attrs.display

  function insert (state: EditorState, pos: number, node: any, uiEvent?: string): { next: EditorState, fix: any } {
    let tr = state.tr.insert(pos, node)
    if (uiEvent !== undefined) tr = tr.setMeta('uiEvent', uiEvent)
    const next = state.apply(tr)
    return { next, fix: normalizeInsertedImages([tr], next) }
  }

  it('makes a pasted image inline when it lands among text', () => {
    const { next, fix } = insert(make(para(schema.text('hello'))), 3, img(), 'paste')
    expect(fix).not.toBeNull()
    expect(displayAt(next.apply(fix), 3)).toBe('inline')
  })

  it('makes a dropped image inline when it lands among text', () => {
    const { next, fix } = insert(make(para(schema.text('hello'))), 3, img(), 'drop')
    expect(displayAt(next.apply(fix), 3)).toBe('inline')
  })

  it('keeps an image alone in an empty paragraph as block', () => {
    const { fix } = insert(make(para()), 1, img(), 'paste')
    expect(fix).toBeNull()
  })

  it('ignores whitespace-only text next to the image', () => {
    const { fix } = insert(make(para(schema.text(' '))), 1, img(), 'paste')
    expect(fix).toBeNull()
  })

  it('does nothing for ordinary typing or programmatic changes', () => {
    expect(insert(make(para(schema.text('hello'))), 3, img()).fix).toBeNull()
    expect(insert(make(para(schema.text('hello'))), 3, img(), 'input').fix).toBeNull()
  })

  it('leaves an explicit display alone', () => {
    const { fix } = insert(make(para(schema.text('hello'))), 3, img('inline'), 'paste')
    expect(fix).toBeNull()
  })

  it('does not touch images that were not part of the change', () => {
    const state = make(para(schema.text('a'), img(), schema.text('b')), para(schema.text('x')))
    const tr = state.tr.insertText('Q', 6).setMeta('uiEvent', 'paste')
    expect(normalizeInsertedImages([tr], state.apply(tr))).toBeNull()
  })
})
