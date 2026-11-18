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

import type { Class, Doc, ModelDb, Ref } from '@hcengineering/core'
import type { DocumentExporter } from '@hcengineering/export'
import type { IntlString } from '@hcengineering/platform'
import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { canExport, loadDocumentExporters } from './exporters'

jest.mock('@hcengineering/export', () => ({ __esModule: true, default: { class: { DocumentExporter: 'exporters' } } }))
jest.mock('@hcengineering/platform', () => ({ getResource: jest.fn() }))
jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('../download', () => ({}))

const doc: Partial<Doc> = { _id: 'document' as Ref<Doc>, _class: 'test:class:Document' as Ref<Class<Doc>> }
const custom: Partial<DocumentExporter> = {
  _id: 'custom' as Ref<DocumentExporter>,
  format: 'custom',
  label: 'Custom' as IntlString,
  export: 'generate' as DocumentExporter['export'],
  supportsOrientation: false,

  order: 10
}
const conditional: Partial<DocumentExporter> = {
  ...custom,
  _id: 'conditional' as Ref<DocumentExporter>,
  format: 'conditional',
  order: 20,
  isAvailable: 'check' as DocumentExporter['isAvailable'],
  bulkExport: 'bulk' as DocumentExporter['bulkExport']
}
const registrations: DocumentExporter[] = []
const findAll = jest.fn()
const model: Partial<ModelDb> = { findAllSync: findAll }
const client: Partial<ReturnType<typeof getClient>> = {
  getModel: jest.fn(() => model as ReturnType<ReturnType<typeof getClient>['getModel']>)
}
const check = jest.fn(async () => true)

beforeEach(() => {
  jest.clearAllMocks()
  findAll.mockImplementation(() => [...registrations])
  registrations.splice(0, registrations.length, conditional as DocumentExporter, custom as DocumentExporter)
  jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)
  jest.mocked(getResource).mockResolvedValue(check)
  check.mockResolvedValue(true)
})

it('discovers arbitrary formats and orders their model registrations', async () => {
  const states = await loadDocumentExporters([doc as Doc])
  expect(states.map(({ exporter }) => exporter.format)).toEqual(['custom', 'conditional'])
  expect(states.every(({ available }) => available)).toBe(true)
  expect(check).toHaveBeenCalledWith(doc)
})

it('keeps unavailable formats in the list for disabled dropdown options', async () => {
  check.mockResolvedValueOnce(false)
  const states = await loadDocumentExporters([doc as Doc])
  expect(states.map(({ available }) => available)).toEqual([true, false])
})

it('requires a bulk resource and checks every selected document', async () => {
  const second: Partial<Doc> = { ...doc, _id: 'second' as Ref<Doc> }
  check.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  const states = await loadDocumentExporters([doc as Doc, second as Doc])
  expect(states.map(({ available }) => available)).toEqual([false, false])
  expect(check).toHaveBeenCalledTimes(2)
})

it('isolates a failed availability resource from other exporters', async () => {
  jest.mocked(getResource).mockRejectedValueOnce(new Error('Resource unavailable'))
  await expect(canExport(doc as Doc)).resolves.toBe(true)
  const states = await loadDocumentExporters([doc as Doc])
  expect(states).toHaveLength(2)
})

it('hides the action for empty selections or when no exporter is available', async () => {
  await expect(canExport()).resolves.toBe(false)
  await expect(canExport([])).resolves.toBe(false)
  registrations.splice(0)
  await expect(canExport(doc as Doc)).resolves.toBe(false)
})
