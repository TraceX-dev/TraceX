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

import { type MeasureContext } from '@hcengineering/core'
import { conformToSchema } from '@hcengineering/doc-convert'
import { ApiError } from '@hcengineering/server-core'
import { MarkupMarkType, type MarkupNode, MarkupNodeType } from '@hcengineering/text'
import { assertFitsEditorSchema } from '../document-import'

function text (value: string, marks?: MarkupNode['marks']): MarkupNode {
  const node: MarkupNode = { type: MarkupNodeType.text, text: value }
  return marks !== undefined ? { ...node, marks } : node
}

function paragraph (...content: MarkupNode[]): MarkupNode {
  return { type: MarkupNodeType.paragraph, content }
}

describe('assertFitsEditorSchema', () => {
  let ctx: Partial<MeasureContext>

  beforeEach(() => {
    ctx = { warn: jest.fn() }
  })

  it('accepts subscript and superscript marks (server schema matches the editor)', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        paragraph(
          text('H'),
          text('2', [{ type: MarkupMarkType.subscript }]),
          text('O E=mc'),
          text('2', [{ type: MarkupMarkType.superscript }])
        )
      ]
    }
    expect(() => {
      assertFitsEditorSchema(ctx as MeasureContext, doc)
    }).not.toThrow()
  })

  it('accepts conformed import output with subLink and blocks nested in a paragraph', () => {
    // The shape text-html produces for mammoth output like
    // `<p>H<sub>2</sub>O</p><table><tr><td><ul><li>A</li></ul><p><img/></p></td></tr></table>`.
    const imported: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        paragraph(text('H'), { type: MarkupNodeType.subLink, content: [text('2')] }, text('O')),
        {
          type: MarkupNodeType.table,
          content: [
            {
              type: MarkupNodeType.table_row,
              content: [
                {
                  type: MarkupNodeType.table_cell,
                  content: [
                    paragraph(
                      {
                        type: MarkupNodeType.bullet_list,
                        content: [{ type: MarkupNodeType.list_item, content: [paragraph(text('A'))] }]
                      },
                      { type: MarkupNodeType.image, attrs: { src: 'x.png' } }
                    )
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
    expect(() => {
      assertFitsEditorSchema(ctx as MeasureContext, conformToSchema(imported))
    }).not.toThrow()
  })

  it('rejects markup that does not fit the schema with 422', () => {
    // A list item directly under the doc: what the broken HTML parser used to produce.
    const invalid: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [paragraph(text('a')), { type: MarkupNodeType.list_item, content: [paragraph(text('b'))] }]
    }
    let error: unknown
    try {
      assertFitsEditorSchema(ctx as MeasureContext, invalid)
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe(422)
    expect(ctx.warn).toHaveBeenCalledTimes(1)
  })
})
