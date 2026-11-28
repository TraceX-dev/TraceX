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
  SortingOrder,
  type Class,
  type Doc,
  type Hierarchy,
  type LowLevelStorage,
  type MeasureContext,
  type Ref,
  type TxOperations
} from '@hcengineering/core'
import { type ExportState } from './types'

// Keep in sync with @hcengineering/export (exportPlugin.class.ExportOrigin).
export const EXPORT_ORIGIN_CLASS = 'export:class:ExportOrigin' as Ref<Class<Doc>>

// Keep in sync with the controlled documents plugin.
export const DOCUMENTS = {
  Document: 'documents:class:Document' as Ref<Class<Doc>>,
  DocumentMeta: 'documents:class:DocumentMeta' as Ref<Class<Doc>>,
  ProjectMeta: 'documents:class:ProjectMeta' as Ref<Class<Doc>>,
  ProjectDocument: 'documents:class:ProjectDocument' as Ref<Class<Doc>>,
  DocumentTemplate: 'documents:mixin:DocumentTemplate',
  Folder: 'documents:ids:Folder' as Ref<Doc>
}

const STATE_DRAFT = 'draft'
const REMOVED_STATES = new Set(['deleted', 'obsolete'])

export interface OriginRecord {
  sourceId: Ref<Doc>
  targetId: Ref<Doc>
  targetClass: Ref<Class<Doc>>
}

/** A controlled document version, as much of it as the exporter needs. */
export interface VersionDoc extends Doc {
  attachedTo: Ref<Doc>
  attachedToClass: Ref<Class<Doc>>
  collection: string
  state?: string
  major?: number
  minor?: number
  code?: string
  prefix?: string
  seqNumber?: number
  owner?: Ref<Doc>
  reviewers?: Array<Ref<Doc>>
  approvers?: Array<Ref<Doc>>
  coAuthors?: Array<Ref<Doc>>
}

/** How to create a source version as a new version of an already imported document. */
export interface NewVersionPlan {
  targetMeta: Ref<Doc>
  /** Highest existing target version: its identity and team are carried over. */
  latest: VersionDoc
  major: number
  minor: number
  /** Hierarchy entry of the latest target version: the new version is listed next to it. */
  latestProjectDocument?: ProjectDocumentRef
}

export interface ProjectDocumentRef extends Doc {
  attachedTo: Ref<Doc>
  attachedToClass: Ref<Class<Doc>>
  collection: string
  project?: Ref<Doc>
  initial?: Ref<Doc>
  document: Ref<Doc>
}

export type SkipReason = 'alreadyImported' | 'draftInProgress'

export type VersionDecision =
  | { kind: 'skip', reason: SkipReason, mapTo: Ref<Doc> }
  | { kind: 'newVersion', plan: NewVersionPlan }
  | { kind: 'fresh' }

export function compareVersions (
  a: Pick<VersionDoc, 'major' | 'minor'>,
  b: Pick<VersionDoc, 'major' | 'minor'>
): number {
  const majorDiff = (a.major ?? 0) - (b.major ?? 0)
  return majorDiff !== 0 ? majorDiff : (a.minor ?? 0) - (b.minor ?? 0)
}

/**
 * Remembers which target document each exported source document produced
 * (persisted as ExportOrigin docs in the target workspace) and decides whether
 * a source document can reuse what an earlier export already created.
 *
 * Matching is by origin only: objects created by hand in the target workspace,
 * or imported before origins were recorded, are never matched.
 */
export class OriginResolver {
  private readonly records = new Map<Ref<Doc>, OriginRecord | null>()
  private readonly metaTargets = new Map<Ref<Doc>, Ref<Doc> | null>()
  private disabled = false

  constructor (
    private readonly context: MeasureContext,
    private readonly targetClient: TxOperations,
    private readonly state: ExportState,
    private readonly sourceWorkspace: string
  ) {}

  /**
   * Target document an earlier export produced for `doc`, if it can be reused.
   * Documents that were deleted or made obsolete in the target are not reused,
   * so they get imported again.
   */
  async resolveExisting (
    doc: Doc,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage
  ): Promise<Ref<Doc> | undefined> {
    const current = this.state.idMapping.get(doc._id)
    if (current !== undefined) return current

    const record = await this.findRecord(doc._id)
    if (record === undefined) return undefined

    const target = await this.findTarget(record)
    if (target === undefined) return undefined

    const valid = await this.isReusable(doc, target, sourceHierarchy, sourceLowLevel)
    return valid ? target._id : undefined
  }

