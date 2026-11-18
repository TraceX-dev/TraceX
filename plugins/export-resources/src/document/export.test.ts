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

import type { Blob, Class, Doc, ModelDb, Ref } from '@hcengineering/core'
import type { DocumentExporter, DocumentExportResult, DocumentExportSettingsValues } from '@hcengineering/export'
import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'
import type { ComponentProps } from 'svelte'
import DocumentExportSettings from './components/DocumentExportSettings.svelte'
import { exportDocuments } from './export'
import { downloadDocumentResult, reportExportError } from './exporters'

jest.mock('@hcengineering/export', () => ({ __esModule: true, default: {} }))
jest.mock('@hcengineering/platform', () => ({ getResource: jest.fn() }))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({ showPopup: jest.fn() }))
jest.mock('./components/DocumentExportSettings.svelte', () => ({ __esModule: true, default: 'DocumentExportSettings' }))
jest.mock('./exporters', () => ({ downloadDocumentResult: jest.fn(), reportExportError: jest.fn() }))

const doc: Partial<Doc> = { _id: 'document' as Ref<Doc>, _class: 'test:class:Document' as Ref<Class<Doc>> }
const exporter: Partial<DocumentExporter> = {
  _id: 'custom-exporter' as Ref<DocumentExporter>,
  format: 'custom',
  export: 'generate' as DocumentExporter['export'],
  supportsOrientation: true,
  preview: 'preview' as DocumentExporter['preview'],
  bulkExport: 'bulk' as DocumentExporter['bulkExport']
}
const selection: DocumentExportSettingsValues = {
  exporter: exporter._id as Ref<DocumentExporter>,
  orientation: 'landscape',
  preview: true
}
const result: DocumentExportResult = {
  file: 'file' as Ref<Blob>,
  name: 'Document.custom',
  contentType: 'application/custom'
}
const generate = jest.fn(async (): Promise<DocumentExportResult> => result)
const preview = jest.fn(async () => {})
const bulk = jest.fn(async () => {})
const getObject = jest.fn()
const model: Partial<ModelDb> = { getObject }
const client: Partial<ReturnType<typeof getClient>> = {
  getModel: jest.fn(() => model as ReturnType<ReturnType<typeof getClient>['getModel']>)
}
const event = new Event('click')
const params: Record<string, unknown> = { customOption: 'value', additional: { enabled: true } }

function settingsProps (): ComponentProps<DocumentExportSettings> {
  const props: ComponentProps<DocumentExportSettings> | undefined = jest.mocked(showPopup).mock.calls[0]?.[1]
  if (props === undefined) throw new Error('Settings were not opened')
  return props
}

async function close (settings?: DocumentExportSettingsValues): Promise<void> {
  const callback = jest.mocked(showPopup).mock.calls[0]?.[3]
  if (callback === undefined) throw new Error('No close callback')
  await callback(settings)
}

async function confirm (settings: DocumentExportSettingsValues = selection): Promise<void> {
  if (await settingsProps().onSubmit(settings)) await close(settings)
}

beforeEach(() => {
  jest.clearAllMocks()
  getObject.mockReturnValue(exporter)
  jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)
  jest.mocked(getResource).mockImplementation(async (resource) => {
    if (resource === exporter.export) return generate
    if (resource === exporter.preview) return preview
    if (resource === exporter.bulkExport) return bulk
    throw new Error('Unexpected resource')
  })
  generate.mockResolvedValue(result)
})

it('opens settings without generating a file', async () => {
  await exportDocuments(doc as Doc, event)
  expect(showPopup).toHaveBeenCalledWith(
    DocumentExportSettings,
    expect.objectContaining({ objects: [doc] }),
    'center',
    expect.any(Function)
  )
  expect(generate).not.toHaveBeenCalled()
})

