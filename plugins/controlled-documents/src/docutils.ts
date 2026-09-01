//
// Copyright © 2023 Hardcore Engineering Inc.
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

import { type Employee } from '@hcengineering/contact'
import {
  requestIdentifierAllocation,
  requestNumberAllocation,
  type AttachedData,
  type Blob,
  type Class,
  type Data,
  type DocumentQuery,
  type Mixin,
  type Ref,
  SortingOrder,
  type Space,
  type TxOperations
} from '@hcengineering/core'
import {
  type ChangeControl,
  type ControlledDocument,
  type Document,
  type DocumentCategory,
  type DocumentMeta,
  type DocumentSpace,
  type DocumentTemplate,
  type HierarchyDocument,
  type Project,
  type ProjectDocument,
  DocumentState
} from './types'
import { makeRank } from '@hcengineering/rank'

import documents, { documentsId } from './plugin'
import { getFirstRank, matchDocumentId, TEMPLATE_PREFIX } from './utils'

export const DOCUMENT_SEQUENCE_NAMESPACE = `${documentsId}.sequence`
export const TEMPLATE_SEQUENCE_SCOPE = 'templates'
export const DOCUMENT_SEQUENCE_KEY = 'seqNumber'
const MAX_ALLOCATION_ATTEMPTS = 10

async function getParentPath (client: TxOperations, parent: Ref<ProjectDocument>): Promise<Array<Ref<DocumentMeta>>> {
  const parentDocObj = await client.findOne(documents.class.ProjectDocument, {
    _id: parent
  })

  if (parentDocObj === undefined) {
    console.warn(`Couldn't find the parent project document object with id: ${parent}`)
    return []
  }

  const parentMeta = await client.findOne(documents.class.ProjectMeta, {
    _id: parentDocObj.attachedTo
  })

  if (parentMeta === undefined) {
    console.warn(`Couldn't find the parent document meta with id: ${parentDocObj.attachedTo}`)
    return []
  }

  return [parentMeta.meta, ...parentMeta.path]
}

export async function createControlledDocFromTemplate (
  client: TxOperations,
  templateId: Ref<DocumentTemplate> | undefined,
  documentId: Ref<ControlledDocument>,
  spec: AttachedData<ControlledDocument>,
  space: Ref<DocumentSpace>,
  project: Ref<Project> | undefined,
  parent: Ref<ProjectDocument> | undefined,
  docClass: Ref<Class<ControlledDocument>> = documents.class.ControlledDocument
): Promise<{ seqNumber: number, success: boolean }> {
  if (templateId == null) {
    return { seqNumber: -1, success: false }
  }

  const {
    seqNumber: minimum,
    prefix,
    content,
    category,
    templateSpace
  } = await useDocumentTemplate(client, templateId, true)
  if (minimum < 1) {
    console.warn('createControlledDocFromTemplate: template not found', { templateId })
    return { seqNumber: -1, success: false }
  }

  const parsedCode = spec.code === '' ? undefined : matchDocumentId(spec.code)
  if (parsedCode === null) throw new Error(`Invalid document code: ${spec.code}`)

  const usesSequenceCode = parsedCode === undefined || parsedCode.prefix === prefix
  const seqNumber = await requestNumberAllocation(client, {
    namespace: DOCUMENT_SEQUENCE_NAMESPACE,
    scope: templateId,
    sequence: DOCUMENT_SEQUENCE_KEY,
    minimum
  })

  return await allocateDocumentIdentifier(
    client,
    {
      scope: templateId,
      conflictQuery: { template: templateId },
      codePrefix: usesSequenceCode ? prefix : undefined
    },
    { seqNumber, code: usesSequenceCode ? `${prefix}-${seqNumber}` : spec.code },
    async (seqNumber, code) =>
      await createControlledDocAttempt(
        client,
        templateId,
        documentId,
        spec,
        space,
        project,
        parent,
        prefix,
        seqNumber,
        code,
        content,
        category,
        templateSpace,
        docClass
      )
  )
}

export interface SequenceAllocation {
  /** Scope of the numeric sequence the value is allocated from. */
  scope: string
  /** Query selecting documents that share the allocated sequence. */
  conflictQuery: DocumentQuery<Document>
  /** Prefix the code is derived from, when the code follows the sequence. */
  codePrefix?: string
}

export interface AllocationResult {
  seqNumber: number
  success: boolean
  /** Why the creation was given up on, when it did not succeed. */
  reason?: string
}

