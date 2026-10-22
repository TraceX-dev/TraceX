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

import { getDefaultImageDisplay } from '../imageDisplay'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    text: { group: 'inline' },
    image: { group: 'inline', inline: true, atom: true }
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
