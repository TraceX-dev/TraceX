//
// Copyright © 2025 Hardcore Engineering Inc.
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

import {
  allocateWithRetries,
  generateId,
  parseIdentifier,
  type AttachedDoc,
  type Class,
  type Collection,
  type Data,
  type Doc,
  type DocumentQuery,
  type Hierarchy,
  type LowLevelStorage,
  type MeasureContext,
  type Ref,
  type Space,
  type TxOperations
} from '@hcengineering/core'
import core from '@hcengineering/model-core'
import { type AttachmentExporter } from './attachment-exporter'
import { type DataMapper } from './data-mapper'
import {
  DOCUMENTS,
  type NewVersionPlan,
  type OriginResolver,
  type SkipReason,
  type VersionDoc
} from './origin-resolver'
import { type RelationExporter } from './relation-exporter'
import { type SpaceExporter } from './space-exporter'
import {
  type CustomExportHandler,
  type ExistingDocumentsMode,
  type ExportState,
  type RelationDefinition
} from './types'

// Keep in sync with the controlled documents plugin, which owns these sequences.
const DOCUMENT_NAMESPACE = 'documents'
const DOCUMENT_SEQUENCE_NAMESPACE = `${DOCUMENT_NAMESPACE}.sequence`
const DOCUMENT_SEQUENCE_KEY = 'seqNumber'
const TEMPLATE_SEQUENCE_SCOPE = 'templates'

/**
 * Handles document export logic
 */
export class DocumentExporter {
  private relationExporter: RelationExporter | undefined
  private dataMapper: DataMapper
  private customHandlers: CustomExportHandler[] = []
  private originResolver: OriginResolver | undefined
  private existingDocuments: ExistingDocumentsMode = 'skip'

  /** Documents selected for export that were not exported, with the reason. */
  readonly skipped = new Map<Ref<Doc>, SkipReason>()
  /** Documents selected for export that were created as a new version of an already imported document. */
  readonly newVersions = new Set<Ref<Doc>>()

  constructor (
    private readonly context: MeasureContext,
    private readonly targetClient: TxOperations,
    private readonly state: ExportState,
    dataMapper: DataMapper,
    private readonly spaceExporter: SpaceExporter,
    private readonly attachmentExporter: AttachmentExporter
  ) {
    this.dataMapper = dataMapper
  }

  setRelationExporter (relationExporter: RelationExporter): void {
    this.relationExporter = relationExporter
  }

  setDataMapper (dataMapper: DataMapper): void {
    this.dataMapper = dataMapper
  }

  setCustomHandlers (handlers: CustomExportHandler[]): void {
    this.customHandlers = handlers
  }

  /** Reuse documents imported by earlier exports, matched by their recorded origin. */
  setOriginResolver (resolver: OriginResolver | undefined): void {
    this.originResolver = resolver
  }

  setExistingDocumentsMode (mode: ExistingDocumentsMode): void {
    this.existingDocuments = mode
  }

