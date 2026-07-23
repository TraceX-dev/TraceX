//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { MarkupMarkType, type MarkupNode, MarkupNodeType } from '@hcengineering/text-core'
import { collectImageRefs, conformToSchema, docxToMarkup, markupToDocx, normalizeMarkup } from '..'

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

describe('normalizeMarkup', () => {
  it('drops empty text nodes and trailing empty paragraphs', () => {
    const messy: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'keep' }] },
        { type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: '' }] },
        { type: MarkupNodeType.paragraph, content: [] }
      ]
    }
    const normalized = normalizeMarkup(messy)
    expect(normalized.content).toHaveLength(1)
    expect(JSON.stringify(normalized)).toContain('keep')
  })
})

describe('conformToSchema', () => {
  it('wraps bare text in a list item into a paragraph (schema validity)', () => {
    const invalid: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.bullet_list,
          content: [
            {
              type: MarkupNodeType.list_item,
              content: [{ type: MarkupNodeType.text, text: 'bare' }]
            }
          ]
        }
      ]
    }
    const fixed = conformToSchema(invalid)
    const listItem = fixed.content?.[0].content?.[0]
    expect(listItem?.content?.[0].type).toBe(MarkupNodeType.paragraph)
    expect(JSON.stringify(fixed)).toContain('bare')
  })
})

describe('images', () => {
  // 1x1 transparent PNG
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
  const withImage: MarkupNode = {
    type: MarkupNodeType.doc,
    content: [{ type: MarkupNodeType.image, attrs: { 'file-id': 'blob-1' } }]
  }

  it('collectImageRefs returns image blob references', () => {
    expect(collectImageRefs(withImage)).toEqual(['blob-1'])
  })

  it('embeds an image when its bytes are supplied', async () => {
    const images = new Map<string, Uint8Array>([['blob-1', png1x1]])
    const buf = await markupToDocx(withImage, { images })
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('skips images without supplied bytes (no throw)', async () => {
    const buf = await markupToDocx(withImage)
    expect(buf.length).toBeGreaterThan(0)
  })
})
