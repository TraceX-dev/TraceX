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

import { validateHeaderValue } from 'node:http'
import { documentExportDisposition, parseDocumentExportOptions, withDocumentTitle } from '../document-content'

describe('document export options', () => {
  it('preserves body-only export for existing callers', () => {
    expect(parseDocumentExportOptions({})).toEqual({ orientation: 'portrait', includeTitle: false })
  })

  it('accepts the unified export settings', () => {
    expect(parseDocumentExportOptions({ orientation: 'landscape', includeTitle: true })).toEqual({
      orientation: 'landscape',
      includeTitle: true
    })
  })

  it.each(['sideways', 1, true])('rejects invalid orientation %p', (orientation) => {
    expect(() => parseDocumentExportOptions({ orientation })).toThrow('Invalid page orientation')
  })

  it('rejects invalid title flags', () => {
    expect(() => parseDocumentExportOptions({ includeTitle: 'yes' })).toThrow('Invalid includeTitle value')
  })
})

it('prepends a literal heading and preserves rich editor content', () => {
  const original =
    '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Body","marks":[{"type":"bold"}]}]}]}'
  const result = JSON.parse(withDocumentTitle(original, 'Title <&>'))
  expect(result.content[0]).toEqual({
    type: 'heading',
    attrs: { level: 1 },
    content: [{ type: 'text', text: 'Title <&>' }]
  })
  expect(result.content[1]).toEqual(JSON.parse(original).content[0])
  expect(JSON.parse(original).content).toHaveLength(1)
})

it.each(['Техническое задание.md', '仕様書.docx'])('allows downloading a Unicode document named %s', (fileName) => {
  const disposition = documentExportDisposition(fileName)
  expect(() => {
    validateHeaderValue('Content-Disposition', disposition)
  }).not.toThrow()
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1]
  expect(encoded).toBeDefined()
  expect(decodeURIComponent(encoded ?? '')).toBe(fileName)
})