/**
 * Retries a document creation attempt while its sequence or code is taken by a concurrent creation.
 * A failure with no conflicting document is not an allocation problem, so it is not retried.
 */
export async function allocateDocumentIdentifier (
  client: TxOperations,
  allocation: SequenceAllocation,
  initial: { seqNumber: number, code: string },
  attempt: (seqNumber: number, code: string) => Promise<boolean>,
  isAborted?: () => Promise<boolean>
): Promise<AllocationResult> {
  let { seqNumber, code } = initial

  for (let attemptIndex = 0; attemptIndex < MAX_ALLOCATION_ATTEMPTS; attemptIndex++) {
    if (await attempt(seqNumber, code)) return { seqNumber, success: true }
    if (isAborted !== undefined && (await isAborted())) {
      return { seqNumber: -1, success: false, reason: 'the allocation was aborted' }
    }

    const [sequenceConflict, codeConflict] = await Promise.all([
      client.findOne(documents.class.Document, { ...allocation.conflictQuery, seqNumber }),
      client.findOne(documents.class.Document, { code })
    ])
    if (sequenceConflict === undefined && codeConflict === undefined) {
      return { seqNumber: -1, success: false, reason: 'creation failed without an identifier conflict' }
    }

    if (sequenceConflict !== undefined || (allocation.codePrefix !== undefined && codeConflict !== undefined)) {
      seqNumber = await requestNumberAllocation(client, {
        namespace: DOCUMENT_SEQUENCE_NAMESPACE,
        scope: allocation.scope,
        sequence: DOCUMENT_SEQUENCE_KEY
      })
    }
    if (allocation.codePrefix !== undefined) {
      code = `${allocation.codePrefix}-${seqNumber}`
    } else if (codeConflict !== undefined) {
      code = await requestNextIdentifier(client, code)
    }
  }

  return { seqNumber: -1, success: false, reason: `no free identifier after ${MAX_ALLOCATION_ATTEMPTS} attempts` }
}

async function requestNextIdentifier (client: TxOperations, occupiedCode: string): Promise<string> {
  const parsedCode = matchDocumentId(occupiedCode)
  if (parsedCode === null) throw new Error(`Invalid document code: ${occupiedCode}`)
  return await requestIdentifierAllocation(client, {
    namespace: documentsId,
    prefix: parsedCode.prefix,
    minimum: parsedCode.seqNumber + 1
  })
}

/**
 * Calculate the next available seqNumber by checking existing documents with the template.
 */
async function calculateNextSeqNumberWithCheck (
  client: TxOperations,
  templateId: Ref<DocumentTemplate>,
  currentTemplateSequence: number
): Promise<number> {
  const lastDocument = await client.findOne(
    documents.class.Document,
    { template: templateId },
    { sort: { seqNumber: SortingOrder.Descending }, projection: { seqNumber: 1 } }
  )

  return Math.max(currentTemplateSequence, lastDocument?.seqNumber ?? -1) + 1
}

export async function useDocumentTemplate (
  client: TxOperations,
  templateId: Ref<DocumentTemplate>,
  checkExisting: boolean = false
): Promise<{
    seqNumber: number
    prefix: string
    content: Ref<Blob> | null
    category: Ref<DocumentCategory>
    templateSpace: Ref<Space>
  }> {
  const template = await client.findOne(documents.mixin.DocumentTemplate, {
    _id: templateId
  })

  if (template === undefined) {
    return {
      seqNumber: -1,
      prefix: '',
      content: null,
      category: '' as Ref<DocumentCategory>,
      templateSpace: '' as Ref<Space>
    }
  }

  let nextSeqNumber: number

  if (checkExisting) {
    nextSeqNumber = await calculateNextSeqNumberWithCheck(client, templateId, template.sequence)
  } else {
    nextSeqNumber = template.sequence + 1
  }

  const prefix = template.docPrefix

  return {
    seqNumber: nextSeqNumber,
    prefix,
    content: template.content,
    category: template.category as Ref<DocumentCategory>,
    templateSpace: template.space
  }
}

