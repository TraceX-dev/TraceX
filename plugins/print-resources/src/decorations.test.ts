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

import core, { type Class, type Client, type Doc, type Ref } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import print, { type PrintConfiguration } from '@hcengineering/print'
import type { TemplateDataProvider, TemplateField } from '@hcengineering/templates'
import { loadPrintDecoration, printedObjectTitle, validatePrintText } from './decorations'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn()
}))
jest.mock('@hcengineering/print', () => jest.requireActual('../../print/src/index'))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: { metadata: { WorkspaceName: 'workspace' } }
}))
jest.mock('@hcengineering/ui', () => ({ getCurrentLocation: () => ({ path: ['print', 'workspace'] }) }))

it('rejects unknown fields without depending on a particular document', async () => {
  const field: Partial<TemplateField> = { _id: print.templateField.Title }
  const client: Partial<Client> = { findAll: jest.fn().mockResolvedValue([field]) }
  await expect(
    validatePrintText(client as Client, ['${' + print.templateField.Title + '}', ''])
  ).resolves.toBeUndefined()
  await expect(validatePrintText(client as Client, [`\${unknown:field}`])).rejects.toThrow('Unknown template field')
})

it('reads the exact print title, including quotes and version-looking text', async () => {
  const data: { title: string } = { title: 'Manual "A" <B> v2.0' }
  const provider: Partial<TemplateDataProvider> = { get: jest.fn().mockReturnValue(data) }
  await expect(printedObjectTitle(provider as TemplateDataProvider)).resolves.toBe(data.title)
  expect(provider.get).toHaveBeenCalledWith(core.class.Doc)
})

it('does not load decorations for classes without the capability', async () => {
  const hierarchy: Partial<ReturnType<Client['getHierarchy']>> = {
    classHierarchyMixin: jest.fn().mockReturnValue(undefined)
  }
  const client: Partial<Client> = { getHierarchy: jest.fn().mockReturnValue(hierarchy), findOne: jest.fn() }
  const document: Partial<Doc> = {}
  await expect(loadPrintDecoration(client as Client, document as Doc)).resolves.toBeUndefined()
  expect(client.findOne).not.toHaveBeenCalled()
  expect(getResource).not.toHaveBeenCalled()
})

it('suppresses decorations for a disabled class configuration before resolving any fields', async () => {
  const target = 'test:class:Card' as Ref<Class<Doc>>
  const disabled: Partial<PrintConfiguration> = { targetClass: target, enabled: false }
  const hierarchy: Partial<ReturnType<Client['getHierarchy']>> = {
    classHierarchyMixin: jest.fn().mockReturnValue({}),
    getAncestors: jest.fn().mockReturnValue([target, core.class.Doc])
  }
  const client: Partial<Client> = {
    getHierarchy: jest.fn().mockReturnValue(hierarchy),
    findAll: jest.fn().mockResolvedValue([disabled])
  }
  const object: Partial<Doc> = { _class: target }
  await expect(loadPrintDecoration(client as Client, object as Doc)).resolves.toBeUndefined()
  expect(getResource).not.toHaveBeenCalled()
})
