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

import JSZip from 'jszip'
import { MarkupNodeType, type MarkupNode } from '@hcengineering/text-core'
import { markupToDocx } from '../export'

const content: MarkupNode = {
  type: MarkupNodeType.doc,
  content: [{ type: MarkupNodeType.paragraph, content: [{ type: MarkupNodeType.text, text: 'Exported text' }] }]
}

it.each(['portrait', 'landscape'] as const)('writes a real %s Word page', async (orientation) => {
  const buffer = await markupToDocx(content, { orientation })
  const zip = await JSZip.loadAsync(buffer)
  const xml = await zip.file('word/document.xml')!.async('string')
  const page = xml.match(/<w:pgSz\b[^>]*>/)?.[0] ?? ''
  expect(page).toContain(`w:orient="${orientation}"`)
  const width = Number(page.match(/w:w="(\d+)"/)?.[1])
  const height = Number(page.match(/w:h="(\d+)"/)?.[1])
  if (orientation === 'landscape') expect(width).toBeGreaterThan(height)
  else expect(height).toBeGreaterThan(width)
  expect(xml).toContain('Exported text')
})
