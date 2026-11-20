// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import core, {
  type Class,
  type Doc,
  type Hierarchy,
  type ModelDb,
  type Ref,
  type Space,
  type TxOperations
} from '@hcengineering/core'
import marketplace, {
  createDefinitionPackageRelease,
  serializeDefinitionPackageRelease,
  withDefinitionPackageDependencies,
  type DefinitionPackageDependency,
  type DefinitionPackageInstallation,
  type DefinitionPackageRelease
} from '@hcengineering/marketplace'
import { installDefinitionPackage, reviewDefinitionPackageUpdate, updateDefinitionPackage } from '../installations'

let mockClient: TxOperations
const mockDownload = jest.fn()
jest.mock('@hcengineering/presentation', () => ({ getClient: () => mockClient }))
jest.mock('../catalog', () => ({ getMarketplaceClient: () => ({ download: mockDownload }) }))

const source = `version: 2
kind: card
cardTypes:
  purchase:
    label: Purchase
    extends: card:class:Card
    kind: 0
    fields:
      amount: {name: amount, label: Amount, type: number}
`

function workspace (): { documents: Doc[], apply: jest.Mock, createDoc: jest.Mock, commit: jest.Mock } {
  const documents: Doc[] = []
  const model: {
    findObject: (id: string) => Doc | undefined
    findAllSync: (clazz: string, query: Record<string, unknown>) => Doc[]
  } = {
    findObject: (id) => documents.find((doc) => doc._id === id && doc.space === core.space.Model),
    findAllSync: (clazz, query) =>
      documents.filter(
        (doc) => doc._class === clazz && Object.entries(query).every(([key, value]) => Reflect.get(doc, key) === value)
      )
  }
  const hierarchy: Pick<Hierarchy, 'isDerived' | 'findAttribute'> = {
    isDerived: (actual, expected) => actual === expected,
    findAttribute: () => undefined
  }
  const pending: Doc[] = []
  const createDoc = jest.fn(
    async (clazz: Ref<Class<Doc>>, space: Ref<Space>, data: Record<string, unknown>, id: Ref<Doc>) => {
      const doc: Doc = { ...data, _id: id, _class: clazz, space, modifiedOn: 1, modifiedBy: core.account.System }
      pending.push(doc)
    }
  )
  const commit = jest.fn(async () => {
    documents.push(...pending.splice(0))
    return { result: true }
  })
  const apply: jest.Mock = jest.fn(() => ({
    createDoc,
    commit,
    match: jest.fn(),
    notMatch: jest.fn(),
    updateDoc: jest.fn(),
    removeDoc: jest.fn()
  }))
  const findOne: jest.Mock = jest.fn(async (clazz: string, query: Record<string, unknown>) =>
    documents.find((doc) => doc._class === clazz && doc._id === query._id)
  )
  const findAll: jest.Mock = jest.fn(async () => [])
  const client: Partial<TxOperations> = {
    getModel: () => model as unknown as ModelDb,
    getHierarchy: () => hierarchy as Hierarchy,
    findOne,
    findAll,
    apply
  }
  mockClient = client as TxOperations
  return { documents, apply, createDoc, commit }
}

async function artifact (
  version = '1.0.0'
): Promise<{ parent: DefinitionPackageRelease, child: DefinitionPackageRelease }> {
  const child = await createDefinitionPackageRelease({
    package: { id: 'vendor/review', version: '2.0.0', author: 'vendor' },
    source:
      'version: 2\nkind: process\nprocesses:\n  review:\n    label: Review\n    slots:\n      amount: {type: number}\n    states:\n      done: {}\n'
  })
  const dependency: DefinitionPackageDependency = {
    id: child.package.id,
    author: child.package.author as DefinitionPackageDependency['author'],
    version: child.package.version,
    contentHash: child.contentHash,
    destinations: {
      review: {
        masterTag: '$parent.purchase' as DefinitionPackageDependency['destinations'][string]['masterTag'],
        bindings: { amount: 'amount' }
      }
    }
  }
  const parent = await createDefinitionPackageRelease({
    package: { id: 'acme/purchase', author: 'author', version },
    source: withDefinitionPackageDependencies(source, { approval: dependency })
  })
  return { parent, child }
}

describe('package dependency workspace writes', () => {
  beforeEach(() => mockDownload.mockReset())

  it('creates parent definitions, child graphs and separate installation records in a single batch', async () => {
    const ws = workspace()
    const { parent, child } = await artifact()
    mockDownload.mockResolvedValue(serializeDefinitionPackageRelease(child))
    const id = await installDefinitionPackage(parent, {})
    expect(ws.apply).toHaveBeenCalledTimes(1)
    expect(ws.commit).toHaveBeenCalledTimes(1)
    const records = ws.documents.filter(
      (doc) => doc._class === marketplace.class.DefinitionPackageInstallation
    ) as DefinitionPackageInstallation[]
    expect(records).toHaveLength(2)
    const root = records.find((record) => record._id === id)
    expect(root?.package).toEqual(parent.package)
    expect(root?.dependencies).toEqual({ approval: records[1]._id })
    expect(records[1].package).toEqual(child.package)
    expect(mockDownload).toHaveBeenCalledWith(
      expect.objectContaining({ id: child.package.id, author: child.package.author }),
      '2.0.0'
    )
    expect(
      ws.createDoc.mock.calls.filter(([clazz]) => clazz === marketplace.class.DefinitionPackageInstallation)
    ).toHaveLength(2)
  })

  it('writes nothing when a nested release is inaccessible or does not match its pinned hash', async () => {
    const ws = workspace()
    const { parent, child } = await artifact()
    mockDownload.mockRejectedValueOnce(new Error('Dependency not accessible'))
    await expect(installDefinitionPackage(parent, {})).rejects.toThrow('not accessible')
    expect(ws.apply).not.toHaveBeenCalled()
    const changed = await createDefinitionPackageRelease({
      package: child.package,
      source: child.source.replace('label: Review', 'label: Changed')
    })
    mockDownload.mockResolvedValue(serializeDefinitionPackageRelease(changed))
    await expect(installDefinitionPackage(parent, {})).rejects.toThrow('locked author, ID, version and hash')
    expect(ws.apply).not.toHaveBeenCalled()
    expect(ws.documents).toHaveLength(0)
  })

  it('rejects a changed child installation snapshot before applying the reviewed update', async () => {
    const ws = workspace()
    const { parent, child } = await artifact()
    mockDownload.mockResolvedValue(serializeDefinitionPackageRelease(child))
    const id = await installDefinitionPackage(parent, {})
    const root = ws.documents.find((doc) => doc._id === id) as DefinitionPackageInstallation
    const incoming = (await artifact('1.0.1')).parent
    ws.apply.mockClear()
    const preview = await reviewDefinitionPackageUpdate(root, incoming, {}, {})
    const nested = ws.documents.find((doc) => doc._id === root.dependencies?.approval)
    if (nested === undefined) throw new Error('Missing child installation')
    nested.modifiedOn = 2
    await expect(updateDefinitionPackage(root, incoming, {}, {}, preview.fingerprint)).rejects.toThrow(
      'Local definitions changed'
    )
    expect(ws.apply).not.toHaveBeenCalled()
  })
})
