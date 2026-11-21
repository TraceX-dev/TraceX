// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import card, { type MasterTag } from '@hcengineering/card'
import type { AccountUuid, Doc, FindResult, Ref, WorkspaceUuid } from '@hcengineering/core'
import type {
  DefinitionPackageInfo,
  DefinitionPackageOwner,
  DefinitionPackageRelease
} from '@hcengineering/marketplace'
import { getEmbeddedLabel } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import process, { type Process } from '@hcengineering/process'
import { getCurrentResolvedLocation, type Location } from '@hcengineering/ui'
import { createPackageOrigin, findLocalPackageOrigin } from '../package-origin'

jest.mock('@hcengineering/presentation', () => ({
  getClient: jest.fn(),
  getCurrentWorkspaceUuid: () => '44371923-5983-4ab0-ac89-82f481836724' as WorkspaceUuid
}))
jest.mock('@hcengineering/ui', () => ({ getCurrentResolvedLocation: jest.fn() }))
const documents = new Map<string, Doc>()
const model: Partial<ReturnType<ReturnType<typeof getClient>['getModel']>> = {
  findObject: <T extends Doc>(id: Ref<T>): T | undefined => documents.get(id) as T | undefined,
  findAllSync: <T extends Doc>(): FindResult<T> => {
    const result = [...documents.values()]
    return result as FindResult<T>
  }
}
const client: Partial<ReturnType<typeof getClient>> = {
  getModel: () => model as ReturnType<ReturnType<typeof getClient>['getModel']>
}
const root: Partial<MasterTag> = {
  _id: 'source-root' as Ref<MasterTag>,
  _class: card.class.MasterTag,
  extends: card.class.Card,
  label: getEmbeddedLabel('Requests')
}
const tag: Partial<MasterTag> = {
  _id: 'source-tag' as Ref<MasterTag>,
  _class: card.class.Tag,
  extends: root._id,
  label: getEmbeddedLabel('Approvals')
}
const workflow: Partial<Process> = {
  _id: 'source-process' as Ref<Process>,
  _class: process.class.Process,
  masterTag: tag._id,
  name: 'Review request'
}

beforeEach(() => {
  documents.clear()
  documents.set(String(root._id), root as MasterTag)
  documents.set(String(tag._id), tag as MasterTag)
  documents.set(String(workflow._id), workflow as Process)
  jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)
  const location: Location = { path: ['workbench', 'source-workspace', 'setting', 'types', 'source-tag'] }
  jest.mocked(getCurrentResolvedLocation).mockReturnValue(location)
})

it('retains the complete card type and nested tag breadcrumb with a direct settings link', async () => {
  expect(await createPackageOrigin(tag as DefinitionPackageOwner)).toEqual({
    workspace: '44371923-5983-4ab0-ac89-82f481836724',
    path: ['setting', 'types', 'source-tag'],
    labels: ['Requests', 'Approvals']
  })
  expect((await createPackageOrigin(root as DefinitionPackageOwner)).labels).toEqual(['Requests'])
})

it('links a process to its own type and editor rather than the currently selected package owner', async () => {
  const location: Location = {
    path: [
      'workbench',
      'source-workspace',
      'setting',
      'types',
      'another-type',
      'process:component:ProcessEditor',
      'another-process'
    ]
  }
  jest.mocked(getCurrentResolvedLocation).mockReturnValue(location)
  expect(await createPackageOrigin(workflow as DefinitionPackageOwner)).toEqual({
    workspace: '44371923-5983-4ab0-ac89-82f481836724',
    path: ['setting', 'types', 'source-tag', 'process:component:ProcessEditor', 'source-process'],
    labels: ['Requests', 'Approvals', 'Review request']
  })
})

it('recovers uploaded file provenance from exact live package membership and never guesses from YAML labels', async () => {
  const info: DefinitionPackageInfo = {
    id: 'test/package',
    version: '1.0.0',
    author: '267c1923-5983-4ab0-ac89-82f481836724' as AccountUuid
  }
  const local: Partial<DefinitionPackageOwner> = { ...tag, definitionPackage: info }
  documents.set(String(tag._id), local as DefinitionPackageOwner)
  const release: Partial<DefinitionPackageRelease> = { package: info }
  expect((await findLocalPackageOrigin(release as DefinitionPackageRelease))?.labels).toEqual(['Requests', 'Approvals'])
  const differentVersion: Partial<DefinitionPackageRelease> = { package: { ...info, version: '1.0.1' } }
  expect(await findLocalPackageOrigin(differentVersion as DefinitionPackageRelease)).toBeUndefined()
})
