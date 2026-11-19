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

import card from '@hcengineering/card'
import core, { type AccountUuid, type Doc, type Hierarchy, type ModelDb, type Ref } from '@hcengineering/core'
import process, { type Process } from '@hcengineering/process'
import marketplace from '../index'
import {
  createDefinitionPackageRelease,
  parseDefinitionPackageRelease,
  serializeDefinitionPackageRelease,
  withDefinitionPackageDependencies
} from '../definition-package'
import {
  prepareDefinitionPackageTreeInstallation,
  resolveDefinitionPackageDependencies
} from '../definition-package-dependencies'
import { prepareDefinitionPackageTreeUpdate } from '../definition-package-tree-update'
import { prepareDefinitionPackageInstallation } from '../definition-package-installation'
import type { DefinitionPackageDependency, DefinitionPackageRelease } from '../definition-package-types'
import type { DefinitionPackageInstallation } from '../types'

const moduleSource = `version: 2
kind: card
cardTypes:
  purchase:
    label: Purchase
    extends: card:class:Card
    kind: 0
    fields:
      amount_field: {name: stored_amount, label: Amount, type: number}
`
const processSource = `version: 2
kind: process
processes:
  review:
    label: Review
    slots:
      amount: {type: number}
    states:
      done: {}
`

function workspace (): { docs: Doc[], model: ModelDb, hierarchy: Hierarchy } {
  const docs: Doc[] = []
  const mockModel: {
    findObject: (id: string) => Doc | undefined
    findAllSync: (clazz: string, query: Record<string, unknown>) => Doc[]
  } = {
    findObject: jest.fn((id: string) => docs.find((doc) => doc._id === id)),
    findAllSync: jest.fn((clazz: string, query: Record<string, unknown>) =>
      docs.filter(
        (doc) => doc._class === clazz && Object.entries(query).every(([key, value]) => Reflect.get(doc, key) === value)
      )
    )
  }
  const mockHierarchy: Pick<Hierarchy, 'isDerived' | 'findAttribute'> = {
    isDerived: (actual, expected) => actual === expected,
    findAttribute: (owner, name) =>
      docs.find(
        (doc) =>
          doc._class === core.class.Attribute &&
          Reflect.get(doc, 'attributeOf') === owner &&
          Reflect.get(doc, 'name') === name
      ) as ReturnType<Hierarchy['findAttribute']>
  }
  return { docs, model: mockModel as unknown as ModelDb, hierarchy: mockHierarchy as Hierarchy }
}

async function child (version = '1.0.0', source = processSource): Promise<DefinitionPackageRelease> {
  return await createDefinitionPackageRelease({
    package: { id: 'other/review', author: 'other-author', version },
    source
  })
}

function lock (release: DefinitionPackageRelease): DefinitionPackageDependency {
  return {
    id: release.package.id,
    author: release.package.author as AccountUuid,
    version: release.package.version,
    contentHash: release.contentHash,
    destinations: {
      review: { masterTag: '$parent.purchase' as Process['masterTag'], bindings: { amount: 'stored_amount' } }
    }
  }
}

async function parent (
  dependencies: Record<string, DefinitionPackageDependency>,
  version = '1.0.0'
): Promise<DefinitionPackageRelease> {
  return await createDefinitionPackageRelease({
    package: { id: 'acme/purchase', author: 'parent-author', version },
    source: withDefinitionPackageDependencies(moduleSource, dependencies)
  })
}

