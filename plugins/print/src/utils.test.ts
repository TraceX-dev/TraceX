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

import { type Doc, type Ref, type Class } from '@hcengineering/core'
import { getMetadata } from '@hcengineering/platform'
import { printToPDF } from './utils'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getMetadata: jest.fn()
}))

const doc: Partial<Doc> = { _id: 'document' as Ref<Doc>, _class: 'test:class:Document' as Ref<Class<Doc>> }
describe('PDF export requests', () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch')

  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getMetadata).mockReturnValue('http://print.local')
    const response: Partial<Response> = { ok: true, json: jest.fn(async () => ({ id: 'pdf' })) }
    fetchMock.mockResolvedValue(response as Response)
  })

  afterAll(() => {
    fetchMock.mockRestore()
  })

  it('passes the page orientation and content mode to the authenticated endpoint', async () => {
    await expect(printToPDF(doc as Doc, 'test-token', { orientation: 'landscape', contentOnly: true })).resolves.toBe(
      'pdf'
    )
    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(url.searchParams.get('objectId')).toBe('document')
    expect(url.searchParams.get('orientation')).toBe('landscape')
    expect(url.searchParams.get('contentOnly')).toBe('true')
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
      Authorization: 'Bearer test-token',
      Accept: 'application/json'
    })
  })

  it('keeps full-document export as the default', async () => {
    await printToPDF(doc as Doc, 'test-token')
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.has('contentOnly')).toBe(false)
  })

  it('does not issue an unauthenticated request', async () => {
    await expect(printToPDF(doc as Doc, '')).resolves.toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