  /**
   * Export a single document
   */
  async exportDocument (
    doc: Doc,
    conflictStrategy: 'skip' | 'duplicate',
    includeAttachments: boolean,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage,
    existingDocsMap: Map<Ref<Doc>, Doc>,
    relations: RelationDefinition[],
    includeChildren: boolean = false,
    root: boolean = false
  ): Promise<boolean> {
    if (this.state.processingDocs.has(doc._id)) {
      return false
    }

    if (this.state.idMapping.has(doc._id)) {
      return false
    }

    // Class-specific custom handlers take precedence over the default flow.
    const customTargetId = await this.runCustomHandlers(doc, sourceHierarchy, sourceLowLevel)
    if (customTargetId !== undefined) {
      this.state.idMapping.set(doc._id, customTargetId)
      return true
    }

    let versionPlan: NewVersionPlan | undefined
    if (this.originResolver !== undefined) {
      const reuse = await this.resolveReuse(doc, root, sourceHierarchy, sourceLowLevel)
      if (reuse.kind === 'skip') {
        this.state.idMapping.set(doc._id, reuse.mapTo)
        if (root) {
          this.skipped.set(doc._id, reuse.reason)
        }
        this.context.info(`Reusing ${reuse.mapTo} for ${doc._id} (${doc._class}): ${reuse.reason}`)
        return false
      }
      versionPlan = reuse.plan
    }

    if (conflictStrategy === 'skip') {
      const existingDoc = existingDocsMap.get(doc._id)
      if (existingDoc !== undefined) {
        this.state.idMapping.set(doc._id, existingDoc._id)
        return false
      }
    }

    this.state.processingDocs.add(doc._id)

    try {
      const hierarchy = this.targetClient.getHierarchy()
      // Check both hierarchy derivation AND presence of attachedTo field
      // Some classes like ControlledDocument have attachedTo but don't extend AttachedDoc
      const hasAttachedFields =
        (doc as any).attachedTo !== undefined &&
        (doc as any).attachedToClass !== undefined &&
        (doc as any).collection !== undefined
      const isAttached = hierarchy.isDerived(doc._class, core.class.AttachedDoc) || hasAttachedFields

      // Generate target ID upfront and add to idMapping BEFORE inverse relations
      // This ensures inverse relations can reference this document
      const targetId = generateId()
      this.state.idMapping.set(doc._id, targetId)

      if (versionPlan !== undefined) {
        await this.mapSourceProjectMetas(doc as VersionDoc, versionPlan, sourceHierarchy, sourceLowLevel)
      }

      // First: Export forward relations (dependencies must exist before this doc)
      if (this.relationExporter === undefined) {
        throw new Error('RelationExporter not initialized')
      }
      await this.relationExporter.exportForwardRelations(
        doc,
        relations,
        conflictStrategy,
        includeAttachments,
        sourceHierarchy,
        sourceLowLevel,
        includeChildren
      )

      // Create the document
      const targetSpace =
        versionPlan !== undefined
          ? versionPlan.latest.space
          : await this.spaceExporter.getOrCreateTargetSpace(doc.space, sourceHierarchy, sourceLowLevel)
      const data = await this.dataMapper.prepareDocumentData(doc, targetSpace, isAttached)
      if (versionPlan !== undefined) {
        applyVersionPlan(data, versionPlan)
      }
      await this.createDocument(doc, data, targetId, targetSpace, isAttached, versionPlan !== undefined)
      await this.originResolver?.record(doc, targetId, doc._class)
      if (versionPlan !== undefined && root) {
        this.newVersions.add(doc._id)
      }

      // Now: Export inverse relations (they can now reference this document)
      if (this.relationExporter === undefined) {
        throw new Error('RelationExporter not initialized')
      }
      await this.relationExporter.exportInverseRelations(
        doc,
        relations,
        conflictStrategy,
        includeAttachments,
        sourceHierarchy,
        sourceLowLevel,
        includeChildren
      )
      if (versionPlan !== undefined) {
        await this.ensureListedInHierarchy(targetId, versionPlan)
      }
      if (this.originResolver?.isDerived(doc._class, DOCUMENTS.ProjectMeta) === true) {
        await this.exportFolderEntries(doc, sourceHierarchy, sourceLowLevel, relations, includeChildren)
      }
      await this.exportSpaceRelations(
        doc,
        doc.space,
        conflictStrategy,
        includeAttachments,
        sourceHierarchy,
        sourceLowLevel,
        relations,
        includeChildren
      )

      // Handle attachments
      if (includeAttachments) {
        await this.attachmentExporter.exportAttachments(doc._id, targetId, doc._class, sourceHierarchy, sourceLowLevel)
      }

      // Handle collaborative content blobs (e.g., document content)
      await this.attachmentExporter.exportCollaborativeContent(doc, sourceHierarchy)

      // Handle collections (child documents) — only when explicitly requested.
      // When disabled, only the top-level documents matched by the export query
      // are exported and their attached collection items are skipped.
      if (includeChildren) {
        await this.exportCollections(doc, targetId, sourceHierarchy, sourceLowLevel, relations, includeChildren)
      }

      return true
    } catch (err: any) {
      // Remove from idMapping on failure
      this.state.idMapping.delete(doc._id)
      throw err
    } finally {
      this.state.processingDocs.delete(doc._id)
    }
  }

  /**
   * Run any registered custom handlers whose class matches `doc._class`.
   * Returns the target id from the first handler that resolves the doc.
   * Returns `undefined` when no handler matches or all handlers fall through.
   */
  private async runCustomHandlers (
    doc: Doc,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage
  ): Promise<Ref<Doc> | undefined> {
    if (this.customHandlers.length === 0) {
      return undefined
    }

    const targetHierarchy = this.targetClient.getHierarchy()

    for (const handler of this.customHandlers) {
      if (!targetHierarchy.isDerived(doc._class, handler.class)) {
        continue
      }

      try {
        const targetId = await handler.resolve(doc, {
          context: this.context,
          targetClient: this.targetClient,
          state: this.state,
          spaceExporter: this.spaceExporter,
          sourceHierarchy,
          sourceLowLevel
        })
        if (targetId !== undefined) {
          return targetId
        }
      } catch (err: any) {
        this.context.error(`Custom export handler for ${handler.class} failed on ${doc._id}:`, {
          error: err instanceof Error ? err.message : String(err),
          docId: doc._id
        })
        throw err
      }
    }

    return undefined
  }

