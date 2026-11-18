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

import { MarkupMarkType, type MarkupNode, MarkupNodeType } from '@hcengineering/text-core'
import { getSchema } from '@tiptap/core'
import { jsonToPmNode } from '../../markup/utils'
import { ServerKit } from '../server-kit'

describe('ServerKit', () => {
  it.each([MarkupMarkType.subscript, MarkupMarkType.superscript])('defines the %s mark of the editor', (mark) => {
    expect(getSchema([ServerKit]).marks[mark]).toBeDefined()
  })

  it('accepts markup with subscript and superscript text', () => {
    const doc: MarkupNode = {
      type: MarkupNodeType.doc,
      content: [
        {
          type: MarkupNodeType.paragraph,
          content: [
            { type: MarkupNodeType.text, text: 'H' },
            { type: MarkupNodeType.text, text: '2', marks: [{ type: MarkupMarkType.subscript }] },
            { type: MarkupNodeType.text, text: 'O E=mc' },
            { type: MarkupNodeType.text, text: '2', marks: [{ type: MarkupMarkType.superscript }] }
          ]
        }
      ]
    }
    expect(() => {
      jsonToPmNode(doc).check()
    }).not.toThrow()
  })
})
