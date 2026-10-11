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

import { markdownToInlineCell } from '../inline'
import { markdownToMarkup, markupToMarkdown } from '../index'

describe('markdownToInlineCell', () => {
  it('returns an empty string for empty input', () => {
    expect(markdownToInlineCell('')).toBe('')
    expect(markdownToInlineCell(undefined as unknown as string)).toBe('')
  })

  it('keeps a single paragraph as is', () => {
    expect(markdownToInlineCell('Hello world')).toBe('Hello world')
  })

  it('keeps inline emphasis', () => {
    expect(markdownToInlineCell('see **this**')).toBe('see **this**')
  })

  it('joins blocks with <br> instead of collapsing them into one line', () => {
    expect(markdownToInlineCell('first\n\nsecond')).toBe('first<br>second')
  })

  it('keeps an inline image', () => {
    const md = '![shot](image://blob1?file=blob1&width=200)'
    expect(markdownToInlineCell(md)).toBe(md)
  })

  it('keeps an <img> tag', () => {
    const md = '<img width="100" src="http://x/y.png" alt="shot">'
    expect(markdownToInlineCell(md)).toBe(md)
  })

  it('turns bullet items into • bullets separated by <br>', () => {
    expect(markdownToInlineCell('* one\n* two')).toBe('• one<br>• two')
    expect(markdownToInlineCell('- one\n- two')).toBe('• one<br>• two')
  })

  it('keeps ordered list numbering', () => {
    expect(markdownToInlineCell('1. one\n2. two')).toBe('1. one<br>2. two')
  })

  it('does not treat bold at line start as a bullet', () => {
    expect(markdownToInlineCell('**bold** text')).toBe('**bold** text')
  })

  it('turns <br> into a cell line break', () => {
    expect(markdownToInlineCell('a<br>b')).toBe('a<br>b')
  })

  it('collapses a markdown hard break', () => {
    expect(markdownToInlineCell('a\\\nb')).toBe('a<br>b')
  })

  it('strips nested table html so it cannot break the outer table', () => {
    const md = '<table><tr><th>h</th></tr><tr><td>1</td></tr></table>'
    const result = markdownToInlineCell(md)
    expect(result).not.toMatch(/<(?!br|img)[^>]+>/)
    expect(result).toBe('h 1')
  })

  it('drops code fences and thematic breaks', () => {
    expect(markdownToInlineCell('```\ncode\n```')).toBe('code')
    expect(markdownToInlineCell('a\n\n---\n\nb')).toBe('a<br>b')
  })

  it('strips heading and blockquote markers', () => {
    expect(markdownToInlineCell('# Title\n\n> quoted')).toBe('Title<br>quoted')
  })

  it('converts an anchor into a markdown link', () => {
    expect(markdownToInlineCell('<a href="http://x/y">text</a>')).toBe('[text](http://x/y)')
  })
})

describe('markup with rich text survives an outer table cell', () => {
  const markup = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      // the editor keeps images inline, inside a paragraph
      { type: 'paragraph', content: [{ type: 'image', attrs: { 'file-id': 'blob123', width: 200, alt: 'shot' } }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] }
        ]
      }
    ]
  } as any

  function cellOf (table: string): any {
    const doc = markdownToMarkup(table)
    return doc.content?.[0].content?.[1].content?.[1]
  }

  it('serializes an image with the ?file= query so file-id can be restored', () => {
    const md = markupToMarkdown({ type: 'doc', content: [markup.content[1]] } as any)
    expect(md).toContain('?file=blob123')
  })

  it('restores image and hard breaks after a round-trip through a pipe table cell', () => {
    const cellValue = markdownToInlineCell(markupToMarkdown(markup))
    const table = '| A | RT |\n| --- | --- |\n| x | ' + cellValue + ' |\n'

    const cell = cellOf(table)
    const inline = cell.content?.[0].content ?? []

    const image = inline.find((n: any) => n.type === 'image')
    expect(image).toBeDefined()
    expect(image.attrs['file-id']).toBe('blob123')

    expect(inline.filter((n: any) => n.type === 'hardBreak').length).toBeGreaterThan(0)
    const text = inline
      .filter((n: any) => n.type === 'text')
      .map((n: any) => n.text)
      .join('')
    expect(text).toContain('• one')
    expect(text).toContain('• two')
  })
})
