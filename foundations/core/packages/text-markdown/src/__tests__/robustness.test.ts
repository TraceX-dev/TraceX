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

// Regression tests for the "Export to Markdown" crash on controlled documents:
// editor-only node/mark types (QMS inline review comments, notes, highlight,
// inline files, the drawing board) used to make the whole serializer throw,
// producing either a failed request or, once caught upstream, no file at all.
// These tests lock in the fix: known editor-only types degrade gracefully to
// sensible Markdown, and any *other* unrecognized type is dropped instead of
// aborting the export.

import { MarkupNode } from '@hcengineering/text-core'
import { markupToMarkdown } from '..'

const options = { refUrl: 'ref://', imageUrl: 'http://localhost/' }

describe('markupToMarkdown - editor-only / QMS node & mark types', () => {
  it('does not throw on a QMS inline-review-comment mark (node-uuid) and keeps the text', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'flagged during review',
              marks: [{ type: 'node-uuid', attrs: { 'node-uuid': 'abc-123' } }]
            }
          ]
        }
      ]
    }

    expect(() => markupToMarkdown(markup, options)).not.toThrow()
    expect(markupToMarkdown(markup, options)).toContain('flagged during review')
  })

  it('does not throw on a threaded inline-comment mark and keeps the text', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'commented text',
              marks: [{ type: 'inline-comment', attrs: { thread: 'xyz' } }]
            }
          ]
        }
      ]
    }

    expect(markupToMarkdown(markup, options)).toEqual('commented text')
  })

  it('renders a highlight mark as <mark>...</mark>', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'important',
              marks: [{ type: 'highlight' }]
            }
          ]
        }
      ]
    }

    expect(markupToMarkdown(markup, options)).toEqual('<mark>important</mark>')
  })

  it('renders a note mark without dropping the underlying text', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'careful here',
              marks: [{ type: 'note', attrs: { kind: 'warning', title: 'double-check this value' } }]
            }
          ]
        }
      ]
    }

    const result = markupToMarkdown(markup, options)
    expect(result).toContain('careful here')
    expect(result).toContain('double-check this value')
  })

  it('renders a note mark with no title without throwing', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'plain note',
              marks: [{ type: 'note', attrs: { kind: 'neutral' } }]
            }
          ]
        }
      ]
    }

    expect(markupToMarkdown(markup, options)).toEqual('plain note')
  })

  it('renders an inline file attachment as a download link', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'file',
              attrs: {
                'file-id': 'blob123',
                'data-file-name': 'spec.pdf',
                'data-file-type': 'application/pdf'
              }
            }
          ]
        }
      ]
    }

    const result = markupToMarkdown(markup, options)
    expect(result).toEqual('[spec.pdf](http://localhost/blob123?file=blob123)')
  })

  it('renders a drawing board as a placeholder instead of throwing', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [{ type: 'drawingBoard', attrs: { id: 'board1' } }]
    }

    expect(() => markupToMarkdown(markup, options)).not.toThrow()
    expect(markupToMarkdown(markup, options)).toContain('[drawing]')
  })
})

describe('markupToMarkdown - unknown node/mark fallback', () => {
  it('does not throw on a completely unrecognized node type and preserves nested text', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'someFutureNodeType',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'nested text should survive', marks: [] }]
            }
          ]
        }
      ]
    }

    expect(() => markupToMarkdown(markup, options)).not.toThrow()
    expect(markupToMarkdown(markup, options)).toContain('nested text should survive')
  })

  it('does not throw on a completely unrecognized leaf node type with no content', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'before ', marks: [] },
            { type: 'someFutureLeafType', attrs: { foo: 'bar' } },
            { type: 'text', text: ' after', marks: [] }
          ]
        }
      ]
    }

    expect(() => markupToMarkdown(markup, options)).not.toThrow()
    const result = markupToMarkdown(markup, options)
    expect(result).toContain('before')
    expect(result).toContain('after')
  })

  it('does not throw on a completely unrecognized mark type and preserves the text', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'styled by a future mark',
              marks: [{ type: 'someFutureMarkType', attrs: { color: 'red' } }]
            }
          ]
        }
      ]
    }

    expect(() => markupToMarkdown(markup, options)).not.toThrow()
    expect(markupToMarkdown(markup, options)).toEqual('styled by a future mark')
  })

  it('does not throw when an unknown mark is combined with a known mixable mark', () => {
    // Regression for the active-marks reorder path, which used to dereference
    // `this.marks[type].mixable` without checking the mark was recognized.
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'unknown only',
              marks: [{ type: 'someFutureMarkType' }]
            },
            {
              type: 'text',
              text: 'unknown and bold',
              marks: [{ type: 'someFutureMarkType' }, { type: 'bold' }]
            }
          ]
        }
      ]
    }

    expect(() => markupToMarkdown(markup, options)).not.toThrow()
  })
})

describe('markupToMarkdown - full controlled document does not crash on export', () => {
  it('exports a document mixing QMS review marks, notes, highlight, a file and a drawing board', () => {
    const markup: MarkupNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Reviewer left a comment here: ', marks: [] },
            { type: 'text', text: 'flagged text', marks: [{ type: 'node-uuid', attrs: { 'node-uuid': 'abc-123' } }] },
            { type: 'text', text: ' and this is ', marks: [] },
            { type: 'text', text: 'highlighted', marks: [{ type: 'highlight' }] },
            { type: 'text', text: ' plus a ', marks: [] },
            {
              type: 'text',
              text: 'note',
              marks: [{ type: 'note', attrs: { kind: 'warning', title: 'careful here' } }]
            },
            { type: 'text', text: ' and a thread ', marks: [] },
            { type: 'text', text: 'comment', marks: [{ type: 'inline-comment', attrs: { thread: 'xyz' } }] },
            { type: 'text', text: '.', marks: [] }
          ]
        },
        {
          type: 'file',
          attrs: { 'file-id': 'blob123', 'data-file-name': 'spec.pdf', 'data-file-type': 'application/pdf' }
        },
        { type: 'drawingBoard', attrs: { id: 'board1' } }
      ]
    }

    let result = ''
    expect(() => {
      result = markupToMarkdown(markup, options)
    }).not.toThrow()

    // The old behavior was either a thrown exception (surfaced as a failed export) or,
    // once nothing threw the error handling forward, an empty download. Assert the
    // export actually produced non-empty, meaningful content instead.
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain('flagged text')
    expect(result).toContain('highlighted')
    expect(result).toContain('spec.pdf')
  })
})