async function createControlledDocAttempt (
  client: TxOperations,
  templateId: Ref<DocumentTemplate>,
  documentId: Ref<ControlledDocument>,
  spec: AttachedData<ControlledDocument>,
  space: Ref<DocumentSpace>,
  project: Ref<Project> | undefined,
  parent: Ref<ProjectDocument> | undefined,
  prefix: string,
  seqNumber: number,
  code: string,
  content: Ref<Blob> | null,
  category: Ref<DocumentCategory>,
  templateSpace: Ref<Space>,
  docClass: Ref<Class<ControlledDocument>>
): Promise<boolean> {
  const projectId = project ?? documents.ids.NoProject

  const ops = client.apply('create-qms-document')
  ops.notMatch(documents.class.Document, { template: templateId, seqNumber })
  ops.notMatch(documents.class.Document, { code })

  const documentMetaId = await ops.createDoc(documents.class.DocumentMeta, space, {
    documents: 0,
    title: `${code} ${spec.title}`
  })

  let path: Array<Ref<DocumentMeta>> = []
  if (parent !== undefined) {
    path = await getParentPath(client, parent)
  }

  const parentMeta = path[0] ?? documents.ids.NoParent
  const lastRank = await getFirstRank(client, space, projectId, parentMeta)

  const projectMetaId = await ops.createDoc(documents.class.ProjectMeta, space, {
    project: projectId,
    meta: documentMetaId,
    path,
    parent: parentMeta,
    documents: 0,
    rank: makeRank(lastRank, undefined)
  })

  await ops.addCollection(
    documents.class.ProjectDocument,
    space,
    projectMetaId,
    documents.class.ProjectMeta,
    'documents',
    {
      project: projectId,
      initial: projectId,
      document: documentId
    }
  )

  await ops.addCollection(
    docClass,
    space,
    documentMetaId,
    documents.class.DocumentMeta,
    'documents',
    {
      ...spec,
      code,
      category,
      template: templateId,
      seqNumber,
      prefix,
      state: DocumentState.Draft,
      content
    },
    documentId
  )

  // Best effort hint for the UI: concurrent creations may leave it behind,
  // the custom sequence stays the source of truth.
  await ops.updateMixin(templateId, documents.class.Document, templateSpace, documents.mixin.DocumentTemplate, {
    sequence: seqNumber
  })

  const success = await ops.commit()

  if (!success.result) {
    console.warn('createControlledDocAttempt: ops.commit() failed', {
      templateId,
      documentId,
      space,
      project,
      parent,
      prefix,
      seqNumber
    })
  }

  return success.result
}

/**
 * Creates hierarchy metadata without reserving a document code.
 *
 * @deprecated Prefer APIs that create the metadata and controlled document in one operation.
 */
export async function createControlledDocMetadata (
  client: TxOperations,
  templateId: Ref<DocumentTemplate>,
  documentId: Ref<ControlledDocument>,
  space: Ref<DocumentSpace>,
  project: Ref<Project> | undefined,
  parent: Ref<ProjectDocument> | undefined,
  prefix: string,
  seqNumber: number,
  specCode: string,
  specTitle: string,
  metaId?: Ref<DocumentMeta>
): Promise<{
    success: boolean
    seqNumber: number
    documentMetaId: Ref<DocumentMeta>
    projectDocumentId: Ref<ProjectDocument>
  }> {
  const projectId = project ?? documents.ids.NoProject
  const ops = client.apply('create-qms-document-metadata')
  const documentMetaId = await ops.createDoc(
    documents.class.DocumentMeta,
    space,
    { documents: 0, title: `${specCode} ${specTitle}` },
    metaId
  )
  const path = parent === undefined ? [] : await getParentPath(client, parent)
  const parentMeta = path[0] ?? documents.ids.NoParent
  const lastRank = await getFirstRank(client, space, projectId, parentMeta)
  const projectMetaId = await ops.createDoc(documents.class.ProjectMeta, space, {
    project: projectId,
    meta: documentMetaId,
    path,
    parent: parentMeta,
    documents: 0,
    rank: makeRank(lastRank, undefined)
  })
  const projectDocumentId = await ops.addCollection(
    documents.class.ProjectDocument,
    space,
    projectMetaId,
    documents.class.ProjectMeta,
    'documents',
    { project: projectId, initial: projectId, document: documentId }
  )
  const success = await ops.commit()

  return { success: success.result, seqNumber, documentMetaId, projectDocumentId }
}