it('uses a registered custom format and waits for generation before closing settings', async () => {
  let finish: (value: DocumentExportResult) => void = () => {
    throw new Error('Not started')
  }
  generate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  await exportDocuments(doc as Doc, event, params)
  const submission = settingsProps().onSubmit(selection)
  await Promise.resolve()
  expect(generate).toHaveBeenCalledWith(doc, { format: 'custom', orientation: 'landscape' }, params)
  expect(preview).not.toHaveBeenCalled()
  finish(result)
  await expect(submission).resolves.toBe(true)
  expect(preview).not.toHaveBeenCalled()
  await close(selection)
  expect(preview).toHaveBeenCalledWith(result)
  expect(downloadDocumentResult).not.toHaveBeenCalled()
})

it('does not show a late result when the user closes settings during generation', async () => {
  let finish: (value: DocumentExportResult) => void = () => {
    throw new Error('Not started')
  }
  generate.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  await exportDocuments(doc as Doc, event)
  const submission = settingsProps().onSubmit(selection)
  await close()
  finish(result)
  await submission
  expect(preview).not.toHaveBeenCalled()
  expect(downloadDocumentResult).not.toHaveBeenCalled()
})

it('downloads after settings close when preview is disabled', async () => {
  await exportDocuments(doc as Doc, event)
  const settings: DocumentExportSettingsValues = { ...selection, preview: false }
  await confirm(settings)
  expect(downloadDocumentResult).toHaveBeenCalledWith(result)
  expect(preview).not.toHaveBeenCalled()
})

it('downloads formats without a preview resource and normalizes capabilities', async () => {
  const contentExporter: Partial<DocumentExporter> = {
    ...exporter,
    supportsOrientation: false,
    preview: undefined
  }
  getObject.mockReturnValue(contentExporter)
  await exportDocuments(doc as Doc, event)
  await confirm()
  expect(generate).toHaveBeenCalledWith(doc, { format: 'custom', orientation: undefined }, {})
  expect(downloadDocumentResult).toHaveBeenCalledWith(result)
})

it('keeps settings open on failure and allows another attempt', async () => {
  const failure = new Error('Generation failed')
  generate.mockRejectedValueOnce(failure)
  await exportDocuments(doc as Doc, event)
  await expect(settingsProps().onSubmit(selection)).resolves.toBe(false)
  expect(reportExportError).toHaveBeenCalledWith(failure)
  expect(preview).not.toHaveBeenCalled()
  await confirm()
  expect(generate).toHaveBeenCalledTimes(2)
  expect(preview).toHaveBeenCalledWith(result)
})

it('starts bulk only from the settings close callback', async () => {
  const objects: Doc[] = [doc as Doc, doc as Doc]
  await exportDocuments(objects, event, params)
  await expect(settingsProps().onSubmit(selection)).resolves.toBe(true)
  expect(bulk).not.toHaveBeenCalled()
  expect(generate).not.toHaveBeenCalled()
  await close(selection)
  expect(bulk).toHaveBeenCalledWith(objects, { format: 'custom', orientation: 'landscape' }, params)
  expect(preview).not.toHaveBeenCalled()
})

it('rejects bulk for an exporter without a bulk resource', async () => {
  const single: Partial<DocumentExporter> = { ...exporter, bulkExport: undefined }
  getObject.mockReturnValue(single)
  await exportDocuments([doc as Doc, doc as Doc], event)
  await expect(settingsProps().onSubmit(selection)).resolves.toBe(false)
  expect(generate).not.toHaveBeenCalled()
})

it('reports preview loading failures', async () => {
  await exportDocuments(doc as Doc, event)
  await settingsProps().onSubmit(selection)
  const failure = new Error('Preview unavailable')
  jest.mocked(getResource).mockRejectedValueOnce(failure)
  await close(selection)
  expect(reportExportError).toHaveBeenCalledWith(failure)
})

it('ignores empty selections', async () => {
  await exportDocuments([], event)
  expect(showPopup).not.toHaveBeenCalled()
})
