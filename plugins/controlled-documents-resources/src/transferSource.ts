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
import documents, {
  type Document,
  type DocumentMeta,
  type DocumentSpace,
  type HierarchyDocument,
  type Project,
  type ProjectDocument
} from '@hcengineering/controlled-documents'
import { type Hierarchy, type Ref, type TxOperations } from '@hcengineering/core'

/**
 * @public
 */
export interface TransferSource {
  sourceDocumentIds: Array<Ref<DocumentMeta>>
  sourceSpaceId: Ref<DocumentSpace>
  sourceProjectId: Ref<Project<DocumentSpace>> | undefined
}

/**
 * Resolves the source of a document transfer from the selected objects.
 *
 * - `ProjectDocument` selection (sidebar tree) already points at a concrete project.
 * - `Document` selection (library list, document view): a document has one `ProjectDocument`
 *   per project of its space (project versions copy them), so the lookup is restricted to the
 *   latest project of the space instead of picking an arbitrary one.
 *
 * Returns `undefined` when the selection cannot be transferred as a single batch:
 * it is empty, spans several spaces, or has no project document in the resolved project.
 */
export async function resolveTransferSource (
  client: Pick<TxOperations, 'findAll'>,
  hierarchy: Pick<Hierarchy, 'isDerived'>,
  objects: Array<Document | ProjectDocument>,
  getLatestProjectId: (space: Ref<DocumentSpace>) => Promise<Ref<Project<DocumentSpace>> | undefined>
): Promise<TransferSource | undefined> {
  if (objects.length < 1) return undefined

  const spaces = new Set(objects.map((o) => o.space))
  if (spaces.size !== 1) return undefined
  const sourceSpaceId = objects[0].space

  let pjDocs: ProjectDocument[] = []
  let sourceProjectId: Ref<Project<DocumentSpace>> | undefined

  if (hierarchy.isDerived(objects[0]._class, documents.class.ProjectDocument)) {
    pjDocs = objects as ProjectDocument[]
    sourceProjectId = pjDocs[0].project
  } else if (hierarchy.isDerived(objects[0]._class, documents.class.Document)) {
    sourceProjectId = await getLatestProjectId(sourceSpaceId)
    if (sourceProjectId === undefined) return undefined

    pjDocs = await client.findAll(documents.class.ProjectDocument, {
      space: sourceSpaceId,
      project: sourceProjectId,
      document: { $in: objects.map((d) => d._id as Ref<HierarchyDocument>) }
    })
  }

  if (pjDocs.length < 1) return undefined

  const pjMeta = await client.findAll(documents.class.ProjectMeta, { _id: { $in: pjDocs.map((d) => d.attachedTo) } })
  const docMeta = await client.findAll(documents.class.DocumentMeta, { _id: { $in: pjMeta.map((d) => d.meta) } })

  // several versions of the same controlled document share one DocumentMeta
  const sourceDocumentIds = Array.from(new Set(docMeta.map((d) => d._id)))
  if (sourceDocumentIds.length < 1) return undefined

  return { sourceDocumentIds, sourceSpaceId, sourceProjectId }
}
