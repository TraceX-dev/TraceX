//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import contact, { getEmployeeBySocialId, type Employee } from '@hcengineering/contact'
import {
  generateId,
  SortingOrder,
  type ApplyOperations,
  type AttachedDoc,
  type Class,
  type Ref
} from '@hcengineering/core'
import documents, {
  ControlledDocumentState,
  DocumentState,
  type ChangeControl,
  type ControlledDocument,
  type DocumentAttachment,
  type DocumentRequest
} from '@hcengineering/controlled-documents'
import type { WorkspaceApiContext } from '@hcengineering/integration'
import { RequestStatus } from '@hcengineering/request'
import training, { TrainingState, type Training } from '@hcengineering/training'

type Input = Record<string, unknown>

function idFrom (input: Input): Ref<ControlledDocument> {
  if (typeof input.id !== 'string' || input.id.trim() === '') throw new Error('Controlled document id is required')
  return input.id as Ref<ControlledDocument>
}

function namesFrom (input: Input, field: 'reviewers' | 'approvers'): string[] {
  const value = input[field]
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((name) => typeof name !== 'string' || name.trim() === '')
  ) {
    throw new Error(`${field} must contain at least one employee name`)
  }
  return value
}

async function getDocument (context: WorkspaceApiContext, input: Input): Promise<ControlledDocument> {
  const document = await context.client.findOne(documents.class.ControlledDocument, { _id: idFrom(input) })
  if (document === undefined) throw new Error(`Controlled document with id "${String(input.id)}" was not found`)
  return document
}

async function getVersions (context: WorkspaceApiContext, document: ControlledDocument): Promise<ControlledDocument[]> {
  return await context.client.findAll(
    documents.class.ControlledDocument,
    {
      attachedTo: document.attachedTo,
      attachedToClass: document.attachedToClass,
      collection: document.collection
    },
    { sort: { major: SortingOrder.Descending, minor: SortingOrder.Descending, patch: SortingOrder.Descending } }
  )
}

async function currentEmployee (context: WorkspaceApiContext): Promise<Employee> {
  const employee = await getEmployeeBySocialId(context.client, context.currentUser)
  if (employee === undefined || !employee.active) throw new Error('The API key user is not an active employee')
  return employee
}

async function assertOwner (context: WorkspaceApiContext, document: ControlledDocument): Promise<void> {
  const employee = await currentEmployee(context)
  if (document.owner === undefined || document.owner !== employee._id) {
    throw new Error('Only the controlled document owner can perform this operation')
  }
}

async function assertLatest (context: WorkspaceApiContext, document: ControlledDocument): Promise<void> {
  const versions = await getVersions(context, document)
  if (versions[0]?._id !== document._id) throw new Error('Only the latest controlled document version can be used')
}

async function resolveEmployees (
  context: WorkspaceApiContext,
  names: string[],
  role: 'reviewer' | 'approver'
): Promise<Array<Ref<Employee>>> {
  const employees = await context.client.findAll<Employee>(contact.mixin.Employee, {})
  // Employee is a mixin. Query through the contact mixin rather than accepting
  // arbitrary document ids from callers.
  const activeEmployees = employees.filter((employee) => employee.active)
  const result: Array<Ref<Employee>> = []
  for (const name of names) {
    const matches = activeEmployees.filter((employee) => employee.name === name)
    if (matches.length === 0) throw new Error(`Active employee named "${name}" was not found`)
    if (matches.length > 1) throw new Error(`Employee name "${name}" is ambiguous`)
    if (result.includes(matches[0]._id)) throw new Error(`${role} "${name}" was provided more than once`)
    result.push(matches[0]._id)
  }
  return result
}

async function assertCanSendForApproval (context: WorkspaceApiContext, document: ControlledDocument): Promise<void> {
  const reviews = await context.client.findAll<DocumentRequest>(documents.class.DocumentReviewRequest, {
    attachedTo: document._id
  })
  if (
    !(
      (document.state === DocumentState.Draft && reviews.length === 0) ||
      document.controlledState === ControlledDocumentState.Reviewed
    )
  ) {
    throw new Error('Controlled document must be a new draft or successfully reviewed before approval')
  }
  const unresolved = await context.client.findAll(
    documents.class.DocumentComment,
    { attachedTo: document._id, resolved: { $ne: true } },
    { limit: 1 }
  )
  if (unresolved.length > 0) throw new Error('All controlled document comments must be resolved before approval')

  const hierarchy = context.client.getHierarchy()
  if (hierarchy.hasMixin(document, documents.mixin.DocumentTraining)) {
    const documentTraining = hierarchy.as(document, documents.mixin.DocumentTraining) as unknown as {
      training?: string
    }
    if (documentTraining.training !== undefined) {
      const query = { _id: documentTraining.training as Ref<Training> }
      const trainingDoc = await context.client.findOne(training.class.Training, query as never)
      if (trainingDoc === undefined || trainingDoc.state !== TrainingState.Released) {
        throw new Error('Document training must be released before approval')
      }
    }
  }
}

