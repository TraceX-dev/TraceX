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
  generateId,
  type Class,
  type Doc,
  type Hierarchy,
  type LowLevelStorage,
  type MeasureContext,
  type Ref,
  type Space,
  type TxOperations,
  type WorkspaceIds
} from '@hcengineering/core'
import { type Pipeline, type StorageAdapter } from '@hcengineering/server-core'
import { CrossWorkspaceExporter, type ExportOptions, type RelationDefinition } from '../workspace'
import { DOCUMENTS, EXPORT_ORIGIN_CLASS } from '../workspace/origin-resolver'

const ControlledDocument = 'documents:class:ControlledDocument' as Ref<Class<Doc>>
const SpaceClass = 'test:class:DocSpace' as Ref<Class<Doc>>

const parents: Record<string, string> = {
  [ControlledDocument]: DOCUMENTS.Document,
  [SpaceClass]: core.class.Space
}

function isDerived (_class: string, base: string): boolean {
  let current: string | undefined = _class
  while (current !== undefined) {
    if (current === base) return true
    current = parents[current]
  }
  return false
}

const hierarchy = {
  isDerived: jest.fn(isDerived),
  findDomain: jest.fn((_class: string) => (isDerived(_class, core.class.Space) ? 'space' : 'documents')),
  getAllAttributes: jest.fn(() => new Map()),
  isMixin: jest.fn(() => false),
  hasMixin: jest.fn(() => false),
  getClass: jest.fn(() => ({ label: 'Document' }))
} as unknown as Hierarchy

function matches (doc: any, query: Record<string, any>): boolean {
  for (const [key, expected] of Object.entries(query)) {
    const actual = doc[key]
    if (expected !== null && typeof expected === 'object') {
      if ('$in' in expected && !(expected.$in as any[]).includes(actual)) return false
      if ('$exists' in expected && (actual !== undefined) !== expected.$exists) return false
    } else if (actual !== expected) {
      return false
    }
  }
  return true
}

/** Target workspace kept in memory, shared between export runs. */
class MemoryTarget {
  readonly docs: any[] = []

  getHierarchy (): Hierarchy {
    return hierarchy
  }

  async findAll (_class: string, query: Record<string, any>): Promise<any[]> {
    return this.docs.filter((d) => isDerived(d._class, _class) && matches(d, query))
  }

  async createDoc (_class: string, space: string, data: any, id?: string): Promise<string> {
    const _id = id ?? generateId()
    this.docs.push({ ...data, _id, _class, space, modifiedOn: Date.now() })
    return _id
  }

  async addCollection (
    _class: string,
    space: string,
    attachedTo: string,
    attachedToClass: string,
    collection: string,
    data: any,
    id?: string
  ): Promise<string> {
    const _id = id ?? generateId()
    this.docs.push({ ...data, _id, _class, space, attachedTo, attachedToClass, collection, modifiedOn: Date.now() })
    return _id
  }

  byId (id: string): any {
    return this.docs.find((d) => d._id === id)
  }

  of (_class: string): any[] {
    return this.docs.filter((d) => d._class === _class)
  }
}

/** Source workspace kept in memory. */
class MemorySource {
  readonly docs: any[] = []

  add (doc: any): any {
    this.docs.push({ modifiedOn: Date.now(), ...doc })
    return doc
  }

  lowLevel (): LowLevelStorage {
    const inDomain = (domain: string, query: any): any[] =>
      this.docs.filter((d) => hierarchy.findDomain(d._class) === domain && matches(d, query))
    return {
      rawFindAll: async (domain: string, query: any) => inDomain(domain, query),
      traverse: async (domain: string, query: any) => {
        let done = false
        return {
          next: async () => {
            if (done) return null
            done = true
            return inDomain(domain, query)
          },
          close: async () => {}
        }
      }
    } as unknown as LowLevelStorage
  }
}

const context = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as MeasureContext
const sourceWs: WorkspaceIds = { uuid: 'source-ws' as any, dataId: 'source-ws' as any, url: '' }
const targetWs: WorkspaceIds = { uuid: 'target-ws' as any, dataId: 'target-ws' as any, url: '' }

