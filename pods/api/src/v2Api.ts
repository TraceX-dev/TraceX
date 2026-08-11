//
// Copyright © 2026 TraceX
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

import { getClient as getCollaboratorClient, type CollaboratorClient } from '@hcengineering/collaborator-client'
import attachment, { type Attachment } from '@hcengineering/attachment'
import calendar, { AccessLevel, type Calendar, type Event, type Visibility } from '@hcengineering/calendar'
import chunter, { type ChatMessage, type Channel } from '@hcengineering/chunter'
import contact, {
  combineName,
  formatContactName,
  getEmployeeBySocialId,
  type Contact,
  type Employee
} from '@hcengineering/contact'
import documents, {
  ControlledDocumentState,
  DocumentState,
  type ChangeControl,
  type ControlledDocument,
  type DocumentRequest
} from '@hcengineering/controlled-documents'
import document from '@hcengineering/document'
import core, {
  ClassifierKind,
  type ArrOf,
  generateId,
  makeCollabId,
  SortingOrder,
  TxOperations,
  type ApplyOperations,
  type AnyAttribute,
  type Class,
  type Client,
  type Doc,
  type DocumentQuery,
  type EnumOf,
  type FindOptions,
  type FindResult,
  type MarkupBlobRef,
  type OperationDomain,
  type PersonId,
  type Ref,
  type RefTo,
  type Space,
  type Status,
  type Tx,
  type TxResult
} from '@hcengineering/core'
import integration, {
  createIntegrationTarget,
  findWorkspaceApiCapabilities,
  getWorkspaceApiOperation,
  updateIntegrationTarget,
  type IntegrationTargetContext,
  type IntegrationTargetFactory,
  type WorkspaceApiOperation
} from '@hcengineering/integration'
import { getMetadata, getResource } from '@hcengineering/platform'
import { RequestStatus } from '@hcengineering/request'
import process from '@hcengineering/process'
import type { ClientSessionCtx, Session } from '@hcengineering/server-core'
import { makeRank } from '@hcengineering/task'
import time, { ToDoPriority, type ToDo } from '@hcengineering/time'
import training, { TrainingState, type Training } from '@hcengineering/training'
import { jsonToMarkup, markupToJSON } from '@hcengineering/text'
import { markdownToMarkup, markupToMarkdown } from '@hcengineering/text-markdown'

/**
 * Adapts the low-level workspace client to the narrow session shape used by
 * this module. The API pod never accesses a transactor Session directly.
 */
export function createV2ClientSession (
  client: Client,
  workspaceId: string,
  primarySocialId: PersonId
): {
    ctx: ClientSessionCtx
    session: Session
  } {
  const ctx = {
    pipeline: { context: { hierarchy: client.getHierarchy(), modelDb: client.getModel() } }
  } as unknown as ClientSessionCtx
  const session = {
    workspace: { uuid: workspaceId },
    getRawAccount: () => ({ primarySocialId }),
    findAllRaw: async <T extends Doc>(
      _ctx: ClientSessionCtx,
      _class: Ref<Class<T>>,
      query: Record<string, unknown>,
      options?: FindOptions<T>
    ) => {
      return await client.findAll(_class, query as never, options)
    },
    txRaw: async (_ctx: ClientSessionCtx, tx: Tx) => ({ result: await client.tx(tx) }),
    domainRequestRaw: async (_ctx: ClientSessionCtx, domain: OperationDomain, params: Record<string, unknown>) => {
      return await client.domainRequest(domain, params as never)
    }
  } as unknown as Session
  return { ctx, session }
}

const embeddedLabelPrefix = 'embedded:embedded:'
const collaboratorReadTimeoutMs = 5000

export interface V2Field {
  name: string
  type: string
  required: boolean
  custom: boolean
  markdown?: boolean
  values?: string[]
}

export interface V2Class {
  name: string
  fields: V2Field[]
  factory?: boolean
  createIn?: string[]
  operations?: string[]
}

export interface CreateV2DocumentRequest {
  class?: string
  space: string
  fields?: Record<string, unknown>
}

export interface V2Document {
  id: string
  class: string
  space: string
  fields: Record<string, unknown>
}

export interface GetV2DocumentsRequest {
  class?: string
  baseClass?: Ref<Class<Doc>>
  space?: string
  spaceBaseClass?: Ref<Class<Space>>
  limit?: number
}

export interface PatchV2DocumentRequest {
  class?: string
  id: string
  fields: Record<string, unknown>
}

export interface V2Documents {
  documents: V2Document[]
  total: number
}

export interface V2Spaces {
  spaces: Array<{ name: string, class: string }>
  total: number
}

export interface V2Target {
  class: string
  id: string
}

export interface V2CapabilityRequest {
  class?: string
  defaultClass?: Ref<Class<Doc>>
  id?: string
  input?: Record<string, unknown>
}

export interface CreateV2CommentRequest {
  target: V2Target
  content: string
}

export interface V2Comment {
  id: string
  content: string
  createdOn?: number
  createdBy?: string
}

export interface V2LegacyChatRequest {
  channel: string
  content: string
}

export interface CreateV2ContactRequest {
  type: 'Person' | 'Organization'
  name: string
  city?: string
  birthday?: number | null
}

export interface PatchV2ContactRequest {
  id: string
  name?: string
  city?: string
  birthday?: number | null
}

export interface GetV2ContactsRequest {
  type: 'Person' | 'Organization' | 'Employee'
  limit?: number
}

export interface SendV2ControlledDocumentReviewRequest {
  reviewers: string[]
}

export interface SendV2ControlledDocumentApprovalRequest {
  approvers: string[]
}

export interface CreateV2CalendarEventRequest {
  calendar: string
  title: string
  date: number
  dueDate: number
  allDay?: boolean
  description?: string
  location?: string
  participants?: string[]
  externalParticipants?: string[]
  visibility?: Visibility
  reminders?: number[]
  timeZone?: string
}

export interface PatchV2CalendarEventRequest {
  id: string
  title?: string
  date?: number
  dueDate?: number
  allDay?: boolean
  description?: string
  location?: string
  participants?: string[]
  externalParticipants?: string[]
  visibility?: Visibility
  reminders?: number[]
  timeZone?: string
}

export interface CreateV2ToDoRequest {
  title: string
  description?: string
  dueDate?: number | null
  priority?: ToDoPriority
  visibility?: 'public' | 'freeBusy' | 'private'
}

export interface PatchV2ToDoRequest {
  id: string
  title?: string
  description?: string
  dueDate?: number | null
  priority?: ToDoPriority
  visibility?: 'public' | 'freeBusy' | 'private'
}

interface NamedClass {
  id: Ref<Class<Doc>>
  name: string
}

interface NamedAttribute {
  id: string
  name: string
  attribute: AnyAttribute
}

/**
 * Returns a workspace-specific schema. User-defined labels are embedded
 * strings; system labels fall back to the stable class or attribute name.
 */
