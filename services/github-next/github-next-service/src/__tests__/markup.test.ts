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

import { convertSerializedMarkupToMarkdown } from '../markup'

describe('convertSerializedMarkupToMarkdown', () => {
  const options = { refUrl: 'https://front.example/browse', imageUrl: 'https://front.example/files?file=' }

  it('converts a ProseMirror document to Markdown', () => {
    const content =
      '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"uytrfe"}]},{"type":"paragraph","content":[{"type":"text","text":"èy§"}]},{"type":"paragraph","content":[{"type":"text","text":"trfedzs"}]},{"type":"paragraph","content":[{"type":"text","text":"uè§yt(rezsa"}]}]}'

    expect(convertSerializedMarkupToMarkdown(content, options)).toBe('uytrfe\n\nèy§\n\ntrfedzs\n\nuè§yt(rezsa')
  })

  it('leaves regular Markdown unchanged', () => {
    const content = '**Important** update'

    expect(convertSerializedMarkupToMarkdown(content, options)).toBe(content)
  })
})