const relations: RelationDefinition[] = [
  { sourceClass: DOCUMENTS.Document, field: 'template', class: DOCUMENTS.Document, direction: 'forward' },
  { sourceClass: DOCUMENTS.Document, field: 'attachedTo', class: DOCUMENTS.DocumentMeta, direction: 'forward' },
  { sourceClass: DOCUMENTS.Document, field: 'document', class: DOCUMENTS.ProjectDocument, direction: 'inverse' },
  { sourceClass: DOCUMENTS.DocumentMeta, field: 'meta', class: DOCUMENTS.ProjectMeta, direction: 'inverse' },
  { sourceClass: DOCUMENTS.ProjectMeta, field: 'parent', class: DOCUMENTS.DocumentMeta, direction: 'forward' },
  { sourceClass: DOCUMENTS.ProjectDocument, field: 'attachedTo', class: DOCUMENTS.ProjectMeta, direction: 'forward' }
]

const SOURCE_SPACE = '69286daacb49b698d3ea2c51' as Ref<Space>
const TARGET_SPACE = '79286daacb49b698d3ea2c51' as Ref<Space>
const ALICE = 'test:employee:alice'

interface Fixture {
  source: MemorySource
  target: MemoryTarget
}

function createFixture (): Fixture {
  const source = new MemorySource()
  const target = new MemoryTarget()
  source.add({ _id: SOURCE_SPACE, _class: SpaceClass, space: core.space.Space, name: 'Quality documents' })
  target.docs.push({ _id: TARGET_SPACE, _class: SpaceClass, space: core.space.Space, name: 'Quality documents' })
  return { source, target }
}

/** A document (DocumentMeta + hierarchy entry) with its first version. */
function addDocument (
  source: MemorySource,
  data: { title: string, code: string, template?: string }
): {
  meta: string
  version: string
} {
  const meta = generateId()
  const projectMeta = generateId()
  const version = generateId()
  source.add({ _id: meta, _class: DOCUMENTS.DocumentMeta, space: SOURCE_SPACE, title: data.title })
  source.add({
    _id: projectMeta,
    _class: DOCUMENTS.ProjectMeta,
    space: SOURCE_SPACE,
    meta,
    project: 'documents:ids:NoProject'
  })
  addVersion(source, meta, projectMeta, version, { ...data, major: 1, minor: 0 })
  return { meta, version }
}

function addVersion (
  source: MemorySource,
  meta: string,
  projectMeta: string,
  version: string,
  data: { title: string, code: string, template?: string, major: number, minor: number, state?: string }
): void {
  source.add({
    _id: version,
    _class: ControlledDocument,
    space: SOURCE_SPACE,
    attachedTo: meta,
    attachedToClass: DOCUMENTS.DocumentMeta,
    collection: 'documents',
    state: 'effective',
    seqNumber: 1,
    prefix: data.code.split('-')[0],
    ...data
  })
  source.add({
    _id: generateId(),
    _class: DOCUMENTS.ProjectDocument,
    space: SOURCE_SPACE,
    attachedTo: projectMeta,
    attachedToClass: DOCUMENTS.ProjectMeta,
    collection: 'documents',
    project: 'documents:ids:NoProject',
    document: version
  })
}

function projectMetaOf (source: MemorySource, meta: string): string {
  return source.docs.find((d) => d._class === DOCUMENTS.ProjectMeta && d.meta === meta)._id
}

async function runExport (
  { source, target }: Fixture,
  ids: string[],
  options: Partial<ExportOptions> = {}
): ReturnType<CrossWorkspaceExporter['export']> {
  const lowLevel = source.lowLevel()
  const pipelineFactory = async (): Promise<Pipeline> =>
    ({ context: { hierarchy, lowLevelStorage: lowLevel }, findAll: async () => [], close: async () => {} }) as any
  const exporter = new CrossWorkspaceExporter(
    context,
    pipelineFactory,
    target as unknown as TxOperations,
    {} as unknown as StorageAdapter,
    undefined,
    sourceWs,
    targetWs
  )
  return await exporter.export({
    sourceWorkspace: sourceWs,
    targetWorkspace: targetWs,
    sourceQuery: { _id: { $in: ids } } as any,
    _class: ControlledDocument,
    includeAttachments: false,
    skipDeletedObsolete: false,
    relations,
    ...options
  })
}