export async function createDocumentTemplate (
  client: TxOperations,
  _class: Ref<Class<Document>>,
  space: Ref<DocumentSpace>,
  _mixin: Ref<Mixin<DocumentTemplate>>,
  project: Ref<Project> | undefined,
  parent: Ref<ProjectDocument> | undefined,
  templateId: Ref<ControlledDocument>,
  prefix: string,
  spec: Omit<AttachedData<ControlledDocument>, 'prefix'>,
  category: Ref<DocumentCategory>,
  author?: Ref<Employee>,
  changeControl?: { id: Ref<ChangeControl>, data: Data<ChangeControl> }
): Promise<{ seqNumber: number, success: boolean }> {
  const requestedCode = spec.code ?? ''
  const parsedCode = requestedCode === '' ? undefined : matchDocumentId(requestedCode)
  if (parsedCode === null) throw new Error(`Invalid document code: ${requestedCode}`)

  const usesSequenceCode = parsedCode === undefined || parsedCode.prefix === TEMPLATE_PREFIX
  const lastTemplate = await client.findOne(
    documents.class.Document,
    { template: { $exists: false } },
    { sort: { seqNumber: SortingOrder.Descending }, projection: { seqNumber: 1 } }
  )
  const minimum = Math.max(spec.seqNumber, (lastTemplate?.seqNumber ?? 0) + 1, 1)
  const seqNumber = await requestNumberAllocation(client, {
    namespace: DOCUMENT_SEQUENCE_NAMESPACE,
    scope: TEMPLATE_SEQUENCE_SCOPE,
    sequence: DOCUMENT_SEQUENCE_KEY,
    minimum
  })

  return await allocateDocumentIdentifier(
    client,
    {
      scope: TEMPLATE_SEQUENCE_SCOPE,
      conflictQuery: { template: { $exists: false } },
      codePrefix: usesSequenceCode ? TEMPLATE_PREFIX : undefined
    },
    { seqNumber, code: usesSequenceCode ? `${TEMPLATE_PREFIX}-${seqNumber}` : requestedCode },
    async (seqNumber, code) =>
      await createDocumentTemplateAttempt(client, {
        _class,
        space,
        _mixin,
        project,
        parent,
        templateId,
        prefix,
        spec,
        category,
        author,
        changeControl,
        seqNumber,
        code
      }),
    // A template prefix is unique, so a taken prefix can never be resolved by a new sequence.
    async () => (await client.findOne(documents.mixin.DocumentTemplate, { docPrefix: prefix })) !== undefined
  )
}

interface DocumentTemplateAttempt {
  _class: Ref<Class<Document>>
  space: Ref<DocumentSpace>
  _mixin: Ref<Mixin<DocumentTemplate>>
  project: Ref<Project> | undefined
  parent: Ref<ProjectDocument> | undefined
  templateId: Ref<ControlledDocument>
  prefix: string
  spec: Omit<AttachedData<ControlledDocument>, 'prefix'>
  category: Ref<DocumentCategory>
  author: Ref<Employee> | undefined
  changeControl: { id: Ref<ChangeControl>, data: Data<ChangeControl> } | undefined
  seqNumber: number
  code: string
}

async function createDocumentTemplateAttempt (client: TxOperations, data: DocumentTemplateAttempt): Promise<boolean> {
  const projectId = data.project ?? documents.ids.NoProject
  const ops = client.apply('create-qms-document')
  ops.notMatch(documents.mixin.DocumentTemplate, { docPrefix: data.prefix })
  ops.notMatch(documents.class.Document, { template: { $exists: false }, seqNumber: data.seqNumber })
  ops.notMatch(documents.class.Document, { code: data.code })

  const path = data.parent === undefined ? [] : await getParentPath(client, data.parent)
  const parentMeta = path[0] ?? documents.ids.NoParent
  const documentMetaId = await ops.createDoc(documents.class.DocumentMeta, data.space, {
    documents: 0,
    title: `${data.code} ${data.spec.title}`
  })
  const lastRank = await getFirstRank(client, data.space, projectId, parentMeta)
  const projectMetaId = await ops.createDoc(documents.class.ProjectMeta, data.space, {
    project: projectId,
    meta: documentMetaId,
    path,
    parent: parentMeta,
    documents: 0,
    rank: makeRank(lastRank, undefined)
  })
  await ops.addCollection(
    documents.class.ProjectDocument,
    data.space,
    projectMetaId,
    documents.class.ProjectMeta,
    'documents',
    { project: projectId, initial: projectId, document: data.templateId }
  )
  await ops.addCollection<DocumentMeta, HierarchyDocument>(
    data._class,
    data.space,
    documentMetaId,
    documents.class.DocumentMeta,
    'documents',
    {
      ...data.spec,
      code: data.code,
      seqNumber: data.seqNumber,
      category: data.category,
      prefix: TEMPLATE_PREFIX,
      author: data.author,
      owner: data.author,
      content: data.spec.content ?? null
    },
    data.templateId
  )
  await ops.createMixin(data.templateId, documents.class.Document, data.space, data._mixin, {
    sequence: 0,
    docPrefix: data.prefix
  })
  if (data.changeControl !== undefined) {
    await ops.createDoc(documents.class.ChangeControl, data.space, data.changeControl.data, data.changeControl.id)
  }
  return (await ops.commit()).result
}