  private async exportSpaceRelations (
    doc: Doc,
    space: Ref<Space>,
    conflictStrategy: 'skip' | 'duplicate',
    includeAttachments: boolean,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage,
    relations: RelationDefinition[],
    includeChildren: boolean
  ): Promise<void> {
    try {
      if (this.relationExporter === undefined) {
        return
      }

      const spaceDomain = sourceHierarchy.findDomain(core.class.Space)
      if (spaceDomain === undefined) {
        this.context.warn('Space domain not found')
        return
      }

      const sourceSpaces = await sourceLowLevel.rawFindAll<Space>(spaceDomain, { _id: space })
      const spaceDoc = sourceSpaces[0]
      if (spaceDoc == null) {
        this.context.warn(`Source space ${space} not found for exporting relations`)
        return
      }

      await this.relationExporter.exportAllRelations(
        spaceDoc,
        relations,
        conflictStrategy,
        includeAttachments,
        sourceHierarchy,
        sourceLowLevel,
        includeChildren
      )
    } catch (err: any) {
      this.context.error(`Failed to export relations for space ${space}:`, {
        error: err instanceof Error ? err.message : String(err),
        docId: doc._id
      })
    }
  }

  private async createDocument (
    sourceDoc: Doc,
    data: any,
    targetId: Ref<Doc>,
    targetSpace: Ref<Space>,
    isAttached: boolean,
    keepIdentifier: boolean = false
  ): Promise<void> {
    // A new version keeps the identifier of the document it extends.
    const shouldAllocate = !keepIdentifier && this.dataMapper.shouldAllocateIdentifier(sourceDoc._class)
    const parsedCode = shouldAllocate && typeof data.code === 'string' ? parseIdentifier(data.code) : null
    const hasSequence =
      shouldAllocate && typeof data.seqNumber === 'number' && Number.isSafeInteger(data.seqNumber) && data.seqNumber > 0
    const documentPrefix = typeof data.prefix === 'string' && data.prefix !== '' ? data.prefix : parsedCode?.prefix
    const usesSequenceCode = parsedCode !== null && parsedCode.prefix === documentPrefix
    const shouldAllocateSequence = parsedCode !== null && hasSequence && documentPrefix !== undefined

    let attachedData: Data<AttachedDoc> | undefined
    let attachedTo: AttachedDoc['attachedTo'] | undefined
    let attachedToClass: AttachedDoc['attachedToClass'] | undefined
    let collection: AttachedDoc['collection'] | undefined

    if (isAttached) {
      attachedData = data as Data<AttachedDoc>

      // attachedTo is already remapped in prepareDocumentData
      attachedTo = attachedData.attachedTo
      attachedToClass = attachedData.attachedToClass
      collection = attachedData.collection

      // Remove attached doc fields from data - they're passed as separate params to addCollection
      delete (attachedData as any).attachedTo
      delete (attachedData as any).attachedToClass
      delete (attachedData as any).collection
    }

    if (!shouldAllocateSequence || parsedCode === null || documentPrefix === undefined) {
      if (isAttached && attachedData !== undefined) {
        await this.targetClient.addCollection(
          sourceDoc._class,
          targetSpace,
          attachedTo as any,
          attachedToClass as any,
          collection as any,
          attachedData,
          targetId as any
        )
      } else {
        await this.targetClient.createDoc(sourceDoc._class, targetSpace, data, targetId)
      }
    } else {
      const sequenceQuery = (seqNumber: number): DocumentQuery<Doc> =>
        typeof data.template === 'string'
          ? { template: data.template, seqNumber }
          : { template: { $exists: false }, seqNumber }

      const outcome = await allocateWithRetries(
        this.targetClient,
        {
          namespace: DOCUMENT_SEQUENCE_NAMESPACE,
          scope: typeof data.template === 'string' ? data.template : TEMPLATE_SEQUENCE_SCOPE,
          sequence: DOCUMENT_SEQUENCE_KEY,
          minimum: data.seqNumber,
          codePrefix: usesSequenceCode ? documentPrefix : undefined,
          code: usesSequenceCode ? undefined : data.code,
          codeNamespace: DOCUMENT_NAMESPACE
        },
        async (seqNumber, code) => {
          data.seqNumber = seqNumber
          data.code = code

          const operations = this.targetClient.apply('export-allocation')
          operations.notMatch(sourceDoc._class, sequenceQuery(seqNumber))
          operations.notMatch(sourceDoc._class, { code })
          if (isAttached && attachedData !== undefined) {
            await operations.addCollection(
              sourceDoc._class,
              targetSpace,
              attachedTo as any,
              attachedToClass as any,
              collection as any,
              attachedData,
              targetId as any
            )
          } else {
            await operations.createDoc(sourceDoc._class, targetSpace, data, targetId)
          }
          return (await operations.commit()).result
        },
        async (seqNumber, code) => {
          const [sequenceConflict, codeConflict] = await Promise.all([
            this.targetClient.findOne(sourceDoc._class, sequenceQuery(seqNumber)),
            this.targetClient.findOne(sourceDoc._class, { code })
          ])
          return { sequence: sequenceConflict !== undefined, code: codeConflict !== undefined }
        }
      )

      if (!outcome.success) {
        throw new Error(`Unable to create document ${sourceDoc._id}: ${outcome.reason ?? 'unknown reason'}`)
      }
    }

    this.context.info(
      `Created document ${targetId} (from ${sourceDoc._id}) class ${sourceDoc._class} in space ${targetSpace}${isAttached ? ' [attached]' : ''}`
    )
  }

