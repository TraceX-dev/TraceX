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

import type { Blob, Class, Doc, Ref } from '@hcengineering/core'
import type { DocumentExporterOptions, DocumentExportResult } from '@hcengineering/export'
import { getMetadata } from '@hcengineering/platform'
import { getClient, PDFViewer } from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'
import PrintBulkToPDF from './components/PrintBulkToPDF.svelte'
import { canExportPDF, exportBulkPDF, exportPDF, previewPDF } from './export'
import { preparePdf } from './printUtils'

jest.mock('@hcengineering/platform', () => ({ getMetadata: jest.fn() }))
jest.mock('@hcengineering/print', () => ({ __esModule: true, default: { metadata: { PrintURL: 'print-url' } } }))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: { metadata: { Token: 'token' } },
  getClient: jest.fn(),
  PDFViewer: 'PDFViewer'
}))
jest.mock('@hcengineering/ui', () => ({ showPopup: jest.fn() }))
jest.mock('./components/PrintBulkToPDF.svelte', () => ({ __esModule: true, default: 'PrintBulkToPDF' }))
jest.mock('./printUtils', () => ({ preparePdf: jest.fn() }))

const doc: Partial<Doc> = { _id: 'document' as Ref<Doc>, _class: 'test:class:Document' as Ref<Class<Doc>> }
const client: Partial<ReturnType<typeof getClient>> = {}
const options: DocumentExporterOptions = { format: 'pdf', orientation: 'landscape' }
const file: DocumentExportResult = { file: 'pdf' as Ref<Blob>, name: 'Document.pdf', contentType: 'application/pdf' }

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)
  jest.mocked(getMetadata).mockReturnValue('token')
  jest.mocked(preparePdf).mockResolvedValue({ blobId: 'pdf', title: 'Document.pdf' })
})

it('prepares a signed PDF without downloading or opening a popup', async () => {
  await expect(exportPDF(doc as Doc, options, { signed: true })).resolves.toEqual(file)
  expect(preparePdf).toHaveBeenCalledWith(client, doc, 'token', true, { orientation: 'landscape' })
  expect(showPopup).not.toHaveBeenCalled()
})

it('opens the PDF viewer through its own resource', async () => {
  await previewPDF(file)
  expect(showPopup).toHaveBeenCalledWith(
    PDFViewer,
    {
      file: 'pdf',
      name: 'Document.pdf',
      contentType: 'application/pdf',
      showIcon: false
    },
    'float'
  )
})

it('opens the existing bulk progress with shared orientation and signing', async () => {
  const objects: Doc[] = [doc as Doc, doc as Doc]
  await exportBulkPDF(objects, options, { signed: true })
  expect(showPopup).toHaveBeenCalledWith(PrintBulkToPDF, { objects, signed: true, orientation: 'landscape' }, 'float')
  expect(preparePdf).not.toHaveBeenCalled()
})

it('checks only the print service configuration', async () => {
  jest.mocked(getMetadata).mockReturnValueOnce(undefined)
  await expect(canExportPDF()).resolves.toBe(false)
  jest.mocked(getMetadata).mockReturnValueOnce('http://print.local')
  await expect(canExportPDF()).resolves.toBe(true)
})

it('does not sign a PDF when no action parameters were supplied', async () => {
  await exportPDF(doc as Doc, options)
  expect(preparePdf).toHaveBeenCalledWith(client, doc, 'token', false, { orientation: 'landscape' })
})

it('keeps unsigned bulk export as the default', async () => {
  const objects: Doc[] = [doc as Doc, doc as Doc]
  await exportBulkPDF(objects, options)
  expect(showPopup).toHaveBeenCalledWith(PrintBulkToPDF, { objects, signed: false, orientation: 'landscape' }, 'float')
})