async function createRequest (
  context: WorkspaceApiContext,
  document: ControlledDocument,
  requestClass: Ref<Class<DocumentRequest>>,
  requested: Array<Ref<Employee>>,
  update: Record<string, unknown>,
  approvedState: ControlledDocumentState,
  rejectedState?: ControlledDocumentState
): Promise<void> {
  const operations = context.client.apply('workspace-api-controlled-document-request')
  for (const activeRequestClass of [documents.class.DocumentReviewRequest, documents.class.DocumentApprovalRequest]) {
    operations.notMatch(activeRequestClass, {
      attachedTo: document._id,
      attachedToClass: document._class,
      status: RequestStatus.Active
    })
  }
  await operations.update(document, update)
  const approvedTx = context.client.txFactory.createTxUpdateDoc(document._class, document.space, document._id, {
    controlledState: approvedState
  })
  const rejectedTx =
    rejectedState === undefined
      ? undefined
      : context.client.txFactory.createTxUpdateDoc(document._class, document.space, document._id, {
        controlledState: rejectedState
      })
  await operations.addCollection(requestClass, document.space, document._id, document._class, 'requests', {
    requested,
    approved: [],
    tx: approvedTx,
    rejectedTx,
    status: RequestStatus.Active,
    requiredApprovesCount: requested.length
  })
  const committed = await operations.commit()
  if (!committed.result) throw new Error('Unable to create controlled document request')
}

async function copyAttachments (
  context: WorkspaceApiContext,
  operations: ApplyOperations,
  source: ControlledDocument,
  draftId: Ref<ControlledDocument>
): Promise<void> {
  const hierarchy = context.client.getHierarchy()
  const attachments = await context.client.findAll(documents.mixin.DocumentAttachment, { attachedTo: source._id })
  for (const item of attachments) {
    if (hierarchy.hasMixin(item, documents.mixin.DocumentAttachment)) {
      const documentAttachment = hierarchy.as(item, documents.mixin.DocumentAttachment) as unknown as {
        deletedIn?: unknown
      }
      if (documentAttachment.deletedIn !== undefined && documentAttachment.deletedIn !== null) continue
    }
    const id = generateId<DocumentAttachment>()
    await operations.addCollection(
      item._class,
      source.space,
      draftId,
      source._class,
      'attachments',
      {
        file: item.file,
        name: item.name,
        type: item.type,
        size: item.size,
        lastModified: item.lastModified,
        metadata: item.metadata
      },
      id
    )
    await operations.updateMixin<AttachedDoc, DocumentAttachment>(
      id as Ref<AttachedDoc>,
      item._class as Ref<Class<AttachedDoc>>,
      source.space,
      documents.mixin.DocumentAttachment,
      { state: 'referenced' }
    )
  }
}

export async function FindControlledDocuments (
  context: WorkspaceApiContext,
  input: Input
): Promise<ControlledDocument[]> {
  const limit = input.limit === undefined ? 100 : input.limit
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 1000) {
    throw new Error('limit must be an integer from 1 to 1000')
  }
  return await context.client.findAll(documents.class.ControlledDocument, {}, { limit: limit as number })
}

export async function GetControlledDocument (context: WorkspaceApiContext, input: Input): Promise<ControlledDocument> {
  return await getDocument(context, input)
}

export async function GetControlledDocumentVersions (
  context: WorkspaceApiContext,
  input: Input
): Promise<{ current: ControlledDocument[], archived: ControlledDocument[] }> {
  const versions = await getVersions(context, await getDocument(context, input))
  const effectiveIndex = versions.findIndex((version) => version.state === DocumentState.Effective)
  return {
    current: effectiveIndex === -1 ? versions : versions.slice(0, effectiveIndex + 1),
    archived: effectiveIndex === -1 ? [] : versions.slice(effectiveIndex + 1)
  }
}

