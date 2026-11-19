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

import { fetchPreviewFile } from '@hcengineering/presentation'
import { convertToHTML } from '@hcengineering/print'
import { loadDocxPreview } from './docx-preview'

jest.mock('@hcengineering/presentation', () => ({ fetchPreviewFile: jest.fn() }))
jest.mock('@hcengineering/print', () => ({ convertToHTML: jest.fn() }))

describe('DOCX preview content', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(convertToHTML).mockResolvedValue('converted-html')
  })

  it('loads the converted storage identity through the authorized preview loader', async () => {
    const content = new Blob(['<p>Document</p>'], { type: 'text/html' })
    const response: Partial<Response> = { blob: jest.fn(async () => content) }
    jest.mocked(fetchPreviewFile).mockResolvedValue(response as Response)
    const controller = new AbortController()

    expect(await loadDocxPreview('docx', 'file.docx', 'workspace-token', controller.signal)).toBe(content)
    expect(convertToHTML).toHaveBeenCalledWith('docx', 'workspace-token')
    expect(fetchPreviewFile).toHaveBeenCalledWith('converted-html', 'file.docx', { signal: controller.signal })
  })

  it('propagates authorization failures instead of displaying the error body as HTML', async () => {
    jest.mocked(fetchPreviewFile).mockRejectedValue(new Error('File could not be loaded (HTTP 401)'))
    await expect(loadDocxPreview('docx', 'file.docx', 'workspace-token', new AbortController().signal)).rejects.toThrow(
      'HTTP 401'
    )
  })

  it('does not fetch a stale conversion after the viewer is destroyed', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(loadDocxPreview('docx', 'file.docx', 'workspace-token', controller.signal)).rejects.toThrow()
    expect(fetchPreviewFile).not.toHaveBeenCalled()
  })
})
