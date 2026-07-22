//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { MarkupMarkType, type MarkupNode, MarkupNodeType } from '@hcengineering/text-core'
import { docxToMarkup, markupToDocx } from '..'

const sample: MarkupNode = {
  type: MarkupNodeType.doc,
  content: [
    {
      type: MarkupNodeType.heading,
      attrs: { level: 1 },
      content: [{ type: MarkupNodeType.text, text: 'Title' }]
    },
    {
      type: MarkupNodeType.paragraph,
      content: [
        { type: MarkupNodeType.text, text: 'Hello ' },
        { type: MarkupNodeType.text, text: 'world', marks: [{ type: MarkupMarkType.bold }] }
      ]
    },
    {
      type: MarkupNodeType.bullet_list,
      content: [
        {
          type: MarkupNodeType.list_item,
          content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'first' }] }]
        },
        {
          type: MarkupNodeType.list_item,
          content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'second' }] }]
        }
      ]
    }
  ]
}

describe('markupToDocx', () => {
  it('produces a non-empty docx (zip) buffer', async () => {
    const buf = await markupToDocx(sample)
    expect(buf.length).toBeGreaterThan(0)
    // .docx is a zip archive: first two bytes are the "PK" magic
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('handles an empty document without throwing', async () => {
    const buf = await markupToDocx({ type: MarkupNodeType.doc, content: [] })
    expect(buf.length).toBeGreaterThan(0)
  })
})

describe('docxToMarkup', () => {
  it('round-trips text content through docx', async () => {
    const buf = await markupToDocx(sample)
    const { markup } = await docxToMarkup(buf)
    const serialized = JSON.stringify(markup)
    expect(serialized).toContain('Title')
    expect(serialized).toContain('world')
    expect(serialized).toContain('first')
  })
})