  /** Target DocumentMeta for a source DocumentMeta, when it exists and is still in use. */
  async resolveMeta (sourceMetaId: Ref<Doc>): Promise<Ref<Doc> | undefined> {
    const current = this.state.idMapping.get(sourceMetaId)
    if (current !== undefined) return current

    const cached = this.metaTargets.get(sourceMetaId)
    if (cached !== undefined) return cached ?? undefined

    let result: Ref<Doc> | undefined
    const record = await this.findRecord(sourceMetaId)
    if (record !== undefined) {
      const target = await this.findTarget(record)
      if (target !== undefined && (await this.isMetaAlive(target._id))) {
        result = target._id
      }
    }
    this.metaTargets.set(sourceMetaId, result ?? null)
    return result
  }

  /**
   * Decide what to do with a source version whose document was imported before,
   * but whose exact version was not.
   *
   * - `root` documents (selected for export) are skipped unless `createNewVersion`.
   * - Referenced documents (templates) always get a new version.
   * - A source version that is not newer than what was already imported is not
   *   re-created: it maps onto the latest target version.
   * - When a draft is already in progress in the target, nothing is created.
   */
  async planVersion (
    doc: VersionDoc,
    targetMeta: Ref<Doc>,
    root: boolean,
    createNewVersion: boolean,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage
  ): Promise<VersionDecision> {
    const versions = await this.loadVersions(targetMeta)
    if (versions.length === 0) return { kind: 'fresh' }

    const latest = versions.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max))

    if (root && !createNewVersion) {
      return { kind: 'skip', reason: 'alreadyImported', mapTo: latest._id }
    }

    const newestImported = await this.findNewestImportedSourceVersion(versions, sourceHierarchy, sourceLowLevel)
    if (newestImported !== undefined && compareVersions(doc, newestImported) <= 0) {
      return { kind: 'skip', reason: 'alreadyImported', mapTo: latest._id }
    }

    const inProgress = versions.find((v) => v.state === STATE_DRAFT)
    if (inProgress !== undefined) {
      return { kind: 'skip', reason: 'draftInProgress', mapTo: latest._id }
    }

    return {
      kind: 'newVersion',
      plan: {
        targetMeta,
        latest,
        major: latest.major ?? 0,
        minor: (latest.minor ?? 0) + 1,
        latestProjectDocument: await this.findProjectDocumentOf(latest._id)
      }
    }
  }

  /** Persist the link between a source document and the target document it produced. */
  async record (source: Doc, targetId: Ref<Doc>, targetClass: Ref<Class<Doc>>): Promise<void> {
    const record: OriginRecord = { sourceId: source._id, targetId, targetClass }
    this.records.set(source._id, record)
    if (this.disabled) return
    try {
      await this.targetClient.createDoc(EXPORT_ORIGIN_CLASS, core.space.Workspace, {
        sourceWorkspace: this.sourceWorkspace,
        sourceId: source._id,
        sourceClass: source._class,
        targetId,
        targetClass
      })
    } catch (err: any) {
      this.disable('record', err)
    }
  }

  isEnabled (): boolean {
    return !this.disabled
  }

  isDocument (doc: Doc): doc is VersionDoc {
    return this.isDerived(doc._class, DOCUMENTS.Document) && (doc as any).attachedTo !== undefined
  }

  isDerived (_class: Ref<Class<Doc>>, base: Ref<Class<Doc>>): boolean {
    try {
      return this.targetClient.getHierarchy().isDerived(_class, base)
    } catch {
      return false
    }
  }

  async loadVersions (targetMeta: Ref<Doc>): Promise<VersionDoc[]> {
    const docs = await this.targetClient.findAll(DOCUMENTS.Document, { attachedTo: targetMeta })
    return (docs as unknown as VersionDoc[]).filter((d) => d.attachedTo === targetMeta)
  }

  private async findRecord (sourceId: Ref<Doc>): Promise<OriginRecord | undefined> {
    const cached = this.records.get(sourceId)
    if (cached !== undefined) return cached ?? undefined
    if (this.disabled) return undefined

    let result: OriginRecord | undefined
    try {
      const found = await this.targetClient.findAll(
        EXPORT_ORIGIN_CLASS,
        { sourceWorkspace: this.sourceWorkspace, sourceId },
        { sort: { modifiedOn: SortingOrder.Descending } }
      )
      const match = (found as any[]).find((r) => r.sourceWorkspace === this.sourceWorkspace && r.sourceId === sourceId)
      if (match !== undefined) {
        result = { sourceId, targetId: match.targetId, targetClass: match.targetClass }
      }
    } catch (err: any) {
      this.disable('lookup', err)
    }
    this.records.set(sourceId, result ?? null)
    return result
  }

  private async findTarget (record: OriginRecord): Promise<Doc | undefined> {
    const found = await this.targetClient.findAll(record.targetClass, { _id: record.targetId })
    return (found as Doc[]).find((d) => d._id === record.targetId)
  }

  private async isReusable (
    doc: Doc,
    target: Doc,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage
  ): Promise<boolean> {
    const source = doc as any
    const existing = target as any

    // A version is reusable while its document is: same, still used, DocumentMeta.
    if (this.isDocument(doc)) {
      const meta = await this.resolveMeta(source.attachedTo)
      return meta !== undefined && meta === existing.attachedTo
    }
    if (this.isDerived(doc._class, DOCUMENTS.DocumentMeta)) {
      return await this.isMetaAlive(target._id)
    }
    // Hierarchy entries must point at the DocumentMeta currently used for their document,
    // otherwise a re-imported document would be listed under a stale entry and stay hidden.
    if (this.isDerived(doc._class, DOCUMENTS.ProjectMeta)) {
      const meta = await this.resolveMeta(source.meta)
      return meta !== undefined && meta === existing.meta
    }
    if (this.isDerived(doc._class, DOCUMENTS.ProjectDocument)) {
      const projectMeta = await this.resolveSourceDoc(
        source.attachedTo,
        DOCUMENTS.ProjectMeta,
        sourceHierarchy,
        sourceLowLevel
      )
      if (projectMeta === undefined || projectMeta !== existing.attachedTo) return false
      if (source.document === DOCUMENTS.Folder) return existing.document === DOCUMENTS.Folder
      const document = this.state.idMapping.get(source.document)
      return document === undefined || document === existing.document
    }
    return true
  }

  private async resolveSourceDoc (
    sourceId: Ref<Doc>,
    _class: Ref<Class<Doc>>,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage
  ): Promise<Ref<Doc> | undefined> {
    const current = this.state.idMapping.get(sourceId)
    if (current !== undefined) return current
    const domain = sourceHierarchy.findDomain(_class)
    if (domain === undefined) return undefined
    const [source] = await sourceLowLevel.rawFindAll<Doc>(domain, { _id: sourceId })
    if (source === undefined) return undefined
    return await this.resolveExisting(source, sourceHierarchy, sourceLowLevel)
  }

  /** A DocumentMeta is in use while it is a folder or has a version that is not deleted or obsolete. */
  private async isMetaAlive (targetMeta: Ref<Doc>): Promise<boolean> {
    const versions = await this.loadVersions(targetMeta)
    return versions.length === 0 || versions.some((v) => !REMOVED_STATES.has(v.state ?? ''))
  }

  private async findNewestImportedSourceVersion (
    targetVersions: VersionDoc[],
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage
  ): Promise<VersionDoc | undefined> {
    if (this.disabled) return undefined
    let records: any[] = []
    try {
      const targetIds = targetVersions.map((v) => v._id)
      const found = await this.targetClient.findAll(EXPORT_ORIGIN_CLASS, {
        sourceWorkspace: this.sourceWorkspace,
        targetId: { $in: targetIds }
      })
      records = (found as any[]).filter(
        (r) => r.sourceWorkspace === this.sourceWorkspace && targetIds.includes(r.targetId)
      )
    } catch (err: any) {
      this.disable('lookup', err)
      return undefined
    }
    if (records.length === 0) return undefined

    const domain = sourceHierarchy.findDomain(DOCUMENTS.Document)
    if (domain === undefined) return undefined
    const sources = await sourceLowLevel.rawFindAll<VersionDoc>(domain, {
      _id: { $in: records.map((r) => r.sourceId) }
    })
    if (sources.length === 0) return undefined
    return sources.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max))
  }

  async findProjectDocumentOf (targetVersion: Ref<Doc>): Promise<ProjectDocumentRef | undefined> {
    const found = await this.targetClient.findAll(DOCUMENTS.ProjectDocument, { document: targetVersion })
    return (found as unknown as ProjectDocumentRef[]).find((d) => d.document === targetVersion)
  }

  private disable (operation: string, err: any): void {
    if (this.disabled) return
    this.disabled = true
    this.context.warn(`Export origin ${operation} failed, already imported documents will not be reused`, {
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