describe('locked package dependencies', () => {
  it('round-trips references and bindings under the parent digest without embedding child graphs', async () => {
    const dependency = await child()
    const release = await parent({ approval: lock(dependency) })
    const serialized = serializeDefinitionPackageRelease(release)
    const restored = await parseDefinitionPackageRelease(serialized)
    expect(restored.contentHash).toBe(release.contentHash)
    expect(restored.dependencies).toEqual(release.dependencies)
    expect(restored.definition.docs.some((doc) => doc._class === process.class.Process)).toBe(false)
    await expect(parseDefinitionPackageRelease(serialized.replace('stored_amount\n', 'other_field\n'))).rejects.toThrow(
      'digest'
    )
    const cleared = await createDefinitionPackageRelease({
      package: release.package,
      source: withDefinitionPackageDependencies(release.source, {})
    })
    expect(cleared.dependencies).toBeUndefined()
  })

  it('requires exact versions and hashes and rejects unsafe aliases', async () => {
    const dependency = await child()
    expect(() =>
      withDefinitionPackageDependencies(moduleSource, { review: { ...lock(dependency), version: 'latest' } })
    ).toThrow('SemVer')
    expect(() =>
      withDefinitionPackageDependencies(moduleSource, { review: { ...lock(dependency), contentHash: 'unknown' } })
    ).toThrow('SHA-256')
    expect(() => withDefinitionPackageDependencies(moduleSource, { constructor: lock(dependency) })).toThrow(
      'Reserved key'
    )
  })

  it('detects cycles before requesting the cyclic release and rejects conflicting versions', async () => {
    const dependency = await child()
    const self: DefinitionPackageDependency = {
      ...lock(dependency),
      id: 'acme/purchase',
      author: 'parent-author' as AccountUuid
    }
    const resolve = jest.fn(async () => dependency)
    await expect(resolveDefinitionPackageDependencies(await parent({ self }), resolve)).rejects.toThrow('Cyclic')
    expect(resolve).not.toHaveBeenCalled()
    const second = await child('1.0.1')
    await expect(
      resolveDefinitionPackageDependencies(await parent({ first: lock(dependency), second: lock(second) }), resolve)
    ).rejects.toThrow('Conflicting versions')
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('rejects an accessible release that differs from the selected identity or hash', async () => {
    const dependency = await child()
    const release = await parent({ review: lock(dependency) })
    const changed = await child('1.0.0', processSource.replace('label: Review', 'label: Changed'))
    await expect(resolveDefinitionPackageDependencies(release, async () => changed)).rejects.toThrow(
      'locked author, ID, version and hash'
    )
  })

  it('binds to a new parent type without touching the live model and retains separate package ownership', async () => {
    const ws = workspace()
    const dependency = await child()
    const resolved = await resolveDefinitionPackageDependencies(
      await parent({ approval: lock(dependency) }),
      async () => dependency
    )
    const prepared = await prepareDefinitionPackageTreeInstallation(
      resolved,
      {},
      'root' as Ref<DefinitionPackageInstallation>,
      ws.model,
      ws.hierarchy
    )
    expect(ws.docs).toHaveLength(0)
    expect(prepared.installations).toHaveLength(2)
    const nested = prepared.installations[1]
    expect(prepared.installation.dependencies).toEqual({ approval: nested.id })
    expect(prepared.installation.identities.review).toBeUndefined()
    expect(prepared.documents.find((doc) => doc._class === process.class.Process)).toMatchObject({
      masterTag: prepared.installation.identities.purchase,
      bindings: { amount: 'stored_amount' },
      definitionPackage: dependency.package,
      definitionPackageInstallation: { id: nested.id, member: 'review' }
    })
    expect(nested.installation.package.author).toBe('other-author')
    expect(nested.installation.destinations.review.masterTag).toBe(prepared.installation.identities.purchase)
    const again = await prepareDefinitionPackageTreeInstallation(
      resolved,
      {},
      'another-root' as Ref<DefinitionPackageInstallation>,
      ws.model,
      ws.hierarchy
    )
    const ids = new Set(prepared.documents.map((doc) => doc._id))
    expect(again.documents.every((doc) => !ids.has(doc._id))).toBe(true)
  })

  it('validates unknown parent references and incompatible field bindings before installation', async () => {
    const ws = workspace()
    const dependency = await child()
    const invalid: DefinitionPackageDependency = {
      ...lock(dependency),
      destinations: {
        review: { masterTag: '$parent.missing' as Process['masterTag'], bindings: { amount: 'stored_amount' } }
      }
    }
    const resolved = await resolveDefinitionPackageDependencies(
      await parent({ approval: invalid }),
      async () => dependency
    )
    await expect(
      prepareDefinitionPackageTreeInstallation(
        resolved,
        {},
        'root' as Ref<DefinitionPackageInstallation>,
        ws.model,
        ws.hierarchy
      )
    ).rejects.toThrow('Unknown parent member')
    const wrong: DefinitionPackageDependency = {
      ...lock(dependency),
      destinations: {
        review: { masterTag: '$parent.purchase' as Process['masterTag'], bindings: { amount: 'missing' } }
      }
    }
    const mismatched = await resolveDefinitionPackageDependencies(
      await parent({ approval: wrong }),
      async () => dependency
    )
    await expect(
      prepareDefinitionPackageTreeInstallation(
        mismatched,
        {},
        'root' as Ref<DefinitionPackageInstallation>,
        ws.model,
        ws.hierarchy
      )
    ).rejects.toThrow('compatible slot')
    expect(ws.docs).toHaveLength(0)
  })

  it('rejects incomplete resolution trees and prevents the single-package API from skipping dependencies', async () => {
    const ws = workspace()
    const dependency = await child()
    const release = await parent({ approval: lock(dependency) })
    const id = 'root' as Ref<DefinitionPackageInstallation>
    await expect(prepareDefinitionPackageInstallation(release, {}, id, ws.model, ws.hierarchy)).rejects.toThrow(
      'complete dependency tree'
    )
    await expect(
      prepareDefinitionPackageTreeInstallation({ release, dependencies: {} }, {}, id, ws.model, ws.hierarchy)
    ).rejects.toThrow('does not match')
  })

  it('reuses verified downloads while creating independent installations for repeated releases', async () => {
    const ws = workspace()
    const dependency = await child()
    const resolve = jest.fn(async () => dependency)
    const resolved = await resolveDefinitionPackageDependencies(
      await parent({ first: lock(dependency), second: lock(dependency) }),
      resolve
    )
    const prepared = await prepareDefinitionPackageTreeInstallation(
      resolved,
      {},
      'root' as Ref<DefinitionPackageInstallation>,
      ws.model,
      ws.hierarchy
    )
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(prepared.installations).toHaveLength(3)
    expect(prepared.installation.dependencies?.first).not.toBe(prepared.installation.dependencies?.second)
  })

  it('bounds the number of resolved instances before preparing any definitions', async () => {
    const dependency = await child()
    const dependencies: Record<string, DefinitionPackageDependency> = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`item_${index}`, lock(dependency)])
    )
    await expect(
      resolveDefinitionPackageDependencies(await parent(dependencies), async () => dependency)
    ).rejects.toThrow('100 instances or 16 levels')
  })

  it('installs dependencies of a nested card package in its own parent namespace', async () => {
    const ws = workspace()
    const dependency = await child()
    const inner = await parent({ approval: lock(dependency) })
    const nestedLock: DefinitionPackageDependency = {
      id: inner.package.id,
      author: inner.package.author as AccountUuid,
      version: inner.package.version,
      contentHash: inner.contentHash,
      destinations: {}
    }
    const outer = await createDefinitionPackageRelease({
      package: { id: 'acme/outer', version: '1.0.0', author: 'parent-author' },
      source: withDefinitionPackageDependencies(moduleSource, { inner: nestedLock })
    })
    const resolved = await resolveDefinitionPackageDependencies(outer, async (item) =>
      item.id === inner.package.id ? inner : dependency
    )
    const prepared = await prepareDefinitionPackageTreeInstallation(
      resolved,
      {},
      'outer' as Ref<DefinitionPackageInstallation>,
      ws.model,
      ws.hierarchy
    )
    expect(prepared.installations).toHaveLength(3)
    expect(prepared.documents.find((doc) => doc._class === process.class.Process)).toMatchObject({
      masterTag: prepared.installations[1].installation.identities.purchase
    })
    expect(prepared.documents.filter((doc) => doc._class === card.class.MasterTag)).toHaveLength(2)
  })
})