export async function getV2Schema (ctx: ClientSessionCtx, session: Session): Promise<V2Class[]> {
  const client = createSessionOperations(ctx, session)
  const factories = await client.findAll<IntegrationTargetFactory>(integration.class.IntegrationTargetFactory, {})
  const capabilities = await client.findAll(integration.class.WorkspaceApiCapability, {})
  const hierarchy = ctx.pipeline.context.hierarchy

  const classes = getNamedClasses(ctx).filter(
    (namedClass) =>
      factories.some(
        (factory) =>
          !isControlledDocumentClass(ctx, namedClass.id) &&
          (factory.targetClass === namedClass.id || hierarchy.isDerived(namedClass.id, factory.targetClass))
      ) ||
      capabilities.some(
        (capability) =>
          capability.targetClass === namedClass.id || hierarchy.isDerived(namedClass.id, capability.targetClass)
      )
  )
  const result = await Promise.all(
    classes.map(async (namedClass) => {
      const matchingCapabilities = await findWorkspaceApiCapabilities(client as unknown as Client, namedClass.id)
      const factory = isControlledDocumentClass(ctx, namedClass.id)
        ? undefined
        : findIntegrationTargetFactory(ctx, factories, namedClass.id)
      const allowedSpaceClasses =
        factory === undefined
          ? undefined
          : await getAllowedSpaceClasses(client as unknown as Client, factory, namedClass.id)
      return {
        name: namedClass.name,
        fields: getNamedAttributes(ctx, namedClass.id).map(({ name, attribute }) => ({
          name,
          type: getTypeName(attribute.type._class),
          required: attribute.required === true,
          custom: attribute.isCustom === true,
          ...(getMarkupKind(ctx, attribute) === undefined ? {} : { markdown: true }),
          values: getFieldValues(ctx, attribute)
        })),
        ...(factory !== undefined
          ? {
              factory: true,
              ...(allowedSpaceClasses === undefined
                ? {}
                : {
                    createIn: allowedSpaceClasses.map((spaceClass) =>
                      getDisplayName(hierarchy.getClass(spaceClass), spaceClass)
                    )
                  })
            }
          : {}),
        ...(matchingCapabilities.length === 0
          ? {}
          : {
              operations: Array.from(
                new Set(
                  matchingCapabilities.flatMap((capability) => [
                    ...(capability.find === undefined ? [] : ['find']),
                    ...(capability.get === undefined ? [] : ['get']),
                    ...(capability.create === undefined ? [] : ['create']),
                    ...(capability.patch === undefined ? [] : ['patch']),
                    ...Object.keys(capability.commands ?? {})
                  ])
                )
              )
            })
      }
    })
  )
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** Invokes a model-declared Workspace API operation by visible class name. */
export async function invokeV2Capability (
  ctx: ClientSessionCtx,
  session: Session,
  token: string,
  operation: 'find' | 'get' | 'create' | 'patch' | string | readonly string[],
  request: V2CapabilityRequest
): Promise<unknown> {
  const targetClass = resolveRequestedClass(ctx, request.class, request.defaultClass)
  const client = createSessionOperations(ctx, session)
  const capabilities = await findWorkspaceApiCapabilities(client as unknown as Client, targetClass.id)
  const operations: readonly string[] = typeof operation === 'string' ? [operation] : operation
  let handler: WorkspaceApiOperation | undefined
  for (const candidate of operations) {
    handler = (
      await Promise.all(capabilities.map(async (capability) => await getWorkspaceApiOperation(capability, candidate)))
    ).find((item) => item !== undefined)
    if (handler !== undefined) break
  }
  if (handler === undefined) {
    throw new Error(`None of the operations "${operations.join('", "')}" is supported for class "${targetClass.name}"`)
  }
  const input = { ...(request.input ?? {}) }
  if (isRecord(input.fields)) {
    Object.assign(input, await resolveFieldValues(ctx, session, targetClass.id, input.fields))
    delete input.fields
  }
  const isMessageCreate = operations.some((candidate) =>
    ['create-communication-message', 'create-legacy-comment', 'send-message', 'send-message-by-name'].includes(
      candidate
    )
  )
  if (
    isMessageCreate &&
    input.content !== undefined &&
    (typeof input.content !== 'string' || input.content.trim() === '')
  ) {
    throw new Error('content is required')
  }
  const directMarkupFields = await resolveDirectMarkupFields(ctx, targetClass.id, input)
  if (isMessageCreate && input.content !== undefined && !directMarkupFields.has('content')) {
    const content = input.content
    if (typeof content !== 'string') throw new Error('content is required')
    input.content = markdownToStoredMarkupValue(content)
  }
  const value = await handler(
    { client: client as unknown as TxOperations & Client, currentUser: session.getRawAccount().primarySocialId },
    { ...input, targetClass: targetClass.id, ...(request.id === undefined ? {} : { id: request.id }) }
  )
  return await serializeV2CapabilityValue(ctx, session, token, value)
}

async function serializeV2CapabilityValue (
  ctx: ClientSessionCtx,
  session: Session,
  token: string,
  value: unknown
): Promise<unknown> {
  if (Array.isArray(value)) {
    return await Promise.all(value.map(async (item) => await serializeV2CapabilityValue(ctx, session, token, item)))
  }
  if (isWorkspaceDoc(value)) {
    const space = await resolveSpaceById(ctx, session, value.space)
    const clazz = ctx.pipeline.context.hierarchy.getClass(value._class)
    return await serializeDocument(ctx, session, value, getDisplayName(clazz, value._class), space.name, token)
  }
  if (!isRecord(value)) return value
  const entries = await Promise.all(
    Object.entries(value).map(
      async ([key, item]): Promise<[string, unknown]> => [
        key,
        await serializeV2CapabilityValue(ctx, session, token, item)
      ]
    )
  )
  return Object.fromEntries(entries)
}

function isWorkspaceDoc (value: unknown): value is Doc {
  return (
    isRecord(value) &&
    typeof value._id === 'string' &&
    typeof value._class === 'string' &&
    typeof value.space === 'string'
  )
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireName (value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`)
  return value.trim()
}

function requireOptionalName (value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const name = value.trim()
  return name === '' ? undefined : name
}

/**
 * Creates a document through the integration target factory registered by the
 * workspace model. Factories retain product-specific defaults and side
 * effects, such as issue numbering and document ranks.
 */
export async function createV2Document (
  ctx: ClientSessionCtx,
  session: Session,
  token: string,
  request: CreateV2DocumentRequest,
  baseClass?: Ref<Class<Doc>>
): Promise<V2Document> {
  const className = requireOptionalName(request.class, 'Class name')
  const spaceName = requireName(request.space, 'Space name')
  if (className === undefined && baseClass === undefined) {
    throw new Error('Class name is required')
  }

  const targetClass =
    baseClass === undefined
      ? resolveRequestedClass(ctx, className, undefined)
      : resolveEndpointClass(ctx, className, baseClass)
  assertNotControlledDocumentClass(ctx, targetClass.id)
  const space = await resolveSpace(ctx, session, spaceName)
  const values = await resolveFieldValues(ctx, session, targetClass.id, request.fields ?? {})
  const client = createSessionOperations(ctx, session)
  await assertAllowedCreationSpace(ctx, client as unknown as Client, targetClass, space)
  const integrationContext = createIntegrationContext(client, session, token)

  const doc = await createIntegrationTarget(
    integrationContext,
    { targetClass: targetClass.id, space: space._id },
    values
  )
  return await serializeDocument(ctx, session, doc, targetClass.name, space.name, token)
}

export async function patchV2Document (
  ctx: ClientSessionCtx,
  session: Session,
  token: string,
  request: PatchV2DocumentRequest,
  baseClass?: Ref<Class<Doc>>
): Promise<V2Document> {
  const className = requireOptionalName(request.class, 'Class name')
  const id = requireName(request.id, 'Document id')
  if (className === undefined && baseClass === undefined) {
    throw new Error('Class name is required')
  }
  if (!isRecord(request.fields) || Object.keys(request.fields).length === 0) {
    throw new Error('At least one field to update is required')
  }

  const targetClass =
    baseClass === undefined
      ? resolveRequestedClass(ctx, className, undefined)
      : resolveEndpointClass(ctx, className, baseClass)
  const documentQuery = { _id: id }
  const documents = await session.findAllRaw(ctx, targetClass.id, documentQuery as never, { limit: 1 })
  const document = documents[0]
  if (document === undefined) throw new Error(`Document with id "${id}" was not found`)
  assertNotControlledDocument(ctx, document)

  const client = createSessionOperations(ctx, session)
  await updateIntegrationTarget(
    createIntegrationContext(client, session, token),
    document,
    await resolveFieldValues(ctx, session, document._class, request.fields)
  )

  const updated = await session.findAllRaw(ctx, document._class, { _id: document._id }, { limit: 1 })
  if (updated.length === 0) throw new Error('Updated document was not found')
  const space = await resolveSpaceById(ctx, session, updated[0].space)
  return await serializeDocument(
    ctx,
    session,
    updated[0],
    getDisplayName(ctx.pipeline.context.hierarchy.getClass(updated[0]._class), updated[0]._class),
    space.name,
    token
  )
}

export async function getV2Documents (
  ctx: ClientSessionCtx,
  session: Session,
  token: string,
  request: GetV2DocumentsRequest
): Promise<V2Documents> {
  const targetClass = resolveEndpointClass(ctx, request.class, request.baseClass ?? document.class.Document)
  const space = request.space?.trim()
  const limit = request.limit ?? 100
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error('Limit must be an integer between 1 and 1000')
  }

  const selectedSpace =
    space === undefined || space === '' ? undefined : await resolveSpace(ctx, session, space, request.spaceBaseClass)
  const documents = await session.findAllRaw(
    ctx,
    targetClass.id,
    selectedSpace === undefined ? {} : { space: selectedSpace._id },
    {
      limit
    }
  )
  const spaces =
    documents.length === 0
      ? []
      : await session.findAllRaw<Space>(
        ctx,
        core.class.Space,
        { _id: { $in: [...new Set(documents.map((document) => document.space))] } },
        { limit: documents.length }
      )
  const spaceNames = new Map(spaces.map((item) => [item._id, item.name]))
  return {
    documents: await Promise.all(
      documents.map(async (doc) => {
        const spaceName = spaceNames.get(doc.space)
        if (spaceName === undefined) throw new Error(`Space for document was not found: ${doc.space}`)
        return await serializeDocument(
          ctx,
          session,
          doc,
          getDisplayName(ctx.pipeline.context.hierarchy.getClass(doc._class), doc._class),
          spaceName,
          token
        )
      })
    ),
    total: documents.total ?? documents.length
  }
}

export async function getV2Spaces (
  ctx: ClientSessionCtx,
  session: Session,
  limit?: number,
  className?: string
): Promise<V2Spaces> {
  const spaces = await session.findAllRaw<Space>(ctx, core.class.Space, {}, { limit: resolveLimit(limit) })
  const requestedClass = className?.trim()
  const creatableSpaceClasses =
    requestedClass === undefined || requestedClass === ''
      ? undefined
      : await getCreatableSpaceClasses(ctx, session, await resolveSpaceFilterClass(ctx, session, requestedClass))
  const visibleSpaces =
    creatableSpaceClasses === undefined
      ? spaces
      : spaces.filter((space) => isAllowedSpaceClass(ctx, space._class, creatableSpaceClasses))
  return {
    spaces: visibleSpaces.map((space) => ({
      name: space.name,
      class: getDisplayName(ctx.pipeline.context.hierarchy.getClass(space._class), space._class)
    })),
    total: visibleSpaces.length
  }
}

export async function getV2Document (
  ctx: ClientSessionCtx,
  session: Session,
  token: string,
  className: string | undefined,
  id: string,
  baseClass: Ref<Class<Doc>>
): Promise<V2Document> {
  const documentIdValue = requireName(id, 'Document id')
  const targetClass = resolveEndpointClass(ctx, className, baseClass)
  const documentId = documentIdValue as Ref<Doc<Space>>
  const documentQuery: DocumentQuery<Doc> = { _id: documentId }
  const documents = await session.findAllRaw<Doc>(ctx, targetClass.id, documentQuery, { limit: 1 })
  if (documents.length === 0) throw new Error(`Document with id "${documentIdValue}" was not found`)
  const document = documents[0]
  const space = await resolveSpaceById(ctx, session, document.space)
  return await serializeDocument(
    ctx,
    session,
    document,
    getDisplayName(ctx.pipeline.context.hierarchy.getClass(document._class), document._class),
    space.name,
    token
  )
}

/**
 * Creates a legacy Chunter comment. The comment is added as a collection item,
 * preserving the activity and notification pipeline used by the old UI.
 */
export async function createV2LegacyComment (
  ctx: ClientSessionCtx,
  session: Session,
  request: CreateV2CommentRequest
): Promise<V2Comment> {
  const target = await resolveV2Target(ctx, session, request.target)
  const content = requireContent(request.content)
  const client = createSessionOperations(ctx, session)
  const commentClass = getLegacyCommentClass(ctx, target.doc)
  const id = await client.addCollection<Doc, ChatMessage>(
    commentClass,
    target.doc.space,
    target.doc._id,
    target.doc._class,
    'comments',
    { message: content }
  )
  const comment = await findRequired<ChatMessage>(ctx, session, commentClass, id, 'Comment')
  return serializeLegacyMessage(comment)
}

export async function getV2LegacyComments (
  ctx: ClientSessionCtx,
  session: Session,
  targetRequest: V2Target,
  limit?: number
): Promise<V2Comment[]> {
  const target = await resolveV2Target(ctx, session, targetRequest)
  const commentClass = getLegacyCommentClass(ctx, target.doc)
  const messages = await session.findAllRaw<ChatMessage>(
    ctx,
    commentClass,
    { attachedTo: target.doc._id, attachedToClass: target.doc._class, collection: 'comments' },
    { limit: resolveLimit(limit), sort: { createdOn: SortingOrder.Descending } }
  )
  return messages.map(serializeLegacyMessage)
}

/**
 * Uses the communication domain rather than writing its storage directly, so
 * its identity, permission, mention and notification middleware still runs.
 */
export async function createV2CommunicationComment (
  ctx: ClientSessionCtx,
  session: Session,
  request: CreateV2CommentRequest
): Promise<unknown> {
  const target = await resolveV2Target(ctx, session, request.target)
  const content = requireContent(request.content)
  const { result } = await session.domainRequestRaw(ctx, 'communication' as OperationDomain, {
    event: {
      type: 'createMessage',
      cardId: target.doc._id,
      cardType: target.doc._class,
      messageType: 'text',
      content,
      socialId: session.getRawAccount().primarySocialId
    }
  })
  return result.value
}

export async function getV2CommunicationComments (
  ctx: ClientSessionCtx,
  session: Session,
  targetRequest: V2Target,
  limit?: number
): Promise<unknown> {
  const target = await resolveV2Target(ctx, session, targetRequest)
  const { result } = await session.domainRequestRaw(ctx, 'communication' as OperationDomain, {
    findMessagesMeta: { params: { cardId: target.doc._id, limit: resolveLimit(limit), order: SortingOrder.Descending } }
  })
  return result.value
}

export async function createV2LegacyChatMessage (
  ctx: ClientSessionCtx,
  session: Session,
  request: V2LegacyChatRequest
): Promise<V2Comment> {
  const content = requireContent(request.content)
  const channel = await resolveLegacyChannel(ctx, session, request.channel)
  const client = createSessionOperations(ctx, session)
  const id = await client.addCollection<Channel, ChatMessage>(
    chunter.class.ChatMessage,
    channel.space,
    channel._id,
    channel._class,
    'messages',
    { message: content }
  )
  return serializeLegacyMessage(await findRequired(ctx, session, chunter.class.ChatMessage, id, 'Message'))
}

export async function getV2LegacyChatMessages (
  ctx: ClientSessionCtx,
  session: Session,
  channelName: string,
  limit?: number
): Promise<V2Comment[]> {
  const channel = await resolveLegacyChannel(ctx, session, channelName)
  const messages = await session.findAllRaw<ChatMessage>(
    ctx,
    chunter.class.ChatMessage,
    { attachedTo: channel._id, attachedToClass: channel._class, collection: 'messages' },
    { limit: resolveLimit(limit), sort: { createdOn: SortingOrder.Descending } }
  )
  return messages.map(serializeLegacyMessage)
}

export async function createV2Contact (
  ctx: ClientSessionCtx,
  session: Session,
  request: CreateV2ContactRequest
): Promise<V2Document> {
  if (request.name.trim() === '') throw new Error('Contact name is required')
  const targetClass = request.type === 'Person' ? contact.class.Person : contact.class.Organization
  const attributes: Record<string, unknown> = {
    name: toStoredContactName(ctx, targetClass, request.name),
    avatarType: 'color'
  }
  if (request.city !== undefined) attributes.city = request.city
  if (request.type === 'Person' && request.birthday !== undefined) attributes.birthday = request.birthday

  const client = createSessionOperations(ctx, session)
  const id = await client.createDoc(targetClass, contact.space.Contacts, attributes as never)
  const doc = await findRequired(ctx, session, targetClass, id, 'Contact')
  return await serializeDocument(ctx, session, doc, request.type, 'Contacts')
}

export async function patchV2Contact (
  ctx: ClientSessionCtx,
  session: Session,
  request: PatchV2ContactRequest
): Promise<V2Document> {
  if (request.id.trim() === '') throw new Error('Contact id is required')
  if (request.name === undefined && request.city === undefined && request.birthday === undefined) {
    throw new Error('At least one contact field to update is required')
  }
  if (request.name !== undefined && request.name.trim() === '') throw new Error('Contact name cannot be empty')

  const contactQuery = { _id: request.id }
  const contacts = await session.findAllRaw<Doc>(ctx, contact.class.Contact, contactQuery as never, { limit: 1 })
  if (contacts.length === 0) throw new Error(`Contact with id "${request.id}" was not found`)
  const contactDoc = contacts[0]
  if (contactDoc._class !== contact.class.Person && contactDoc._class !== contact.class.Organization) {
    throw new Error('Only Person and Organization contacts can be updated')
  }
  if (request.birthday !== undefined && contactDoc._class !== contact.class.Person) {
    throw new Error('Birthday is only available for Person contacts')
  }

  const attributes: Record<string, unknown> = {}
  if (request.name !== undefined) attributes.name = toStoredContactName(ctx, contactDoc._class, request.name)
  if (request.city !== undefined) attributes.city = request.city
  if (request.birthday !== undefined) attributes.birthday = request.birthday
  await createSessionOperations(ctx, session).update(contactDoc, attributes)

  const updated = await findRequired(ctx, session, contactDoc._class, contactDoc._id, 'Contact')
  return await serializeDocument(
    ctx,
    session,
    updated,
    contactDoc._class === contact.class.Person ? 'Person' : 'Organization',
    'Contacts'
  )
}

export async function getV2Contacts (
  ctx: ClientSessionCtx,
  session: Session,
  request: GetV2ContactsRequest
): Promise<V2Documents> {
  const limit = resolveLimit(request.limit)
  const targetClass =
    request.type === 'Employee'
      ? contact.mixin.Employee
      : request.type === 'Person'
        ? contact.class.Person
        : contact.class.Organization
  const contacts = await session.findAllRaw<Doc>(ctx, targetClass, {}, { limit })
  return {
    documents: await Promise.all(
      contacts.map(async (doc) => await serializeDocument(ctx, session, doc, request.type, 'Contacts'))
    ),
    total: contacts.total ?? contacts.length
  }
}

export async function getV2CalendarEvents (
  ctx: ClientSessionCtx,
  session: Session,
  calendarName: string,
  limit?: number
): Promise<V2Documents> {
  const selectedCalendar = await resolveCalendar(ctx, session, calendarName)
  const events = await session.findAllRaw<Event>(
    ctx,
    calendar.class.Event,
    { calendar: selectedCalendar._id },
    { limit: resolveLimit(limit), sort: { date: SortingOrder.Ascending } }
  )
  return {
    documents: await Promise.all(
      events.map(async (event) => await serializeDocument(ctx, session, event, 'Event', 'Calendar'))
    ),
    total: events.total ?? events.length
  }
}

export async function createV2CalendarEvent (
  ctx: ClientSessionCtx,
  session: Session,
  request: CreateV2CalendarEventRequest
): Promise<V2Document> {
  if (request.title.trim() === '') throw new Error('Event title is required')
  assertEventDates(request.date, request.dueDate)
  const selectedCalendar = await resolveCalendar(ctx, session, request.calendar)
  const employee = await getCurrentEmployee(ctx, session)
  const participants = await resolveContacts(ctx, session, request.participants ?? [], employee._id)
  const client = createSessionOperations(ctx, session)
  const id = await client.addCollection(
    calendar.class.Event,
    calendar.space.Calendar,
    calendar.ids.NoAttached,
    calendar.class.Event,
    'events',
    {
      calendar: selectedCalendar._id,
      eventId: generateId(),
      title: request.title.trim(),
      description: request.description ?? '',
      date: request.date,
      dueDate: request.dueDate,
      allDay: request.allDay ?? false,
      location: request.location,
      participants,
      externalParticipants: request.externalParticipants ?? [],
      reminders: request.reminders ?? [],
      visibility: request.visibility ?? 'private',
      access: AccessLevel.Owner,
      timeZone: request.timeZone,
      user: session.getRawAccount().primarySocialId,
      blockTime: request.allDay !== true
    }
  )
  return await serializeDocument(
    ctx,
    session,
    await findRequired(ctx, session, calendar.class.Event, id, 'Calendar event'),
    'Event',
    'Calendar'
  )
}

export async function patchV2CalendarEvent (
  ctx: ClientSessionCtx,
  session: Session,
  request: PatchV2CalendarEventRequest
): Promise<V2Document> {
  if (request.id.trim() === '') throw new Error('Calendar event id is required')
  const event = await findRequired(ctx, session, calendar.class.Event, request.id as Ref<Event>, 'Calendar event')
  if (event.user !== session.getRawAccount().primarySocialId || event.access !== AccessLevel.Owner) {
    throw new Error('Only an event owned by the API key user can be updated')
  }
  const update: Record<string, unknown> = {}
  if (request.title !== undefined) {
    if (request.title.trim() === '') throw new Error('Event title cannot be empty')
    update.title = request.title.trim()
  }
  if (request.date !== undefined) update.date = request.date
  if (request.dueDate !== undefined) update.dueDate = request.dueDate
  assertEventDates(
    (update.date as number | undefined) ?? event.date,
    (update.dueDate as number | undefined) ?? event.dueDate
  )
  for (const field of [
    'description',
    'location',
    'externalParticipants',
    'reminders',
    'visibility',
    'timeZone'
  ] as const) {
    if (request[field] !== undefined) update[field] = request[field]
  }
  if (request.allDay !== undefined) {
    update.allDay = request.allDay
    update.blockTime = !request.allDay
  }
  if (request.participants !== undefined) {
    update.participants = await resolveContacts(ctx, session, request.participants)
  }
  if (Object.keys(update).length === 0) throw new Error('At least one event field to update is required')
  await createSessionOperations(ctx, session).update(event, update)
  return await serializeDocument(
    ctx,
    session,
    await findRequired(ctx, session, calendar.class.Event, event._id, 'Calendar event'),
    'Event',
    'Calendar'
  )
}

export async function getV2ToDos (
  ctx: ClientSessionCtx,
  session: Session,
  type: 'ToDo' | 'ProcessToDo',
  limit?: number
): Promise<V2Documents> {
  if (type !== 'ToDo' && type !== 'ProcessToDo') throw new Error('ToDo type must be ToDo or ProcessToDo')
  const targetClass = type === 'ProcessToDo' ? process.class.ProcessToDo : time.class.ToDo
  const todos = await session.findAllRaw<Doc>(
    ctx,
    targetClass,
    {},
    { limit: resolveLimit(limit), sort: { rank: SortingOrder.Ascending } }
  )
  return {
    documents: await Promise.all(todos.map(async (todo) => await serializeDocument(ctx, session, todo, type, 'ToDos'))),
    total: todos.total ?? todos.length
  }
}

export async function createV2ToDo (
  ctx: ClientSessionCtx,
  session: Session,
  request: CreateV2ToDoRequest
): Promise<V2Document> {
  if (request.title.trim() === '') throw new Error('ToDo title is required')
  const client = createSessionOperations(ctx, session)
  const employee = await getCurrentEmployee(ctx, session)
  const latest = await client.findOne(
    time.class.ToDo,
    { user: employee._id, doneOn: null },
    { sort: { rank: SortingOrder.Ascending } }
  )
  const id = await client.addCollection(
    time.class.ToDo,
    time.space.ToDos,
    time.ids.NotAttached,
    time.class.ToDo,
    'todos',
    {
      title: request.title.trim(),
      description: request.description ?? '',
      dueDate: request.dueDate,
      priority: request.priority ?? ToDoPriority.NoPriority,
      visibility: request.visibility ?? 'private',
      user: employee._id,
      doneOn: null,
      workslots: 0,
      rank: makeRank(undefined, latest?.rank)
    }
  )
  return await serializeDocument(
    ctx,
    session,
    await findRequired(ctx, session, time.class.ToDo, id, 'ToDo'),
    'ToDo',
    'ToDos'
  )
}

export async function patchV2ToDo (
  ctx: ClientSessionCtx,
  session: Session,
  request: PatchV2ToDoRequest
): Promise<V2Document> {
  if (request.id.trim() === '') throw new Error('ToDo id is required')
  const todo = await findRequired(ctx, session, time.class.ToDo, request.id as Ref<ToDo>, 'ToDo')
  const employee = await getCurrentEmployee(ctx, session)
  if (todo.user !== employee._id) throw new Error('Only the assigned employee can update this ToDo')
  const update: Record<string, unknown> = {}
  if (request.title !== undefined) {
    if (request.title.trim() === '') throw new Error('ToDo title cannot be empty')
    update.title = request.title.trim()
  }
  for (const field of ['description', 'dueDate', 'priority', 'visibility'] as const) {
    if (request[field] !== undefined) update[field] = request[field]
  }
  if (Object.keys(update).length === 0) throw new Error('At least one ToDo field to update is required')
  // doneOn is deliberately not part of the v2 request: Process ToDos must be
  // completed only through their process action, never through this API.
  await createSessionOperations(ctx, session).update(todo, update)
  const updated = await findRequired(ctx, session, time.class.ToDo, todo._id, 'ToDo')
  return await serializeDocument(
    ctx,
    session,
    updated,
    todo._class === process.class.ProcessToDo ? 'ProcessToDo' : 'ToDo',
    'ToDos'
  )
}

export async function getV2ControlledDocumentVersions (
  ctx: ClientSessionCtx,
  session: Session,
  id: string
): Promise<{ current: V2Document[], archived: V2Document[] }> {
  const document = await getControlledDocument(ctx, session, id)
  const versions = await getControlledDocumentVersions(ctx, session, document)
  const effectiveIndex = versions.findIndex((version) => version.state === DocumentState.Effective)
  const current = effectiveIndex === -1 ? versions : versions.slice(0, effectiveIndex + 1)
  const archived = effectiveIndex === -1 ? [] : versions.slice(effectiveIndex + 1)
  return {
    current: await Promise.all(
      current.map(async (version) => await serializeControlledDocument(ctx, session, version))
    ),
    archived: await Promise.all(
      archived.map(async (version) => await serializeControlledDocument(ctx, session, version))
    )
  }
}

export async function createV2ControlledDocumentDraft (
  ctx: ClientSessionCtx,
  session: Session,
  id: string
): Promise<V2Document> {
  const document = await getControlledDocument(ctx, session, id)
  await assertControlledDocumentOwner(ctx, session, document)
  const versions = await getControlledDocumentVersions(ctx, session, document)
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
    await createSessionOperations(ctx, session).update(latest, { state: DocumentState.Draft })
    return await serializeControlledDocument(ctx, session, await getControlledDocument(ctx, session, latest._id))
  }

  const client = createSessionOperations(ctx, session)
  const draftId = generateId<ControlledDocument>()
  const changeControlId = generateId<ChangeControl>()
  const operations = client.apply(document.code)
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

  const projectMeta = await client.findOne(documents.class.ProjectMeta, { meta: document.attachedTo })
  if (projectMeta === undefined) throw new Error('Project metadata for controlled document was not found')
  await operations.addCollection(
    documents.class.ProjectDocument,
    projectMeta.space,
    projectMeta._id,
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
      author: (await getCurrentEmployee(ctx, session))._id,
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
  await copyControlledDocumentAttachments(ctx, client, operations, document, draftId)
  const committed = await operations.commit()
  if (!committed.result) throw new Error('Unable to create controlled document draft')
  return await serializeControlledDocument(ctx, session, await getControlledDocument(ctx, session, draftId))
}

export async function sendV2ControlledDocumentForReview (
  ctx: ClientSessionCtx,
  session: Session,
  id: string,
  request: SendV2ControlledDocumentReviewRequest
): Promise<void> {
  const document = await getControlledDocument(ctx, session, id)
  await assertControlledDocumentOwner(ctx, session, document)
  await assertLatestControlledDocument(ctx, session, document)
  if (document.state !== DocumentState.Draft) throw new Error('Only a draft can be sent for review')
  const reviewers = await resolveEmployees(ctx, session, request.reviewers, 'reviewer')
  await createControlledDocumentRequest(
    ctx,
    session,
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

export async function sendV2ControlledDocumentForApproval (
  ctx: ClientSessionCtx,
  session: Session,
  id: string,
  request: SendV2ControlledDocumentApprovalRequest
): Promise<void> {
  const document = await getControlledDocument(ctx, session, id)
  await assertControlledDocumentOwner(ctx, session, document)
  await assertLatestControlledDocument(ctx, session, document)
  await assertCanSendControlledDocumentForApproval(ctx, session, document)
  const approvers = await resolveEmployees(ctx, session, request.approvers, 'approver')
  await createControlledDocumentRequest(
    ctx,
    session,
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

interface MarkupOperations {
  uploadMarkup: (
    objectClass: Ref<Class<Doc>>,
    objectId: Ref<Doc>,
    objectAttr: string,
    markup: string,
    format: 'markup'
  ) => Promise<MarkupBlobRef>
  updateMarkup: (
    objectClass: Ref<Class<Doc>>,
    objectId: Ref<Doc>,
    objectAttr: string,
    markup: string,
    format: 'markup'
  ) => Promise<void>
}

function createIntegrationContext (
  client: TxOperations,
  session: Session,
  token: string
): IntegrationTargetContext & { markup: MarkupOperations } {
  return {
    client: client as unknown as IntegrationTargetContext['client'],
    // Target factories currently only use client and markup operations. Keep
    // the shared public context shape so their implementation remains reused.
    integration: '' as IntegrationTargetContext['integration'],
    provider: '' as IntegrationTargetContext['provider'],
    markup: createMarkupOperations(session, token)
  }
}

function createMarkupOperations (session: Session, token: string): MarkupOperations {
  if (globalThis.process.env.COLLABORATOR_URL === undefined || globalThis.process.env.COLLABORATOR_URL === '') {
    const unavailable = async (): Promise<never> => {
      throw new Error('COLLABORATOR_URL is required to create or update markup fields')
    }
    return { uploadMarkup: unavailable, updateMarkup: unavailable }
  }

  const collaborator = getCollaborator(session, token)
  return {
    uploadMarkup: async (objectClass, objectId, objectAttr, markup) => {
      return await collaborator.createMarkup(makeCollabId(objectClass, objectId, objectAttr), markup)
    },
    updateMarkup: async (objectClass, objectId, objectAttr, markup) => {
      await collaborator.updateMarkup(makeCollabId(objectClass, objectId, objectAttr), markup)
    }
  }
}

function getCollaborator (session: Session, token: string): CollaboratorClient {
  const collaboratorUrl = globalThis.process.env.COLLABORATOR_URL
  if (collaboratorUrl === undefined || collaboratorUrl === '') {
    throw new Error('COLLABORATOR_URL is required to read, create, or update markup fields')
  }
  return getCollaboratorClient(session.workspace.uuid, token, collaboratorUrl)
}

function createSessionOperations (ctx: ClientSessionCtx, session: Session): TxOperations {
  const sessionClient = {
    getHierarchy: () => ctx.pipeline.context.hierarchy,
    getModel: () => ctx.pipeline.context.modelDb,
    findAll: async <T extends Doc>(
      _class: Ref<Class<T>>,
      query: Record<string, unknown>,
      options?: FindOptions<T>
    ): Promise<FindResult<T>> => await session.findAllRaw(ctx, _class, query as never, options),
    findOne: async <T extends Doc>(
      _class: Ref<Class<T>>,
      query: Record<string, unknown>,
      options?: FindOptions<T>
    ): Promise<T | undefined> => (await session.findAllRaw(ctx, _class, query as never, { ...options, limit: 1 }))[0],
    tx: async (tx: Tx): Promise<TxResult> => (await session.txRaw(ctx, tx)).result,
    domainRequest: async (domain: OperationDomain, params: Record<string, unknown>) => {
      return await session.domainRequestRaw(ctx, domain, params)
    },
    close: async (): Promise<void> => {}
  }
  return new TxOperations(sessionClient as unknown as Client, session.getRawAccount().primarySocialId)
}

async function resolveV2Target (
  ctx: ClientSessionCtx,
  session: Session,
  target: V2Target
): Promise<{ namedClass: NamedClass, doc: Doc }> {
  if (target.class.trim() === '') throw new Error('Target class is required')
  if (target.id.trim() === '') throw new Error('Target id is required')
  const namedClass = resolveClass(ctx, target.class)
  const doc = await findRequired(ctx, session, namedClass.id, target.id as Ref<Doc>, 'Target document')
  return { namedClass, doc }
}

async function findRequired<T extends Doc> (
  ctx: ClientSessionCtx,
  session: Session,
  targetClass: Ref<Class<T>>,
  id: Ref<T>,
  description: string
): Promise<T> {
  const query = { _id: id }
  const docs = await session.findAllRaw<T>(ctx, targetClass, query as never, { limit: 1 })
  if (docs.length === 0) throw new Error(`${description} with id "${id}" was not found`)
  return docs[0]
}

function requireContent (content: string): string {
  if (typeof content !== 'string' || content.trim() === '') throw new Error('Message content is required')
  return content
}

function resolveLimit (limit?: number): number {
  const result = limit ?? 100
  if (!Number.isInteger(result) || result < 1 || result > 1000) {
    throw new Error('Limit must be an integer between 1 and 1000')
  }
  return result
}

function serializeLegacyMessage (message: ChatMessage): V2Comment {
  return {
    id: message._id,
    content: message.message,
    createdOn: message.createdOn,
    createdBy: message.createdBy
  }
}

function getLegacyCommentClass (ctx: ClientSessionCtx, target: Doc): Ref<Class<ChatMessage>> {
  return target._class === documents.class.ControlledDocument ||
    ctx.pipeline.context.hierarchy.isDerived(target._class, documents.class.ControlledDocument)
    ? documents.class.DocumentComment
    : chunter.class.ChatMessage
}

async function resolveCalendar (ctx: ClientSessionCtx, session: Session, name: string): Promise<Calendar> {
  if (name.trim() === '') throw new Error('Calendar name is required')
  const calendars = await session.findAllRaw<Calendar>(
    ctx,
    calendar.class.Calendar,
    {
      name,
      user: session.getRawAccount().primarySocialId,
      hidden: { $ne: true }
    },
    { limit: 2 }
  )
  if (calendars.length === 0) throw new Error(`Visible calendar named "${name}" was not found for the API key user`)
  if (calendars.length > 1) throw new Error(`Calendar name "${name}" is ambiguous`)
  if (calendars[0].access !== AccessLevel.Owner && calendars[0].access !== AccessLevel.Writer) {
    throw new Error(`Calendar "${name}" is read-only`)
  }
  return calendars[0]
}

async function resolveContacts (
  ctx: ClientSessionCtx,
  session: Session,
  names: string[],
  defaultContact?: Ref<Employee>
): Promise<Ref<Contact>[]> {
  if (names.length === 0) return defaultContact === undefined ? [] : [defaultContact as Ref<Contact>]
  const result: Ref<Contact>[] = []
  for (const name of names) {
    if (typeof name !== 'string' || name.trim() === '') throw new Error('Each participant must be a contact name')
    const contacts = await findContactsByName(ctx, session, contact.class.Contact, name)
    if (contacts.length === 0) throw new Error(`Contact named "${name}" was not found`)
    if (contacts.length > 1) throw new Error(`Contact name "${name}" is ambiguous`)
    if (result.includes(contacts[0]._id as Ref<Contact>)) {
      throw new Error(`Contact "${name}" was provided more than once`)
    }
    result.push(contacts[0]._id as Ref<Contact>)
  }
  return result
}

function assertEventDates (date: number, dueDate: number): void {
  if (!Number.isFinite(date) || !Number.isFinite(dueDate)) throw new Error('Event date and dueDate must be timestamps')
  if (dueDate < date) throw new Error('Event dueDate cannot be earlier than date')
}

async function resolveLegacyChannel (ctx: ClientSessionCtx, session: Session, name: string): Promise<Channel> {
  if (name.trim() === '') throw new Error('Channel name is required')
  const channels = await session.findAllRaw<Channel>(ctx, chunter.class.Channel, { name }, { limit: 2 })
  if (channels.length === 0) throw new Error(`Channel named "${name}" was not found`)
  if (channels.length > 1) throw new Error(`Channel name "${name}" is ambiguous`)
  if (channels[0].archived) throw new Error(`Channel "${name}" is archived`)
  return channels[0]
}

async function getCurrentEmployee (ctx: ClientSessionCtx, session: Session): Promise<Employee> {
  const employee = await getEmployeeBySocialId(
    createSessionOperations(ctx, session) as unknown as Client,
    session.getRawAccount().primarySocialId
  )
  if (employee === undefined || !employee.active) {
    throw new Error('The API key user is not an active employee')
  }
  return employee
}

async function getControlledDocument (ctx: ClientSessionCtx, session: Session, id: string): Promise<ControlledDocument> {
  if (id.trim() === '') throw new Error('Controlled document id is required')
  return await findRequired(
    ctx,
    session,
    documents.class.ControlledDocument,
    id as Ref<ControlledDocument>,
    'Controlled document'
  )
}

async function getControlledDocumentVersions (
  ctx: ClientSessionCtx,
  session: Session,
  document: ControlledDocument
): Promise<ControlledDocument[]> {
  return await session.findAllRaw<ControlledDocument>(
    ctx,
    documents.class.ControlledDocument,
    {
      attachedTo: document.attachedTo,
      attachedToClass: document.attachedToClass,
      collection: document.collection
    },
    { sort: { major: SortingOrder.Descending, minor: SortingOrder.Descending, patch: SortingOrder.Descending } }
  )
}

async function serializeControlledDocument (
  ctx: ClientSessionCtx,
  session: Session,
  document: ControlledDocument
): Promise<V2Document> {
  const space = await resolveSpaceById(ctx, session, document.space)
  return await serializeDocument(
    ctx,
    session,
    document,
    getDisplayName(ctx.pipeline.context.hierarchy.getClass(document._class), document._class),
    space.name
  )
}

async function assertControlledDocumentOwner (
  ctx: ClientSessionCtx,
  session: Session,
  document: ControlledDocument
): Promise<void> {
  const employee = await getCurrentEmployee(ctx, session)
  if (document.owner === undefined || document.owner !== employee._id) {
    throw new Error('Only the controlled document owner can perform this operation')
  }
}

async function assertLatestControlledDocument (
  ctx: ClientSessionCtx,
  session: Session,
  document: ControlledDocument
): Promise<void> {
  const versions = await getControlledDocumentVersions(ctx, session, document)
  if (versions[0]?._id !== document._id) throw new Error('Only the latest controlled document version can be used')
}

async function resolveEmployees (
  ctx: ClientSessionCtx,
  session: Session,
  names: string[],
  role: string
): Promise<Ref<Employee>[]> {
  if (!Array.isArray(names) || names.length === 0) throw new Error(`At least one ${role} is required`)
  const employees = await session.findAllRaw<Employee>(ctx, contact.mixin.Employee, { active: true })
  const result: Ref<Employee>[] = []
  for (const name of names) {
    if (typeof name !== 'string' || name.trim() === '') throw new Error(`Each ${role} must be an employee name`)
    const matches = employees.filter((employee) => getApiContactName(ctx, employee) === name)
    if (matches.length === 0) throw new Error(`Active employee named "${name}" was not found`)
    if (matches.length > 1) throw new Error(`Employee name "${name}" is ambiguous`)
    if (result.includes(matches[0]._id)) throw new Error(`${capitalize(role)} "${name}" was provided more than once`)
    result.push(matches[0]._id)
  }
  return result
}

async function assertCanSendControlledDocumentForApproval (
  ctx: ClientSessionCtx,
  session: Session,
  document: ControlledDocument
): Promise<void> {
  const reviews = await session.findAllRaw<DocumentRequest>(ctx, documents.class.DocumentReviewRequest, {
    attachedTo: document._id
  })
  const hasBeenReviewed = reviews.length > 0
  if (
    !(
      (document.state === DocumentState.Draft && !hasBeenReviewed) ||
      document.controlledState === ControlledDocumentState.Reviewed
    )
  ) {
    throw new Error('Controlled document must be a new draft or successfully reviewed before approval')
  }
  const unresolvedComments = await session.findAllRaw(
    ctx,
    documents.class.DocumentComment,
    {
      attachedTo: document._id,
      resolved: { $ne: true }
    },
    { limit: 1 }
  )
  if (unresolvedComments.length > 0) {
    throw new Error('All controlled document comments must be resolved before approval')
  }

  const hierarchy = ctx.pipeline.context.hierarchy
  if (hierarchy.hasMixin(document, documents.mixin.DocumentTraining)) {
    const documentTraining = hierarchy.as(document, documents.mixin.DocumentTraining) as unknown as {
      training?: string
    }
    const trainingId = documentTraining.training
    if (typeof trainingId === 'string') {
      const trainingDoc = await findRequired(
        ctx,
        session,
        training.class.Training,
        trainingId as Ref<Training>,
        'Document training'
      )
      if (trainingDoc.state !== TrainingState.Released) {
        throw new Error('Document training must be released before approval')
      }
    }
  }
}

async function createControlledDocumentRequest (
  ctx: ClientSessionCtx,
  session: Session,
  document: ControlledDocument,
  requestClass: Ref<Class<DocumentRequest>>,
  users: Ref<Employee>[],
  update: Record<string, unknown>,
  approvedState: ControlledDocumentState,
  rejectedState?: ControlledDocumentState
): Promise<void> {
  const client = createSessionOperations(ctx, session)
  const operations = client.apply('create-qms-doc-request')
  for (const activeRequestClass of [documents.class.DocumentReviewRequest, documents.class.DocumentApprovalRequest]) {
    operations.notMatch(activeRequestClass, {
      attachedTo: document._id,
      attachedToClass: document._class,
      status: RequestStatus.Active
    })
  }
  await operations.update(document, update)
  const approvedTx = client.txFactory.createTxUpdateDoc(document._class, document.space, document._id, {
    controlledState: approvedState
  })
  const rejectedTx =
    rejectedState === undefined
      ? undefined
      : client.txFactory.createTxUpdateDoc(document._class, document.space, document._id, {
        controlledState: rejectedState
      })
  await operations.addCollection(requestClass, document.space, document._id, document._class, 'requests', {
    requested: users,
    approved: [],
    tx: approvedTx,
    rejectedTx,
    status: RequestStatus.Active,
    requiredApprovesCount: users.length
  })
  const committed = await operations.commit()
  if (!committed.result) throw new Error('Unable to create controlled document request')
}

async function copyControlledDocumentAttachments (
  ctx: ClientSessionCtx,
  client: TxOperations,
  operations: ApplyOperations,
  document: ControlledDocument,
  draftId: Ref<ControlledDocument>
): Promise<void> {
  const hierarchy = ctx.pipeline.context.hierarchy
  const attachments = await client.findAll(attachment.class.Attachment, { attachedTo: document._id })
  for (const source of attachments) {
    if (hierarchy.hasMixin(source, documents.mixin.DocumentAttachment)) {
      const documentAttachment = hierarchy.as(source, documents.mixin.DocumentAttachment) as unknown as {
        deletedIn?: unknown
      }
      if (documentAttachment.deletedIn !== undefined && documentAttachment.deletedIn !== null) continue
    }
    const id = generateId<Attachment>()
    await operations.addCollection(
      source._class,
      document.space,
      draftId,
      document._class,
      'attachments',
      {
        file: source.file,
        name: source.name,
        type: source.type,
        size: source.size,
        lastModified: source.lastModified,
        metadata: source.metadata
      },
      id
    )
    await operations.updateMixin(id, source._class, document.space, documents.mixin.DocumentAttachment, {
      state: 'referenced'
    })
  }
}

function resolveClass (ctx: ClientSessionCtx, name: string): NamedClass {
  return resolveNamed(getNamedClasses(ctx), name, 'class')
}

function findIntegrationTargetFactory (
  ctx: ClientSessionCtx,
  factories: IntegrationTargetFactory[],
  targetClass: Ref<Class<Doc>>
): IntegrationTargetFactory | undefined {
  const exactFactory = factories.find((factory) => factory.targetClass === targetClass)
  if (exactFactory !== undefined) return exactFactory

  const hierarchy = ctx.pipeline.context.hierarchy
  const candidates = factories
    .filter((factory) => hierarchy.isDerived(targetClass, factory.targetClass))
    .sort(
      (left, right) =>
        hierarchy.getAncestors(right.targetClass).length - hierarchy.getAncestors(left.targetClass).length
    )
  return candidates[0]
}

async function getAllowedSpaceClasses (
  client: Client,
  factory: IntegrationTargetFactory,
  targetClass: Ref<Class<Doc>>
): Promise<Array<Ref<Class<Space>>> | undefined> {
  if (factory.getAllowedSpaceClasses === undefined) return undefined
  const resolver = await getResource(factory.getAllowedSpaceClasses)
  return await resolver(client, targetClass)
}

async function getCreatableSpaceClasses (
  ctx: ClientSessionCtx,
  session: Session,
  targetClass: NamedClass
): Promise<Array<Ref<Class<Space>>> | undefined> {
  const client = createSessionOperations(ctx, session)
  const factories = await client.findAll<IntegrationTargetFactory>(integration.class.IntegrationTargetFactory, {})
  const factory = findIntegrationTargetFactory(ctx, factories, targetClass.id)
  if (factory === undefined) {
    throw new Error(`Class "${targetClass.name}" does not support space-based creation`)
  }
  return await getAllowedSpaceClasses(client as unknown as Client, factory, targetClass.id)
}

async function resolveSpaceFilterClass (ctx: ClientSessionCtx, session: Session, name: string): Promise<NamedClass> {
  const matchingClasses = getNamedClasses(ctx).filter((namedClass) => namedClass.name === name)
  if (matchingClasses.length <= 1) return resolveNamed(matchingClasses, name, 'class')

  const client = createSessionOperations(ctx, session)
  const factories = await client.findAll<IntegrationTargetFactory>(integration.class.IntegrationTargetFactory, {})
  const factoryTargetClasses = matchingClasses.filter((namedClass) =>
    factories.some((factory) => factory.targetClass === namedClass.id)
  )
  if (factoryTargetClasses.length > 0) return resolveNamed(factoryTargetClasses, name, 'class')
  const creatableClasses = matchingClasses.filter(
    (namedClass) =>
      !isControlledDocumentClass(ctx, namedClass.id) &&
      findIntegrationTargetFactory(ctx, factories, namedClass.id) !== undefined
  )
  return resolveNamed(creatableClasses.length > 0 ? creatableClasses : matchingClasses, name, 'class')
}

async function assertAllowedCreationSpace (
  ctx: ClientSessionCtx,
  client: Client,
  targetClass: NamedClass,
  space: Space
): Promise<void> {
  const factories = await client.findAll<IntegrationTargetFactory>(integration.class.IntegrationTargetFactory, {})
  const factory = findIntegrationTargetFactory(ctx, factories, targetClass.id)
  if (factory === undefined) {
    throw new Error(`Class "${targetClass.name}" does not support creation`)
  }
  const allowedSpaceClasses = await getAllowedSpaceClasses(client, factory, targetClass.id)
  if (allowedSpaceClasses === undefined || isAllowedSpaceClass(ctx, space._class, allowedSpaceClasses)) return
  const allowedNames = allowedSpaceClasses.map((spaceClass) =>
    getDisplayName(ctx.pipeline.context.hierarchy.getClass(spaceClass), spaceClass)
  )
  throw new Error(
    `Class "${targetClass.name}" can only be created in spaces of type ${allowedNames.map((name) => `"${name}"`).join(', ')}`
  )
}

function isAllowedSpaceClass (
  ctx: ClientSessionCtx,
  spaceClass: Ref<Class<Doc>>,
  allowedSpaceClasses: Array<Ref<Class<Space>>>
): boolean {
  const hierarchy = ctx.pipeline.context.hierarchy
  return allowedSpaceClasses.some(
    (allowedSpaceClass) => spaceClass === allowedSpaceClass || hierarchy.isDerived(spaceClass, allowedSpaceClass)
  )
}

function resolveRequestedClass (
  ctx: ClientSessionCtx,
  name: string | undefined,
  defaultClass: Ref<Class<Doc>> | undefined
): NamedClass {
  const className = name?.trim()
  if (defaultClass !== undefined) {
    const clazz = ctx.pipeline.context.hierarchy.getClass(defaultClass)
    const fallback = { id: defaultClass, name: getDisplayName(clazz, defaultClass) }
    if (className === undefined || className === '' || className === fallback.name) return fallback
  }
  if (className === undefined || className === '') throw new Error('Class name is required')
  return resolveClass(ctx, className)
}

function resolveEndpointClass (ctx: ClientSessionCtx, name: string | undefined, baseClass: Ref<Class<Doc>>): NamedClass {
  const hierarchy = ctx.pipeline.context.hierarchy
  const base = {
    id: baseClass,
    name: getDisplayName(hierarchy.getClass(baseClass), baseClass)
  }
  const className = name?.trim()
  if (className === undefined || className === '' || className === base.name) return base

  const descendants = new Set<Ref<Class<Doc>>>([
    baseClass,
    ...hierarchy.getDescendants(baseClass).map((item) => item as Ref<Class<Doc>>)
  ])
  const classes = getNamedClasses(ctx).filter((item) => descendants.has(item.id))
  return resolveNamed(classes, className, 'class')
}

function assertNotControlledDocumentClass (ctx: ClientSessionCtx, targetClass: Ref<Class<Doc>>): void {
  if (isControlledDocumentClass(ctx, targetClass)) {
    throw new Error('Use the controlled-documents v2 operations for controlled document lifecycle changes')
  }
}

function isControlledDocumentClass (ctx: ClientSessionCtx, targetClass: Ref<Class<Doc>>): boolean {
  return (
    targetClass === documents.class.ControlledDocument ||
    ctx.pipeline.context.hierarchy.isDerived(targetClass, documents.class.ControlledDocument)
  )
}

function assertNotControlledDocument (ctx: ClientSessionCtx, document: Doc): void {
  assertNotControlledDocumentClass(ctx, document._class)
}

async function resolveSpace (
  ctx: ClientSessionCtx,
  session: Session,
  name: string,
  baseClass: Ref<Class<Space>> = core.class.Space
): Promise<Space> {
  const spaces = await session.findAllRaw<Space>(ctx, baseClass, { name }, { limit: 2 })
  if (spaces.length === 0) throw new Error(`Space named "${name}" was not found`)
  if (spaces.length > 1) throw new Error(`Space name "${name}" is ambiguous`)
  return spaces[0]
}

async function resolveSpaceById (ctx: ClientSessionCtx, session: Session, id: Ref<Space>): Promise<Space> {
  const spaces = await session.findAllRaw<Space>(ctx, core.class.Space, { _id: id }, { limit: 1 })
  if (spaces.length === 0) throw new Error(`Space for document was not found: ${id}`)
  return spaces[0]
}

async function resolveFieldValues (
  ctx: ClientSessionCtx,
  session: Session,
  targetClass: Ref<Class<Doc>>,
  fields: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const attributes = getNamedAttributes(ctx, targetClass)
  const entries = await Promise.all(
    Object.entries(fields).map(async ([name, value]): Promise<[string, unknown]> => {
      const field = resolveNamed(attributes, name, 'field')
      return [field.id, await resolveFieldValue(ctx, session, field.attribute, value)]
    })
  )
  return Object.fromEntries(entries)
}

async function resolveDirectMarkupFields (
  ctx: ClientSessionCtx,
  targetClass: Ref<Class<Doc>>,
  input: Record<string, unknown>
): Promise<Set<string>> {
  const attributes = new Map(
    getNamedAttributes(ctx, targetClass).map((attribute) => [attribute.id, attribute.attribute])
  )
  const resolved = new Set<string>()
  for (const [id, value] of Object.entries(input)) {
    const attribute = attributes.get(id)
    if (attribute !== undefined && getMarkupKind(ctx, attribute) !== undefined) {
      input[id] = markdownToStoredMarkup(attribute, value)
      resolved.add(id)
    }
  }
  return resolved
}

async function serializeDocument (
  ctx: ClientSessionCtx,
  session: Session,
  doc: Doc,
  className: string,
  spaceName: string,
  token?: string
): Promise<V2Document> {
  const entries = await Promise.all(
    getNamedAttributes(ctx, doc._class).map(async (attribute): Promise<[string, unknown] | undefined> => {
      const value = (doc as unknown as Record<string, unknown>)[attribute.id]
      if (value === undefined) return undefined
      return [
        attribute.name,
        attribute.id === 'name' && typeof value === 'string'
          ? getApiContactName(ctx, doc, value)
          : await serializeFieldValue(ctx, session, token, doc, attribute.id, attribute.attribute, value)
      ]
    })
  )
  return {
    id: doc._id,
    class: className,
    space: spaceName,
    fields: Object.fromEntries(entries.filter((entry): entry is [string, unknown] => entry !== undefined))
  }
}

function getFieldValues (ctx: ClientSessionCtx, attribute: AnyAttribute): string[] | undefined {
  const enumValues = getEnumValues(ctx, attribute)
  if (enumValues !== undefined) return enumValues
  return getStatusOptions(ctx, attribute)?.map((status) => status.name)
}

async function resolveFieldValue (
  ctx: ClientSessionCtx,
  session: Session,
  attribute: AnyAttribute,
  value: unknown
): Promise<unknown> {
  if (getMarkupKind(ctx, attribute) !== undefined) return markdownToStoredMarkup(attribute, value)

  const statuses = getStatusOptions(ctx, attribute)
  if (statuses !== undefined) {
    const resolveStatus = (statusName: unknown): Ref<Status> => {
      if (typeof statusName !== 'string') {
        throw new Error(`Status for field "${getDisplayName(attribute, attribute.name)}" must be a name`)
      }
      return resolveNamed(statuses, statusName, 'status').id
    }
    return Array.isArray(value) ? value.map(resolveStatus) : resolveStatus(value)
  }

  const enumValues = getEnumValues(ctx, attribute)
  if (enumValues !== undefined) {
    const validateEnum = (enumValue: unknown): unknown => {
      if (typeof enumValue !== 'string' || !enumValues.includes(enumValue)) {
        throw new Error(`Invalid value for enum field "${getDisplayName(attribute, attribute.name)}"`)
      }
      return enumValue
    }
    return Array.isArray(value) ? value.map(validateEnum) : validateEnum(value)
  }

  const targetClass = getReferenceTargetClass(attribute)
  if (targetClass === undefined || value === null) return value
  const resolveReference = async (name: unknown): Promise<Ref<Doc>> =>
    await resolveReferenceByName(ctx, session, targetClass, name, getDisplayName(attribute, attribute.name))
  return Array.isArray(value) ? await Promise.all(value.map(resolveReference)) : await resolveReference(value)
}

async function serializeFieldValue (
  ctx: ClientSessionCtx,
  session: Session,
  token: string | undefined,
  doc: Doc,
  attributeId: string,
  attribute: AnyAttribute,
  value: unknown
): Promise<unknown> {
  const markupKind = getMarkupKind(ctx, attribute)
  if (markupKind !== undefined) {
    if (value === null) return null
    if (typeof value !== 'string') return value
    if (markupKind === 'collaborative') {
      if (value === '') return ''
      if (token === undefined) throw new Error('API key is required to read collaborative markup fields')
      const startedAt = Date.now()
      console.info(
        JSON.stringify({
          level: 'info',
          message: 'Workspace API read collaborative markup',
          objectClass: doc._class,
          objectId: doc._id,
          attribute: attributeId
        })
      )
      const markup = await withTimeout(
        getCollaborator(session, token).getMarkup(
          makeCollabId(doc._class, doc._id, attributeId),
          value as MarkupBlobRef
        ),
        collaboratorReadTimeoutMs,
        `Collaborator did not respond while reading markup field "${getDisplayName(attribute, attribute.name)}"`
      )
      console.info(
        JSON.stringify({
          level: 'info',
          message: 'Workspace API read collaborative markup completed',
          objectClass: doc._class,
          objectId: doc._id,
          attribute: attributeId,
          elapsedMs: Date.now() - startedAt
        })
      )
      return markupToMarkdown(markupToJSON(markup))
    }
    return markupToMarkdown(markupToJSON(value))
  }

  const statuses = getStatusOptions(ctx, attribute)
  if (statuses !== undefined) {
    const serializeStatus = (id: unknown): unknown => {
      if (id === null) return null
      if (typeof id !== 'string') {
        throw new Error(`Status for field "${getDisplayName(attribute, attribute.name)}" is invalid`)
      }
      const status = statuses.find((item) => item.id === id)
      if (status === undefined) {
        throw new Error(`Status for field "${getDisplayName(attribute, attribute.name)}" is not available`)
      }
      return status.name
    }
    return Array.isArray(value) ? value.map(serializeStatus) : serializeStatus(value)
  }

  const targetClass = getReferenceTargetClass(attribute)
  if (targetClass === undefined || value === null) return value
  const serializeReference = async (id: unknown): Promise<string | null> =>
    await getReferenceName(ctx, session, targetClass, id)
  return Array.isArray(value) ? await Promise.all(value.map(serializeReference)) : await serializeReference(value)
}

async function withTimeout<T> (operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(message))
    }, timeoutMs)
    void operation.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timeout)
        reject(error)
      }
    )
  })
}

function getEnumValues (ctx: ClientSessionCtx, attribute: AnyAttribute): string[] | undefined {
  const type = getItemType(attribute)
  if (type._class !== core.class.EnumOf) return
  return ctx.pipeline.context.modelDb.findObject((type as EnumOf).of)?.enumValues
}

function getStatusOptions (
  ctx: ClientSessionCtx,
  attribute: AnyAttribute
): Array<{ id: Ref<Status>, name: string }> | undefined {
  const type = getItemType(attribute)
  if (type._class !== core.class.RefTo) return

  const statusClass = (type as RefTo<Status>).to
  const hierarchy = ctx.pipeline.context.hierarchy
  if (statusClass !== core.class.Status && !hierarchy.isDerived(statusClass, core.class.Status)) return

  return ctx.pipeline.context.modelDb
    .findAllSync<Status>(statusClass, { ofAttribute: attribute._id })
    .map((status) => ({ id: status._id, name: status.name }))
}

function getNamedClasses (ctx: ClientSessionCtx): NamedClass[] {
  const hierarchy = ctx.pipeline.context.hierarchy
  const result: NamedClass[] = []
  for (const id of hierarchy.getDescendants(core.class.Doc)) {
    const clazz = hierarchy.getClass(id)
    if (clazz.kind !== ClassifierKind.CLASS || clazz.hidden === true) continue
    result.push({ id: id as Ref<Class<Doc>>, name: getDisplayName(clazz, id) })
  }
  return result
}

function getNamedAttributes (ctx: ClientSessionCtx, targetClass: Ref<Class<Doc>>): NamedAttribute[] {
  return Array.from(ctx.pipeline.context.hierarchy.getAllAttributes(targetClass).entries())
    .filter(([id, attribute]) => id !== '_class' && attribute.hidden !== true && attribute.readonly !== true)
    .map(([id, attribute]) => ({ id, name: getDisplayName(attribute, id), attribute }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function getReferenceTargetClass (attribute: AnyAttribute): Ref<Class<Doc>> | undefined {
  const type = getItemType(attribute)
  if (type._class !== core.class.RefTo) return undefined
  return (type as RefTo<Doc>).to
}

function getItemType (attribute: AnyAttribute): AnyAttribute['type'] {
  return attribute.type._class === core.class.ArrOf ? (attribute.type as ArrOf<Doc>).of : attribute.type
}

function getMarkupKind (ctx: ClientSessionCtx, attribute: AnyAttribute): 'markup' | 'collaborative' | undefined {
  const type = getItemType(attribute)
  const hierarchy = ctx.pipeline.context.hierarchy
  if (
    type._class === core.class.TypeCollaborativeDoc ||
    hierarchy.isDerived(type._class, core.class.TypeCollaborativeDoc)
  ) {
    return 'collaborative'
  }
  if (type._class === core.class.TypeMarkup || hierarchy.isDerived(type._class, core.class.TypeMarkup)) return 'markup'
}

function markdownToStoredMarkup (attribute: AnyAttribute, value: unknown): unknown {
  if (value === null) return null
  if (typeof value !== 'string') {
    throw new Error(`Markdown for field "${getDisplayName(attribute, attribute.name)}" must be a string`)
  }
  return markdownToStoredMarkupValue(value)
}

function markdownToStoredMarkupValue (value: string): string {
  return jsonToMarkup(markdownToMarkup(value))
}

async function resolveReferenceByName (
  ctx: ClientSessionCtx,
  session: Session,
  targetClass: Ref<Class<Doc>>,
  name: unknown,
  fieldName: string
): Promise<Ref<Doc>> {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`Reference for field "${fieldName}" must be a name`)
  }
  const displayAttribute = getReferenceDisplayAttribute(ctx, targetClass)
  const matches =
    displayAttribute.id === 'name' && isContactClass(ctx, targetClass)
      ? await findContactsByName(ctx, session, targetClass, name)
      : await session.findAllRaw<Doc>(ctx, targetClass, { [displayAttribute.id]: name }, { limit: 2 })
  if (matches.length === 0) {
    throw new Error(`Referenced ${getReferenceClassName(ctx, targetClass)} named "${name}" was not found`)
  }
  if (matches.length > 1) {
    throw new Error(`Referenced ${getReferenceClassName(ctx, targetClass)} name "${name}" is ambiguous`)
  }
  return matches[0]._id
}

async function getReferenceName (
  ctx: ClientSessionCtx,
  session: Session,
  targetClass: Ref<Class<Doc>>,
  id: unknown
): Promise<string | null> {
  if (typeof id !== 'string') throw new Error(`Reference to ${getReferenceClassName(ctx, targetClass)} is invalid`)
  if (targetClass === document.class.Document && id === document.ids.NoParent) return null
  const displayAttribute = getReferenceDisplayAttribute(ctx, targetClass)
  const documentId = id as Ref<Doc<Space>>
  const referenceQuery: DocumentQuery<Doc> = { _id: documentId }
  const matches = await session.findAllRaw<Doc>(ctx, targetClass, referenceQuery, { limit: 1 })
  if (matches.length === 0) {
    throw new Error(
      `Referenced ${getReferenceClassName(ctx, targetClass)} with id "${id}" was not found or is not visible`
    )
  }
  const name = (matches[0] as unknown as Record<string, unknown>)[displayAttribute.id]
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`Referenced ${getReferenceClassName(ctx, targetClass)} has no usable name`)
  }
  return getApiContactName(ctx, matches[0], name)
}

async function findContactsByName (
  ctx: ClientSessionCtx,
  session: Session,
  targetClass: Ref<Class<Doc>>,
  name: string
): Promise<Doc[]> {
  const storedName = toStoredPersonName(name)
  const contacts = await session.findAllRaw<Doc>(
    ctx,
    targetClass,
    { name: { $in: storedName === name ? [name] : [name, storedName] } },
    { limit: 3 }
  )
  return contacts.filter((contact) => getApiContactName(ctx, contact) === name)
}

function getApiContactName (ctx: ClientSessionCtx, doc: Doc, name?: string): string {
  const storedName = name ?? (doc as unknown as Record<string, unknown>).name
  if (typeof storedName !== 'string' || !isPersonClass(ctx, doc._class)) return String(storedName ?? '')
  return formatContactName(ctx.pipeline.context.hierarchy, doc._class, storedName).trim()
}

function toStoredContactName (ctx: ClientSessionCtx, targetClass: Ref<Class<Doc>>, name: string): string {
  const visibleName = name.trim()
  if (!isPersonClass(ctx, targetClass)) return visibleName
  return toStoredPersonName(visibleName)
}

function toStoredPersonName (name: string): string {
  const visibleName = name.trim()
  const parts = visibleName.split(/\s+/)
  if (getMetadata(contact.metadata.LastNameFirst) === true) {
    const firstName = parts.length > 1 ? (parts.pop() ?? '') : ''
    return combineName(firstName, parts.join(' '))
  }
  const lastName = parts.length > 1 ? (parts.pop() ?? '') : ''
  return combineName(parts.join(' '), lastName)
}

function isContactClass (ctx: ClientSessionCtx, targetClass: Ref<Class<Doc>>): boolean {
  return targetClass === contact.class.Contact || isPersonClass(ctx, targetClass)
}

function isPersonClass (ctx: ClientSessionCtx, targetClass: Ref<Class<Doc>>): boolean {
  return (
    targetClass === contact.class.Person || ctx.pipeline.context.hierarchy.isDerived(targetClass, contact.class.Person)
  )
}

function getReferenceDisplayAttribute (ctx: ClientSessionCtx, targetClass: Ref<Class<Doc>>): NamedAttribute {
  const attributes = Array.from(ctx.pipeline.context.hierarchy.getAllAttributes(targetClass).entries())
    .filter(([, attribute]) => attribute.hidden !== true)
    .map(([id, attribute]) => ({ id, name: getDisplayName(attribute, id), attribute }))
  const attribute =
    attributes.find((item) => item.id === 'name') ??
    attributes.find((item) => item.id === 'title') ??
    attributes.find((item) => item.name.toLowerCase() === 'name') ??
    attributes.find((item) => item.name.toLowerCase() === 'title')
  if (attribute === undefined) {
    throw new Error(`Referenced class "${getReferenceClassName(ctx, targetClass)}" has no visible name or title field`)
  }
  return attribute
}

function getReferenceClassName (ctx: ClientSessionCtx, targetClass: Ref<Class<Doc>>): string {
  return getDisplayName(ctx.pipeline.context.hierarchy.getClass(targetClass), targetClass)
}

function resolveNamed<T extends { name: string }> (items: T[], name: string, kind: string): T {
  const matches = items.filter((item) => item.name === name)
  if (matches.length === 0) throw new Error(`${capitalize(kind)} named "${name}" was not found`)
  if (matches.length > 1) throw new Error(`${capitalize(kind)} name "${name}" is ambiguous`)
  return matches[0]
}

function getDisplayName (object: { label?: string, name?: string }, fallback: string): string {
  if (object.label?.startsWith(embeddedLabelPrefix) === true) return object.label.slice(embeddedLabelPrefix.length)
  const name = object.name?.trim()
  if (name !== undefined && name !== '') return name
  return getTypeName(fallback)
}

function getTypeName (id: string): string {
  return id.split(':').at(-1) ?? id
}

function capitalize (value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