  /**
   * Decide whether `doc` reuses a document imported by an earlier export.
   * - Same source document already imported: reuse it.
   * - Another version of an already imported document: skip it, or create it as
   *   a new version of the imported document (see OriginResolver.planVersion).
   */
  private async resolveReuse (
    doc: Doc,
    root: boolean,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage
  ): Promise<{ kind: 'skip', reason: SkipReason, mapTo: Ref<Doc> } | { kind: 'create', plan?: NewVersionPlan }> {
    const resolver = this.originResolver
    if (resolver === undefined) return { kind: 'create' }

    const existing = await resolver.resolveExisting(doc, sourceHierarchy, sourceLowLevel)
    if (existing !== undefined) {
      return { kind: 'skip', reason: 'alreadyImported', mapTo: existing }
    }

    if (!resolver.isDocument(doc)) return { kind: 'create' }

    const targetMeta = await resolver.resolveMeta(doc.attachedTo)
    if (targetMeta === undefined) return { kind: 'create' }

    const decision = await resolver.planVersion(
      doc,
      targetMeta,
      root,
      this.existingDocuments === 'newVersion',
      sourceHierarchy,
      sourceLowLevel
    )
    if (decision.kind === 'skip') return decision
    return { kind: 'create', plan: decision.kind === 'newVersion' ? decision.plan : undefined }
  }

  /**
   * List the new version under the hierarchy entry of the document it extends:
   * map the source hierarchy entries of the document onto the target one, so the
   * exported ProjectDocument of the version attaches there instead of a new entry.
   */
  private async mapSourceProjectMetas (
    doc: VersionDoc,
    plan: NewVersionPlan,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage
  ): Promise<void> {
    const targetProjectMeta = plan.latestProjectDocument?.attachedTo
    if (targetProjectMeta === undefined) return
    const domain = sourceHierarchy.findDomain(DOCUMENTS.ProjectMeta)
    if (domain === undefined) return
    const sourceProjectMetas = await sourceLowLevel.rawFindAll<Doc>(domain, { meta: doc.attachedTo })
    for (const projectMeta of sourceProjectMetas) {
      if ((projectMeta as any).meta !== doc.attachedTo || this.state.idMapping.has(projectMeta._id)) continue
      this.state.idMapping.set(projectMeta._id, targetProjectMeta)
    }
  }

  /** Make sure the new version is listed in the document tree, next to the version it extends. */
  private async ensureListedInHierarchy (targetId: Ref<Doc>, plan: NewVersionPlan): Promise<void> {
    const latest = plan.latestProjectDocument
    if (latest === undefined || this.originResolver === undefined) {
      this.context.warn(`No hierarchy entry found for ${plan.latest._id}, new version ${targetId} is not listed`)
      return
    }
    const existing = await this.originResolver.findProjectDocumentOf(targetId)
    if (existing !== undefined) return
    await this.targetClient.addCollection(
      DOCUMENTS.ProjectDocument,
      latest.space,
      latest.attachedTo,
      latest.attachedToClass,
      latest.collection,
      { project: latest.project, initial: latest.project, document: targetId }
    )
  }