function versionsOf (target: MemoryTarget, title: string): any[] {
  return target.of(ControlledDocument).filter((d) => d.title === title)
}

describe('Repeated export reuses what earlier exports imported', () => {
  it('imports a shared template only once across exports (BUG 1)', async () => {
    const fixture = createFixture()
    const template = addDocument(fixture.source, { title: 'tmp 2', code: 'TMPL-3' })
    const doc1 = addDocument(fixture.source, { title: 'DOC 1', code: 'T2-1', template: template.version })
    const doc2 = addDocument(fixture.source, { title: 'DOC 2', code: 'T2-2', template: template.version })

    await runExport(fixture, [doc1.version])
    await runExport(fixture, [doc2.version])

    const templates = versionsOf(fixture.target, 'tmp 2')
    expect(templates).toHaveLength(1)
    expect(fixture.target.of(DOCUMENTS.DocumentMeta).filter((m) => m.title === 'tmp 2')).toHaveLength(1)
    expect(versionsOf(fixture.target, 'DOC 1')[0].template).toBe(templates[0]._id)
    expect(versionsOf(fixture.target, 'DOC 2')[0].template).toBe(templates[0]._id)
  })

  it('records the origin of every created document', async () => {
    const fixture = createFixture()
    const doc = addDocument(fixture.source, { title: 'DOC 1', code: 'T2-1' })

    await runExport(fixture, [doc.version])

    const origins = fixture.target.of(EXPORT_ORIGIN_CLASS)
    const created = versionsOf(fixture.target, 'DOC 1')[0]
    expect(origins).toContainEqual(
      expect.objectContaining({ sourceWorkspace: 'source-ws', sourceId: doc.version, targetId: created._id })
    )
    expect(origins).toContainEqual(expect.objectContaining({ sourceId: doc.meta }))
  })

  it('skips a selected document that was already imported', async () => {
    const fixture = createFixture()
    const doc = addDocument(fixture.source, { title: 'DOC 1', code: 'T2-1' })

    await runExport(fixture, [doc.version])
    const result = await runExport(fixture, [doc.version])

    expect(result.exportedCount).toBe(0)
    expect(result.skippedDocuments).toEqual([
      expect.objectContaining({ docId: doc.version, reason: 'alreadyImported' })
    ])
    expect(versionsOf(fixture.target, 'DOC 1')).toHaveLength(1)
  })

  it('skips a newer source version by default', async () => {
    const fixture = createFixture()
    const doc = addDocument(fixture.source, { title: 'DOC 1', code: 'T2-1' })
    await runExport(fixture, [doc.version])

    const v11 = generateId()
    addVersion(fixture.source, doc.meta, projectMetaOf(fixture.source, doc.meta), v11, {
      title: 'DOC 1',
      code: 'T2-1',
      major: 1,
      minor: 1
    })
    const result = await runExport(fixture, [v11])

    expect(result.exportedCount).toBe(0)
    expect(result.skippedDocuments[0]).toMatchObject({ docId: v11, reason: 'alreadyImported' })
    expect(versionsOf(fixture.target, 'DOC 1')).toHaveLength(1)
  })

  it('creates a newer source version as a new draft version when asked', async () => {
    const fixture = createFixture()
    const doc = addDocument(fixture.source, { title: 'DOC 1', code: 'T2-1' })
    await runExport(fixture, [doc.version], {
      fieldMappers: { [ControlledDocument]: { state: 'draft', major: 1, minor: 0 } }
    })
    // The target approves the imported version and sets up its own team.
    const imported = versionsOf(fixture.target, 'DOC 1')[0]
    Object.assign(imported, { state: 'effective', code: 'T2-7', seqNumber: 7, owner: ALICE, reviewers: [ALICE] })

    const v11 = generateId()
    addVersion(fixture.source, doc.meta, projectMetaOf(fixture.source, doc.meta), v11, {
      title: 'DOC 1 (rev)',
      code: 'T2-1',
      major: 1,
      minor: 1
    })
    const result = await runExport(fixture, [v11], {
      existingDocuments: 'newVersion',
      fieldMappers: { [ControlledDocument]: { state: 'draft', major: 1, minor: 0, reviewers: [] } }
    })

    expect(result.exportedCount).toBe(1)
    expect(result.newVersionCount).toBe(1)
    const created = versionsOf(fixture.target, 'DOC 1 (rev)')[0]
    expect(created).toMatchObject({
      attachedTo: imported.attachedTo,
      code: 'T2-7',
      seqNumber: 7,
      major: 1,
      minor: 1,
      state: 'draft',
      owner: ALICE,
      reviewers: [ALICE]
    })
    // Listed in the tree next to the version it extends, under the same hierarchy entry.
    const entries = fixture.target.of(DOCUMENTS.ProjectDocument)
    const importedEntry = entries.find((e) => e.document === imported._id)
    const createdEntry = entries.find((e) => e.document === created._id)
    expect(createdEntry?.attachedTo).toBe(importedEntry?.attachedTo)
    expect(fixture.target.of(DOCUMENTS.ProjectMeta)).toHaveLength(1)
  })

  it('does not create a new version while a draft is in progress in the target', async () => {
    const fixture = createFixture()
    const doc = addDocument(fixture.source, { title: 'DOC 1', code: 'T2-1' })
    await runExport(fixture, [doc.version], { fieldMappers: { [ControlledDocument]: { state: 'draft' } } })

    const v11 = generateId()
    addVersion(fixture.source, doc.meta, projectMetaOf(fixture.source, doc.meta), v11, {
      title: 'DOC 1',
      code: 'T2-1',
      major: 1,
      minor: 1
    })
    const result = await runExport(fixture, [v11], { existingDocuments: 'newVersion' })

    expect(result.exportedCount).toBe(0)
    expect(result.skippedDocuments[0]).toMatchObject({ docId: v11, reason: 'draftInProgress' })
    expect(versionsOf(fixture.target, 'DOC 1')).toHaveLength(1)
  })

  it('creates a new template version when the source template changed', async () => {
    const fixture = createFixture()
    const template = addDocument(fixture.source, { title: 'tmp 2', code: 'TMPL-3' })
    const doc1 = addDocument(fixture.source, { title: 'DOC 1', code: 'T2-1', template: template.version })
    await runExport(fixture, [doc1.version])
    const importedTemplate = versionsOf(fixture.target, 'tmp 2')[0]
    Object.assign(importedTemplate, { state: 'effective', code: 'TMPL-11' })

    const template11 = generateId()
    addVersion(fixture.source, template.meta, projectMetaOf(fixture.source, template.meta), template11, {
      title: 'tmp 2',
      code: 'TMPL-3',
      major: 1,
      minor: 1
    })
    const doc2 = addDocument(fixture.source, { title: 'DOC 2', code: 'T2-2', template: template11 })
    await runExport(fixture, [doc2.version])

    const templates = versionsOf(fixture.target, 'tmp 2')
    expect(templates).toHaveLength(2)
    const newTemplate = templates.find((t) => t._id !== importedTemplate._id)
    expect(newTemplate).toMatchObject({ attachedTo: importedTemplate.attachedTo, code: 'TMPL-11', major: 1, minor: 1 })
    // Each document references the version it references in the source.
    expect(versionsOf(fixture.target, 'DOC 1')[0].template).toBe(importedTemplate._id)
    expect(versionsOf(fixture.target, 'DOC 2')[0].template).toBe(newTemplate._id)
  })

  it('does not re-create an older template version than the one imported', async () => {
    const fixture = createFixture()
    const template = addDocument(fixture.source, { title: 'tmp 2', code: 'TMPL-3' })
    const template11 = generateId()
    addVersion(fixture.source, template.meta, projectMetaOf(fixture.source, template.meta), template11, {
      title: 'tmp 2',
      code: 'TMPL-3',
      major: 1,
      minor: 1
    })
    const doc2 = addDocument(fixture.source, { title: 'DOC 2', code: 'T2-2', template: template11 })
    await runExport(fixture, [doc2.version])

    const doc1 = addDocument(fixture.source, { title: 'DOC 1', code: 'T2-1', template: template.version })
    await runExport(fixture, [doc1.version])

    const templates = versionsOf(fixture.target, 'tmp 2')
    expect(templates).toHaveLength(1)
    expect(versionsOf(fixture.target, 'DOC 1')[0].template).toBe(templates[0]._id)
  })

  it('imports again a template that was made obsolete in the target', async () => {
    const fixture = createFixture()
    const template = addDocument(fixture.source, { title: 'tmp 2', code: 'TMPL-3' })
    const doc1 = addDocument(fixture.source, { title: 'DOC 1', code: 'T2-1', template: template.version })
    await runExport(fixture, [doc1.version])
    versionsOf(fixture.target, 'tmp 2')[0].state = 'obsolete'

    const doc2 = addDocument(fixture.source, { title: 'DOC 2', code: 'T2-2', template: template.version })
    await runExport(fixture, [doc2.version])

    const templates = versionsOf(fixture.target, 'tmp 2')
    expect(templates).toHaveLength(2)
    const fresh = templates.find((t) => t.state !== 'obsolete')
    expect(fresh.attachedTo).not.toBe(templates.find((t) => t.state === 'obsolete').attachedTo)
    expect(versionsOf(fixture.target, 'DOC 2')[0].template).toBe(fresh._id)
    // The re-imported template is listed under a hierarchy entry of its own DocumentMeta.
    expect(fixture.target.of(DOCUMENTS.ProjectMeta).some((pm) => pm.meta === fresh.attachedTo)).toBe(true)
  })

  it('imports again a selected document that was deleted in the target', async () => {
    const fixture = createFixture()
    const doc = addDocument(fixture.source, { title: 'DOC 1', code: 'T2-1' })
    await runExport(fixture, [doc.version])
    versionsOf(fixture.target, 'DOC 1')[0].state = 'deleted'

    const result = await runExport(fixture, [doc.version])

    expect(result.exportedCount).toBe(1)
    expect(versionsOf(fixture.target, 'DOC 1')).toHaveLength(2)
  })

  it('exports the tree entry of folders and reuses them (BUG 3)', async () => {
    const fixture = createFixture()
    const { source } = fixture
    const folderMeta = generateId()
    const folderProjectMeta = generateId()
    source.add({ _id: folderMeta, _class: DOCUMENTS.DocumentMeta, space: SOURCE_SPACE, title: 'usability' })
    source.add({ _id: folderProjectMeta, _class: DOCUMENTS.ProjectMeta, space: SOURCE_SPACE, meta: folderMeta })
    source.add({
      _id: generateId(),
      _class: DOCUMENTS.ProjectDocument,
      space: SOURCE_SPACE,
      attachedTo: folderProjectMeta,
      attachedToClass: DOCUMENTS.ProjectMeta,
      collection: 'documents',
      document: DOCUMENTS.Folder
    })
    const doc1 = addDocument(source, { title: 'DOC 1', code: 'T3-1' })
    const doc2 = addDocument(source, { title: 'DOC 2', code: 'T3-2' })
    for (const meta of [doc1.meta, doc2.meta]) {
      source.docs.find((d) => d._class === DOCUMENTS.ProjectMeta && d.meta === meta).parent = folderMeta
    }

    await runExport(fixture, [doc1.version])
    await runExport(fixture, [doc2.version])

    const { target } = fixture
    const folders = target.of(DOCUMENTS.DocumentMeta).filter((m) => m.title === 'usability')
    expect(folders).toHaveLength(1)
    const folderEntry = target.of(DOCUMENTS.ProjectMeta).find((pm) => pm.meta === folders[0]._id)
    expect(
      target
        .of(DOCUMENTS.ProjectDocument)
        .filter((e) => e.attachedTo === folderEntry._id && e.document === DOCUMENTS.Folder)
    ).toHaveLength(1)
    for (const title of ['DOC 1', 'DOC 2']) {
      const meta = versionsOf(target, title)[0].attachedTo
      expect(target.of(DOCUMENTS.ProjectMeta).find((pm) => pm.meta === meta)?.parent).toBe(folders[0]._id)
    }
  })
})