describe('dependency updates', () => {
  async function installed (): Promise<
    ReturnType<typeof workspace> & {
      root: DefinitionPackageInstallation
      records: Map<string, DefinitionPackageInstallation>
      dependency: DefinitionPackageRelease
    }
  > {
    const ws = workspace()
    const dependency = await child()
    const resolved = await resolveDefinitionPackageDependencies(
      await parent({ approval: lock(dependency) }),
      async () => dependency
    )
    const prepared = await prepareDefinitionPackageTreeInstallation(
      resolved,
      {},
      'root' as Ref<DefinitionPackageInstallation>,
      ws.model,
      ws.hierarchy
    )
    ws.docs.push(...prepared.documents)
    const records = new Map<string, DefinitionPackageInstallation>(
      prepared.installations.map(({ id, installation }) => {
        const record: DefinitionPackageInstallation = {
          _id: id,
          _class: marketplace.class.DefinitionPackageInstallation,
          space: core.space.Configuration,
          modifiedOn: 1,
          modifiedBy: core.account.System,
          ...installation
        }
        return [id, record]
      })
    )
    const root = records.get('root')
    if (root === undefined) throw new Error('Missing root fixture')
    return { ...ws, root, records, dependency }
  }

  it('upgrades a locked child in place and preserves its independent local changes', async () => {
    const ws = await installed()
    const currentChild = [...ws.records.values()].find((record) => record.package.id === 'other/review')
    if (currentChild === undefined) throw new Error('Missing child fixture')
    const proc = ws.docs.find((doc) => doc._id === currentChild.identities.review)
    if (proc === undefined) throw new Error('Missing process fixture')
    Reflect.set(proc, 'description', 'Local customization')
    const incomingChild = await child('1.0.1', processSource.replace('label: Review', 'label: Published review'))
    const resolved = await resolveDefinitionPackageDependencies(
      await parent({ approval: lock(incomingChild) }, '1.0.1'),
      async () => incomingChild
    )
    const plan = await prepareDefinitionPackageTreeUpdate(ws.root, resolved, {}, {}, ws.records, ws.model, ws.hierarchy)
    expect(plan.blocked).toBe(false)
    expect(plan.installations[1].id).toBe(currentChild._id)
    expect(plan.installations[1].installation.package.version).toBe('1.0.1')
    expect(plan.documents.find((doc) => doc._id === proc._id)).toMatchObject({
      name: 'Published review',
      description: 'Local customization'
    })
    expect(plan.changes.some((change) => change.key.startsWith('dependency:'))).toBe(true)
    const again = await prepareDefinitionPackageTreeUpdate(
      ws.root,
      resolved,
      {},
      {},
      ws.records,
      ws.model,
      ws.hierarchy
    )
    expect(again.fingerprint).toBe(plan.fingerprint)
    Reflect.set(proc, 'modifiedOn', 2)
    const raced = await prepareDefinitionPackageTreeUpdate(
      ws.root,
      resolved,
      {},
      {},
      ws.records,
      ws.model,
      ws.hierarchy
    )
    expect(raced.fingerprint).not.toBe(plan.fingerprint)
  })

  it('removes only a dependency link and retains its independent definitions and executions', async () => {
    const ws = await installed()
    const resolved = await resolveDefinitionPackageDependencies(await parent({}, '1.0.1'), async () => {
      throw new Error('Unexpected catalog access')
    })
    const plan = await prepareDefinitionPackageTreeUpdate(ws.root, resolved, {}, {}, ws.records, ws.model, ws.hierarchy)
    expect(plan.blocked).toBe(false)
    expect(plan.installation.dependencies).toEqual({})
    expect(plan.installations).toHaveLength(1)
    expect(plan.removed.some((doc) => doc._class === process.class.Process)).toBe(false)
    expect(plan.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'removed', reason: expect.stringContaining('retained') })
      ])
    )
  })

  it('reviews divergent child edits through the existing local/upstream conflict choices', async () => {
    const ws = await installed()
    const currentChild = [...ws.records.values()].find((record) => record.package.id === 'other/review')
    if (currentChild === undefined) throw new Error('Missing child fixture')
    const proc = ws.docs.find((doc) => doc._id === currentChild.identities.review)
    if (proc === undefined) throw new Error('Missing process fixture')
    Reflect.set(proc, 'name', 'Local review')
    const incomingChild = await child('1.0.1', processSource.replace('label: Review', 'label: Published review'))
    const resolved = await resolveDefinitionPackageDependencies(
      await parent({ approval: lock(incomingChild) }, '1.0.1'),
      async () => incomingChild
    )
    const unresolved = await prepareDefinitionPackageTreeUpdate(
      ws.root,
      resolved,
      {},
      {},
      ws.records,
      ws.model,
      ws.hierarchy
    )
    expect(unresolved.blocked).toBe(true)
    expect(unresolved.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: proc._id, resolution: 'conflict' })])
    )
    const keep = await prepareDefinitionPackageTreeUpdate(
      ws.root,
      resolved,
      {},
      { [proc._id]: 'local' },
      ws.records,
      ws.model,
      ws.hierarchy
    )
    expect(keep.blocked).toBe(false)
    expect(keep.documents.find((doc) => doc._id === proc._id)).toMatchObject({ name: 'Local review' })
  })
})
