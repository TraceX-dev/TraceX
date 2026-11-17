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

import { fileNameFromResponse } from './download'

it('prefers the UTF-8 filename over the ASCII fallback', () => {
  const name = 'Техническое задание.docx'
  const response = new Response(null, {
    headers: {
      'Content-Disposition': `attachment; filename="document.docx"; filename*=UTF-8''${encodeURIComponent(name)}`
    }
  })
  expect(fileNameFromResponse(response, 'fallback.docx')).toBe(name)
})

it('keeps supporting existing quoted filenames', () => {
  const response = new Response(null, { headers: { 'Content-Disposition': 'attachment; filename="document.md"' } })
  expect(fileNameFromResponse(response, 'fallback.md')).toBe('document.md')
})

it('uses the fallback when the filename header is missing', () => {
  expect(fileNameFromResponse(new Response(), 'document.md')).toBe('document.md')
})

it('uses the ASCII filename if the extended value cannot be decoded', () => {
  const response = new Response(null, {
    headers: { 'Content-Disposition': 'attachment; filename="document.md"; filename*=UTF-8\'\'%ZZ' }
  })
  expect(fileNameFromResponse(response, 'fallback.md')).toBe('document.md')
})