/**
 * Creates template hierarchy metadata without reserving a document code.
 *
 * @deprecated Prefer {@link createDocumentTemplate}, which creates the template atomically.
 */
export async function createDocumentTemplateMetadata (
  client: TxOperations,
  _class: Ref<Class<Document>>,
  space: Ref<DocumentSpace>,
  _mixin: Ref<Mixin<DocumentTemplate>>,
  project: Ref<Project> | undefined,
  parent: Ref<ProjectDocument> | undefined,
  templateId: Ref<ControlledDocument>,
  prefix: string,
  specCode: string,
  specTitle: string,
  metaId?: Ref<DocumentMeta>
): Promise<{
    success: boolean
    seqNumber: number
    code: string
    documentMetaId: Ref<DocumentMeta>
    projectDocumentId: Ref<ProjectDocument>
  }> {
  const parsedCode = specCode === '' ? undefined : matchDocumentId(specCode)
  const seqNumber = parsedCode?.seqNumber ?? 1
  const code = specCode === '' ? `${TEMPLATE_PREFIX}-${seqNumber}` : specCode
  const projectId = project ?? documents.ids.NoProject
  const ops = client.apply('create-qms-document-metadata')
  ops.notMatch(documents.mixin.DocumentTemplate, { docPrefix: prefix })

  const documentMetaId = await ops.createDoc(
    documents.class.DocumentMeta,
    space,
    { documents: 0, title: `${code} ${specTitle}` },
    metaId
  )
  const path = parent === undefined ? [] : await getParentPath(client, parent)
  const parentMeta = path[0] ?? documents.ids.NoParent
  const lastRank = await getFirstRank(client, space, projectId, parentMeta)
  const projectMetaId = await ops.createDoc(documents.class.ProjectMeta, space, {
    project: projectId,
    meta: documentMetaId,
    path,
    parent: parentMeta,
    documents: 0,
    rank: makeRank(lastRank, undefined)
  })
  const projectDocumentId = await ops.addCollection(
    documents.class.ProjectDocument,
    space,
    projectMetaId,
    documents.class.ProjectMeta,
    'documents',
    { project: projectId, initial: projectId, document: templateId }
  )
  const success = await ops.commit()

  return { success: success.result, seqNumber, code, documentMetaId, projectDocumentId }
}

export async function createNewFolder (
  client: TxOperations,
  space: Ref<DocumentSpace>,
  project: Ref<Project> | undefined,
  parent: Ref<ProjectDocument> | undefined,
  title: string
): Promise<{
    success: boolean
    documentMetaId: Ref<DocumentMeta>
    projectDocumentId: Ref<ProjectDocument>
  }> {
  const projectId = project ?? documents.ids.NoProject

  const ops = client.apply()

  const documentMetaId = await ops.createDoc(documents.class.DocumentMeta, space, { documents: 0, title })

  let path: Array<Ref<DocumentMeta>> = []
  if (parent !== undefined) {
    path = await getParentPath(client, parent)
  }

  const parentMeta = path[0] ?? documents.ids.NoParent
  const lastRank = await getFirstRank(client, space, projectId, parentMeta)

  const projectMetaId = await ops.createDoc(documents.class.ProjectMeta, space, {
    project: projectId,
    meta: documentMetaId,
    path,
    parent: parentMeta,
    documents: 0,
    rank: makeRank(lastRank, undefined)
  })

  const projectDocumentId = await client.addCollection(
    documents.class.ProjectDocument,
    space,
    projectMetaId,
    documents.class.ProjectMeta,
    'documents',
    {
      project: projectId,
      initial: projectId,
      document: documents.ids.Folder
    }
  )

  const success = await ops.commit()

  if (!success.result) {
    console.warn('createNewFolder: ops.commit() failed', {
      space,
      project,
      parent,
      title,
      documentMetaId,
      projectDocumentId
    })
  }

  return { success: success.result, documentMetaId, projectDocumentId }
}
