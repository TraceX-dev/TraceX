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

import type { Class, Doc, Ref } from '@hcengineering/core'
import type { DocumentContentTarget } from '@hcengineering/export'
import { getMetadata } from '@hcengineering/platform'
import { getDocTitle } from '@hcengineering/view-resources'
import { addNotification, NotificationSeverity, withProgress } from '@hcengineering/ui'
import ExportNotification from '../components/ExportNotification.svelte'
import { downloadBlob } from '../download'
import { exportContent, exportDocumentContent } from './actions'

jest.mock('@hcengineering/core', () => ({ makeDocCollabId: jest.fn() }))
jest.mock('@hcengineering/attachment', () => ({ __esModule: true, default: {} }))
jest.mock('@hcengineering/collaborator-client', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/export', () => ({
  __esModule: true,
  default: {
    metadata: { ExportUrl: 'export-url' },
    string: {
      ExportingDocumentContent: 'exporting',
      DocumentContentExported: 'done',
      DocumentContentExportFailed: 'failed'
    }
  }
}))
jest.mock('@hcengineering/platform', () => ({
  getMetadata: jest.fn(),
  getResource: jest.fn(),
  setPlatformStatus: jest.fn(),
  unknownError: jest.fn(),
  translate: jest.fn(async () => 'Export')
}))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: { metadata: { Token: 'token' } },
  getClient: jest.fn()
}))
jest.mock('@hcengineering/view-resources', () => ({ getDocTitle: jest.fn() }))
jest.mock('@hcengineering/text', () => ({ jsonToMarkup: jest.fn() }))
jest.mock('@hcengineering/theme', () => ({ getCurrentLanguage: () => 'en' }))
jest.mock('@hcengineering/ui', () => ({
  showPopup: jest.fn(),
  addNotification: jest.fn(),
  NotificationSeverity: { Error: 'error' },
  withProgress: jest.fn(async (_labels: unknown, job: () => Promise<unknown>) => await job())
}))
jest.mock('../download', () => ({ downloadBlob: jest.fn(), fileNameFromResponse: jest.fn(() => 'document.docx') }))
jest.mock('./components/DocumentImportDiffPopup.svelte', () => ({ __esModule: true, default: {} }))
jest.mock('../components/ExportNotification.svelte', () => ({ __esModule: true, default: 'ExportNotification' }))

const doc: DocumentContentTarget = { _id: 'document' as Ref<Doc>, _class: 'test:class:Document' as Ref<Class<Doc>> }
const fetchMock = jest.spyOn(globalThis, 'fetch')

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getDocTitle).mockResolvedValue('Provider title')
  jest.mocked(getMetadata).mockImplementation((key) => (key === 'export-url' ? 'http://export.local' : 'test-token'))
  const response: Partial<Response> = { ok: true, blob: jest.fn(async () => new Blob(['document'])) }
  fetchMock.mockResolvedValue(response as Response)
})
afterAll(() => {
  fetchMock.mockRestore()
})

it('sends unified Word options and downloads only after a successful response', async () => {
  await expect(exportDocumentContent(doc, 'docx', { orientation: 'landscape' })).resolves.toBe(true)
  expect(fetchMock.mock.calls[0][0]).toBe('http://export.local/document-export')
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
    _id: 'document',
    _class: 'test:class:Document',
    format: 'docx',
    orientation: 'landscape'
  })
  expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'document.docx')
  expect(withProgress).not.toHaveBeenCalled()
  expect(addNotification).not.toHaveBeenCalled()
})

it('preserves the existing body-only behavior when no options are supplied', async () => {
  await exportDocumentContent(doc, 'md')
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
    _id: 'document',
    _class: 'test:class:Document',
    format: 'md'
  })
})

it('reports conversion failure without downloading an invalid response', async () => {
  const response: Partial<Response> = {
    ok: false,
    status: 400,
    json: jest.fn(async () => ({ message: 'Unsupported content' }))
  }
  fetchMock.mockResolvedValue(response as Response)
  await expect(exportDocumentContent(doc, 'docx')).resolves.toBe(false)
  expect(downloadBlob).not.toHaveBeenCalled()
  expect(addNotification).toHaveBeenCalledTimes(1)
  expect(addNotification).toHaveBeenCalledWith(
    'Export',
    'Unsupported content',
    ExportNotification,
    undefined,
    NotificationSeverity.Error
  )
})

it('returns converted content to the registered exporter without downloading it', async () => {
  const result = await exportContent(doc as Doc, { format: 'md' })
  expect(result.file).toBeInstanceOf(Blob)
  expect(downloadBlob).not.toHaveBeenCalled()
  expect(addNotification).not.toHaveBeenCalled()
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
    _id: 'document',
    _class: 'test:class:Document',
    format: 'md',
    title: 'Provider title'
  })
})

it('propagates registered exporter failures to the common dialog', async () => {
  const response: Partial<Response> = {
    ok: false,
    status: 400,
    json: jest.fn(async () => ({ message: 'Unsupported content' }))
  }
  fetchMock.mockResolvedValue(response as Response)
  await expect(exportContent(doc as Doc, { format: 'docx' })).rejects.toThrow('Unsupported content')
  expect(addNotification).not.toHaveBeenCalled()
  expect(downloadBlob).not.toHaveBeenCalled()
})
