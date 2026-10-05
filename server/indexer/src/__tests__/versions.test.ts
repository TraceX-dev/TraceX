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

import core, {
  type Class,
  type Doc,
  type Domain,
  type Hierarchy,
  MeasureMetricsContext,
  type ModelDb,
  type Ref,
  TxFactory,
  TxProcessor,
  type VersionableDoc,
  type WorkspaceUuid
} from '@hcengineering/core'
import type { ContentTextAdapter, DbAdapter, FullTextAdapter, StorageAdapter } from '@hcengineering/server-core'
import { FullTextIndexPipeline } from '../indexer/indexer'
import { createIndexedDoc } from '../indexer/utils'
import { searchFulltext } from '../fulltext'
import { mapSearchResultDoc } from '../mapper'

describe('version indexing', () => {
  const ctx = new MeasureMetricsContext('version-indexing', {})
  const versionClass = 'test:class:Version' as Ref<Class<VersionableDoc>>
  const factory = new TxFactory(core.account.System)
  const baseId = 'base' as Ref<VersionableDoc>
  const newId = 'new' as Ref<VersionableDoc>
  const create = factory.createTxCreateDoc(
    versionClass,
    core.space.Workspace,
    {
      baseId,
      version: 2,
      isLatest: true,
      isEffective: false
    },
    newId
  )
  const latest = TxProcessor.createDoc2Doc(create)
  const old: VersionableDoc = { ...latest, _id: baseId, version: 1, isLatest: false, isEffective: true }

  const findAll = jest.fn()
  const remove = jest.fn()
  let pipeline: FullTextIndexPipeline
  let indexDocuments: jest.SpyInstance

  beforeEach(() => {
    jest.clearAllMocks()
    findAll.mockResolvedValue([old])
    const hierarchy = {
      tx: jest.fn(),
      findDomain: () => 'test' as Domain,
      getClassifierProp: () => true,
      classHierarchyMixin: (_class: Ref<Class<Doc>>, mixin: Ref<Class<Doc>>) =>
        mixin === core.mixin.VersionableClass ? { enabled: true } : undefined
    } as unknown as Hierarchy
    const storageAdapter: Partial<StorageAdapter> = {}
    const contentAdapter: Partial<ContentTextAdapter> = {}
    pipeline = new FullTextIndexPipeline(
      { remove } as unknown as FullTextAdapter,
      { findAll } as unknown as DbAdapter,
      hierarchy,
      { uuid: 'workspace' as WorkspaceUuid, url: 'workspace' },
      ctx,
      { findAllSync: () => [] } as unknown as ModelDb,
      storageAdapter as StorageAdapter,
      contentAdapter as ContentTextAdapter,
      jest.fn()
    )
    indexDocuments = jest.spyOn(pipeline, 'indexDocuments').mockResolvedValue(undefined)
  })

  afterEach(() => {
    pipeline.cancel()
  })

  it('keeps previous versions when a new version is created', async () => {
    await pipeline.processTransactions(ctx, [create], { pause: jest.fn(), heartbeat: async () => {} })

    expect(indexDocuments.mock.calls[0][2]).toEqual([latest])
    expect(remove).not.toHaveBeenCalled()
    expect(findAll).not.toHaveBeenCalled()
  })

  it('indexes an old version after it stops being latest', async () => {
    const update = factory.createTxUpdateDoc(versionClass, old.space, old._id, { isLatest: false })
    await pipeline.processTransactions(ctx, [update], { pause: jest.fn(), heartbeat: async () => {} })

    expect(indexDocuments.mock.calls[0][2]).toEqual([old])
    expect(remove).not.toHaveBeenCalled()
  })

  it('still removes explicitly deleted versions', async () => {
    const removeTx = factory.createTxRemoveDoc(versionClass, old.space, old._id)
    await pipeline.processTransactions(ctx, [removeTx], { pause: jest.fn(), heartbeat: async () => {} })

    expect(remove).toHaveBeenCalledWith(ctx, 'workspace', [old._id])
  })

  it('returns all matching versions in general search with their version numbers', async () => {
    const docs = [old, latest].map((doc) => ({ ...createIndexedDoc(doc, [], doc.space), searchTitle: 'Same title' }))
    const adapter = { searchString: jest.fn().mockResolvedValue({ docs, total: 2 }) } as unknown as FullTextAdapter
    const result = await searchFulltext(
      ctx,
      pipeline.workspace.uuid,
      pipeline.hierarchy,
      adapter,
      {
        query: 'Same title'
      },
      {}
    )

    expect(result.total).toBe(2)
    expect(result.docs.map((doc) => ({ id: doc.id, title: doc.title, description: doc.description }))).toEqual([
      { id: old._id, title: 'Same title', description: 'v1' },
      { id: latest._id, title: 'Same title', description: 'v2' }
    ])
  })

  it('does not invent a version number for records without version metadata', () => {
    const doc = { ...latest, version: undefined }
    const indexed = createIndexedDoc(doc, [], doc.space)
    expect(indexed).not.toHaveProperty('version')
    expect(mapSearchResultDoc(pipeline.hierarchy, indexed).description).toBeUndefined()
  })

  it('does not display a version when versioning is disabled', () => {
    const hierarchy = { classHierarchyMixin: () => undefined } as unknown as Hierarchy
    const indexed = createIndexedDoc(latest, [], latest.space)
    expect(mapSearchResultDoc(hierarchy, indexed).description).toBeUndefined()
  })
})