export async function CreateControlledDocumentDraft (
  context: WorkspaceApiContext,
  input: Input
): Promise<ControlledDocument> {
  const document = await getDocument(context, input)
  await assertOwner(context, document)
  const versions = await getVersions(context, document)
  const currentIndex = versions.findIndex((version) => version._id === document._id)
  if (currentIndex === -1) throw new Error('Controlled document version was not found')
  if (versions.slice(0, currentIndex).some((version) => version.state !== DocumentState.Deleted)) {
    throw new Error('A newer controlled document version already exists')
  }
  if ([DocumentState.Draft, DocumentState.Obsolete].includes(document.state)) {
    throw new Error(`Cannot create a draft from a ${document.state} document`)
  }

  const latest = versions[0]
  if (latest.state === DocumentState.Deleted) {
    await context.client.update(latest, { state: DocumentState.Draft })
    return await getDocument(context, { id: latest._id })
  }

  const employee = await currentEmployee(context)
  const draftId = generateId<ControlledDocument>()
  const changeControlId = generateId<ChangeControl>()
  const operations = context.client.apply(document.code)
  operations.notMatch(documents.class.Document, {
    ...(document.template !== undefined ? { template: document.template } : { template: { $exists: false } }),
    seqNumber: document.seqNumber,
    state: DocumentState.Draft
  })
  await operations.createDoc(
    documents.class.ChangeControl,
    document.space,
    {
      description: '',
      reason: '',
      impact: '',
      impactedDocuments: []
    },
    changeControlId
  )
  const projectMeta = await context.client.findOne(documents.class.ProjectMeta, { meta: document.attachedTo })
  if (projectMeta === undefined) throw new Error('Project metadata for controlled document was not found')
  await operations.addCollection(
    documents.class.ProjectDocument,
    projectMeta.space,
    projectMeta._id as never,
    projectMeta._class,
    'documents',
    {
      project: projectMeta.project,
      initial: projectMeta.project,
      document: draftId
    }
  )
  await operations.addCollection(
    document._class,
    document.space,
    document.attachedTo,
    document.attachedToClass,
    document.collection,
    {
      ...(document.template !== undefined ? { template: document.template } : {}),
      ...(document.category !== undefined ? { category: document.category } : {}),
      ...(document.owner !== undefined ? { owner: document.owner } : {}),
      author: employee._id,
      title: document.title,
      code: document.code,
      prefix: document.prefix,
      seqNumber: document.seqNumber,
      major: latest.major,
      minor: latest.minor + 1,
      commentSequence: 0,
      abstract: document.abstract ?? '',
      reviewers: document.reviewers,
      approvers: document.approvers,
      externalApprovers: [],
      coAuthors: document.coAuthors,
      reviewInterval: document.reviewInterval,
      changeControl: changeControlId,
      requests: 0,
      labels: 0,
      state: DocumentState.Draft,
      plannedEffectiveDate: 0,
      content: document.content
    },
    draftId
  )
  await copyAttachments(context, operations, document, draftId)
  const committed = await operations.commit()
  if (!committed.result) throw new Error('Unable to create controlled document draft')
  return await getDocument(context, { id: draftId })
}

export async function SendControlledDocumentForReview (context: WorkspaceApiContext, input: Input): Promise<void> {
  const document = await getDocument(context, input)
  await assertOwner(context, document)
  await assertLatest(context, document)
  if (document.state !== DocumentState.Draft) throw new Error('Only a draft can be sent for review')
  const reviewers = await resolveEmployees(context, namesFrom(input, 'reviewers'), 'reviewer')
  await createRequest(
    context,
    document,
    documents.class.DocumentReviewRequest,
    reviewers,
    {
      reviewers,
      controlledState: ControlledDocumentState.InReview
    },
    ControlledDocumentState.Reviewed
  )
}

export async function SendControlledDocumentForApproval (context: WorkspaceApiContext, input: Input): Promise<void> {
  const document = await getDocument(context, input)
  await assertOwner(context, document)
  await assertLatest(context, document)
  await assertCanSendForApproval(context, document)
  const approvers = await resolveEmployees(context, namesFrom(input, 'approvers'), 'approver')
  await createRequest(
    context,
    document,
    documents.class.DocumentApprovalRequest,
    approvers,
    {
      approvers,
      externalApprovers: [],
      controlledState: ControlledDocumentState.InApproval
    },
    ControlledDocumentState.Approved,
    ControlledDocumentState.Rejected
  )
}