  /**
   * Folders are listed in the tree through a ProjectDocument pointing at the
   * Folder id, which no relation reaches. Without it a folder (and everything
   * under it) is not shown, so export it together with the folder's ProjectMeta.
   */
  private async exportFolderEntries (
    projectMeta: Doc,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage,
    relations: RelationDefinition[],
    includeChildren: boolean
  ): Promise<void> {
    const domain = sourceHierarchy.findDomain(DOCUMENTS.ProjectDocument)
    if (domain === undefined) return
    const entries = await sourceLowLevel.rawFindAll<Doc>(domain, {
      attachedTo: projectMeta._id,
      document: DOCUMENTS.Folder
    })
    for (const entry of entries) {
      const prjdoc = entry as any
      if (prjdoc.attachedTo !== projectMeta._id || prjdoc.document !== DOCUMENTS.Folder) continue
      await this.exportDocument(
        entry,
        'duplicate',
        false,
        sourceHierarchy,
        sourceLowLevel,
        new Map(),
        relations,
        includeChildren
      )
    }
  }

  private async exportCollections (
    sourceDoc: Doc,
    targetDocId: Ref<Doc>,
    sourceHierarchy: Hierarchy,
    sourceLowLevel: LowLevelStorage,
    relations: RelationDefinition[],
    includeChildren: boolean
  ): Promise<void> {
    const attributes = sourceHierarchy.getAllAttributes(sourceDoc._class)

    for (const [key, attr] of Array.from(attributes)) {
      if (attr.type._class !== core.class.Collection) {
        continue
      }

      const collectionClass = (attr.type as Collection<AttachedDoc>).of as Ref<Class<Doc>>
      const domain = sourceHierarchy.findDomain(collectionClass)
      if (domain === undefined) {
        this.context.warn(`Domain not found for collection ${key}`)
        continue
      }

      // Query collection items using rawFindAll
      const collectionDocs = await sourceLowLevel.rawFindAll<Doc>(domain, {
        _class: collectionClass,
        attachedTo: sourceDoc._id,
        attachedToClass: sourceDoc._class,
        collection: key
      })

      if (collectionDocs.length > 0) {
        this.context.info(`Exporting ${collectionDocs.length} items in collection ${key}`)
      }

      for (const collectionDoc of collectionDocs) {
        try {
          // Don't modify attachedTo here - the ID remapping happens in createDocument
          // The source document still has the source attachedTo ID which will be remapped
          await this.exportDocument(
            collectionDoc,
            'duplicate',
            true,
            sourceHierarchy,
            sourceLowLevel,
            new Map(),
            relations,
            includeChildren
          )
        } catch (err: any) {
          this.context.error(`Failed to export collection item ${collectionDoc._id}:`, {
            error: err instanceof Error ? err.message : String(err),
            docId: collectionDoc._id
          })
        }
      }
    }
  }
}

/**
 * Turn prepared document data into a new version of an already imported document:
 * same identifier, next version number (following the target's own numbering) and
 * the team of the target's latest version, which are people of the target workspace.
 */
function applyVersionPlan (data: Record<string, any>, plan: NewVersionPlan): void {
  const { latest } = plan
  data.code = latest.code
  data.prefix = latest.prefix
  data.seqNumber = latest.seqNumber
  data.major = plan.major
  data.minor = plan.minor
  if (latest.owner !== undefined) data.owner = latest.owner
  data.reviewers = latest.reviewers ?? []
  data.approvers = latest.approvers ?? []
  data.coAuthors = latest.coAuthors ?? []
  data.externalApprovers = []
  data.attachedTo = plan.targetMeta
  data.attachedToClass = latest.attachedToClass
  data.collection = latest.collection

  // Templates number their documents with their own counter: keep the target's.
  const latestTemplate = (latest as any)[DOCUMENTS.DocumentTemplate]
  const template = data[DOCUMENTS.DocumentTemplate]
  if (latestTemplate !== undefined && template !== undefined && typeof template === 'object') {
    data[DOCUMENTS.DocumentTemplate] = {
      ...template,
      sequence: latestTemplate.sequence,
      docPrefix: latestTemplate.docPrefix
    }
  }
}
