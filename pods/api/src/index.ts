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

import { getClient as getAccountClient, isNetworkError } from '@hcengineering/account-client'
import card from '@hcengineering/card'
import calendar from '@hcengineering/calendar'
import chunter from '@hcengineering/chunter'
import contact from '@hcengineering/contact'
import controlledDocuments from '@hcengineering/controlled-documents'
import { type Class, type Client, type Doc, type PersonId, type Ref } from '@hcengineering/core'
import document from '@hcengineering/document'
import platform, { errorToStatus, PlatformError, setMetadata } from '@hcengineering/platform'
import processPlugin from '@hcengineering/process'
import { createClient } from '@hcengineering/server-client'
import serverToken, { decodeToken, TokenError } from '@hcengineering/server-token'
import time from '@hcengineering/time'
import { type Express, type Request, type Response } from 'express'
import express from 'express'
import {
  createV2Document,
  createV2ClientSession,
  getV2Document,
  getV2Documents,
  getV2Spaces,
  getV2Schema,
  invokeV2Capability,
  patchV2Document,
  type V2Class,
  type V2Field
} from './v2Api'
import { registerWorkspaceApiResources } from './resources'

const port = Number(process.env.PORT ?? 8080)
const transactorUrl = process.env.TRANSACTOR_URL
const accountsUrl = process.env.ACCOUNTS_URL
const serverSecret = process.env.SERVER_SECRET
const workspaceClientConnectTimeoutMs = 10_000

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid port number')
if (transactorUrl === undefined || transactorUrl === '') throw new Error('TRANSACTOR_URL is required')
if (accountsUrl === undefined || accountsUrl === '') throw new Error('ACCOUNTS_URL is required')
if (serverSecret === undefined || serverSecret === '') throw new Error('SERVER_SECRET is required')

setMetadata(contact.metadata.LastNameFirst, process.env.LAST_NAME_FIRST === 'true')
setMetadata(serverToken.metadata.Secret, serverSecret)

const app: Express = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.get('/health', (_req, res) => res.status(200).json({ ok: true }))

registerWorkspaceApiResources()

type Handler = (client: Client, primarySocialId: PersonId, workspaceId: string, req: Request) => Promise<unknown>

type ApiErrorCode = 'validation_error' | 'unauthorized' | 'forbidden' | 'not_found' | 'internal_error'

interface ApiError {
  status: number
  body: {
    error: {
      code: ApiErrorCode
      message: string
      details?: Record<string, unknown>
    }
  }
}

const withWorkspace =
  (message: string, handler: Handler) =>
    (req: Request, res: Response): void => {
      const workspaceId = req.params.workspaceId
      let stage = 'validate_api_key'
      const startedAt = Date.now()
      logWorkspaceProgress(req, workspaceId, message, stage, startedAt)
      void (async () => {
        const token = getBearerToken(req)
        if (decodeToken(token).workspace !== workspaceId) throw new Error('Invalid workspace')
        const accountClient = getAccountClient(accountsUrl, token)
        const login = await accountClient.getLoginInfoByToken()
        if (login === null || !('socialId' in login) || login.socialId === undefined) {
          throw new Error('The API key user has no confirmed social identity')
        }
        stage = 'connect_workspace'
        logWorkspaceProgress(req, workspaceId, message, stage, startedAt)
        const client = await createClient(transactorUrl, token, undefined, workspaceClientConnectTimeoutMs)
        try {
          stage = 'workspace_connected'
          logWorkspaceProgress(req, workspaceId, message, stage, startedAt)
          stage = 'execute_operation'
          logWorkspaceProgress(req, workspaceId, message, stage, startedAt)
          const result = await handler(client, login.socialId, workspaceId, req)
          logWorkspaceProgress(req, workspaceId, message, 'send_response', startedAt)
          await sendJson(res, result)
        } finally {
          logWorkspaceProgress(req, workspaceId, message, 'close_workspace_client', startedAt)
          await client.close()
          logWorkspaceProgress(req, workspaceId, message, 'completed', startedAt)
        }
      })().catch((error) => {
        logWorkspaceError(req, workspaceId, message, stage, error)
        sendError(res, error)
      })
    }

const session = (
  client: Client,
  primarySocialId: PersonId,
  workspaceId: string
): ReturnType<typeof createV2ClientSession> => createV2ClientSession(client, workspaceId, primarySocialId)
const limit = (req: Request): number | undefined =>
  req.query.limit === undefined ? undefined : Number(req.query.limit)
const query = (req: Request, key: string): string => (typeof req.query[key] === 'string' ? req.query[key] : '')
const contactClass = (type: unknown): Ref<Class<Doc>> => {
  if (type === 'Person') return contact.class.Person
  if (type === 'Organization') return contact.class.Organization
  if (type === 'Employee') return contact.mixin.Employee
  throw new Error('Contact type must be Person, Organization, or Employee')
}
const toDoClass = (type: unknown): Ref<Class<Doc>> => {
  if (type === 'ToDo') return time.class.ToDo
  if (type === 'ProcessToDo') return processPlugin.class.ProcessToDo
  throw new Error('ToDo type must be ToDo or ProcessToDo')
}
app.get('/api/v2/swagger.json', (_req, res) => res.json(openApi))
app.get('/api/v2/openapi.json', (_req, res) => res.json(openApi))
app.get('/api/v2/swagger', (_req, res) => res.type('html').send(publicSwaggerUiHtml()))
app.get('/api/v2/:workspaceId/swagger', (_req, res) => res.type('html').send(swaggerUiHtml()))
app.get(
  '/api/v2/:workspaceId/swagger.json',
  withWorkspace('Unable to get workspace OpenAPI schema', async (client, primary, workspaceId) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return getWorkspaceOpenApi(await getV2Schema(ctx, clientSession))
  })
)
app.get(
  '/api/v2/:workspaceId/openapi.json',
  withWorkspace('Unable to get workspace OpenAPI schema', async (client, primary, workspaceId) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return getWorkspaceOpenApi(await getV2Schema(ctx, clientSession))
  })
)
app.get(
  '/api/v2/:workspaceId/schema',
  withWorkspace('Unable to get workspace schema', async (client, primary, workspaceId) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return { classes: await getV2Schema(ctx, clientSession) }
  })
)
app.get(
  '/api/v2/:workspaceId/spaces',
  withWorkspace('Unable to list spaces', async (client, primary, workspaceId, req) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return await getV2Spaces(ctx, clientSession, limit(req), query(req, 'class'))
  })
)
app.post(
  '/api/v2/:workspaceId/documents',
  withWorkspace('Unable to create document', async (client, primary, workspaceId, req) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return await createV2Document(ctx, clientSession, getBearerToken(req), req.body, document.class.Document)
  })
)
app.patch(
  '/api/v2/:workspaceId/documents',
  withWorkspace('Unable to update document', async (client, primary, workspaceId, req) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return await patchV2Document(ctx, clientSession, getBearerToken(req), req.body, document.class.Document)
  })
)
app.get(
  '/api/v2/:workspaceId/documents',
  withWorkspace('Unable to list documents', async (client, primary, workspaceId, req) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return await getV2Documents(ctx, clientSession, getBearerToken(req), {
      class: query(req, 'class'),
      space: query(req, 'space'),
      spaceBaseClass: document.class.Teamspace,
      limit: limit(req)
    })
  })
)

app.post(
  '/api/v2/:workspaceId/cards',
  withWorkspace('Unable to create card', async (client, primary, workspaceId, req) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return await createV2Document(ctx, clientSession, getBearerToken(req), req.body, card.class.Card)
  })
)
app.patch(
  '/api/v2/:workspaceId/cards',
  withWorkspace('Unable to update card', async (client, primary, workspaceId, req) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return await patchV2Document(ctx, clientSession, getBearerToken(req), req.body, card.class.Card)
  })
)
app.get(
  '/api/v2/:workspaceId/cards/:id',
  withWorkspace('Unable to get card', async (client, primary, workspaceId, req) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return await getV2Document(
      ctx,
      clientSession,
      getBearerToken(req),
      query(req, 'class'),
      req.params.id,
      card.class.Card
    )
  })
)
app.get(
  '/api/v2/:workspaceId/cards',
  withWorkspace('Unable to list cards', async (client, primary, workspaceId, req) => {
    const { ctx, session: clientSession } = session(client, primary, workspaceId)
    return await getV2Documents(ctx, clientSession, getBearerToken(req), {
      class: query(req, 'class'),
      baseClass: card.class.Card,
      space: query(req, 'space'),
      spaceBaseClass: card.class.CardSpace,
      limit: limit(req)
    })
  })
)

app.get(
  '/api/v2/:workspaceId/comments',
  withWorkspace('Unable to list comments', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(
      current.ctx,
      current.session,
      getBearerToken(req),
      ['communication-messages', 'legacy-comments'],
      {
        class: query(req, 'class'),
        defaultClass: card.class.Card,
        id: query(req, 'id'),
        input: { limit: limit(req) }
      }
    )
  })
)
app.post(
  '/api/v2/:workspaceId/comments',
  withWorkspace('Unable to create comment', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(
      current.ctx,
      current.session,
      getBearerToken(req),
      ['create-communication-message', 'create-legacy-comment'],
      {
        class: req.body.target?.class,
        defaultClass: card.class.Card,
        id: req.body.target?.id,
        input: { content: req.body.content }
      }
    )
  })
)
app.get(
  '/api/v2/:workspaceId/chats/messages',
  withWorkspace('Unable to list chat messages', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    const channel = query(req, 'channel')
    return await invokeV2Capability(
      current.ctx,
      current.session,
      getBearerToken(req),
      channel === '' ? ['communication-messages', 'messages'] : ['messages-by-name', 'messages'],
      {
        class: query(req, 'class'),
        defaultClass: channel === '' ? card.class.Card : chunter.class.Channel,
        id: query(req, 'id') === '' ? undefined : query(req, 'id'),
        input: { channel, limit: limit(req) }
      }
    )
  })
)
app.post(
  '/api/v2/:workspaceId/chats/messages',
  withWorkspace('Unable to create chat message', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(
      current.ctx,
      current.session,
      getBearerToken(req),
      req.body.channel === undefined
        ? ['create-communication-message', 'send-message']
        : ['send-message-by-name', 'send-message'],
      {
        class: req.body.target?.class ?? req.body.class,
        defaultClass: req.body.channel === undefined ? card.class.Card : chunter.class.Channel,
        id: req.body.target?.id ?? req.body.id,
        input: { channel: req.body.channel, content: req.body.content }
      }
    )
  })
)

app.post(
  '/api/v2/:workspaceId/contacts',
  withWorkspace('Unable to create contact', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'create', {
      defaultClass: contactClass(req.body.type),
      input: req.body
    })
  })
)
app.patch(
  '/api/v2/:workspaceId/contacts',
  withWorkspace('Unable to update contact', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'patch', {
      defaultClass: contactClass(req.body.type),
      id: req.body.id,
      input: req.body
    })
  })
)
app.get(
  '/api/v2/:workspaceId/contacts',
  withWorkspace('Unable to list contacts', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'find', {
      defaultClass: contactClass(query(req, 'type') === '' ? 'Person' : query(req, 'type')),
      input: { limit: limit(req) }
    })
  })
)
app.get(
  '/api/v2/:workspaceId/calendar/events',
  withWorkspace('Unable to list calendar events', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'find', {
      defaultClass: calendar.class.Event,
      input: { calendar: query(req, 'calendar'), limit: limit(req) }
    })
  })
)
app.post(
  '/api/v2/:workspaceId/calendar/events',
  withWorkspace('Unable to create calendar event', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'create', {
      defaultClass: calendar.class.Event,
      input: req.body
    })
  })
)
app.patch(
  '/api/v2/:workspaceId/calendar/events',
  withWorkspace('Unable to update calendar event', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'patch', {
      defaultClass: calendar.class.Event,
      id: req.body.id,
      input: req.body
    })
  })
)
app.get(
  '/api/v2/:workspaceId/todos',
  withWorkspace('Unable to list ToDos', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'find', {
      defaultClass: toDoClass(query(req, 'type') === '' ? 'ToDo' : query(req, 'type')),
      input: { limit: limit(req) }
    })
  })
)
app.post(
  '/api/v2/:workspaceId/todos',
  withWorkspace('Unable to create ToDo', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'create', {
      defaultClass: time.class.ToDo,
      input: req.body
    })
  })
)
app.patch(
  '/api/v2/:workspaceId/todos',
  withWorkspace('Unable to update ToDo', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'patch', {
      defaultClass: toDoClass(req.body.type ?? 'ToDo'),
      id: req.body.id,
      input: req.body
    })
  })
)

app.get(
  '/api/v2/:workspaceId/controlled-documents',
  withWorkspace('Unable to list controlled documents', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'find', {
      defaultClass: controlledDocuments.class.ControlledDocument,
      input: { limit: limit(req) }
    })
  })
)
app.get(
  '/api/v2/:workspaceId/controlled-documents/:id/versions',
  withWorkspace('Unable to list controlled document versions', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'versions', {
      defaultClass: controlledDocuments.class.ControlledDocument,
      id: req.params.id
    })
  })
)
app.post(
  '/api/v2/:workspaceId/controlled-documents/:id/drafts',
  withWorkspace('Unable to create controlled document draft', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'create-draft', {
      defaultClass: controlledDocuments.class.ControlledDocument,
      id: req.params.id
    })
  })
)
app.post(
  '/api/v2/:workspaceId/controlled-documents/:id/review',
  withWorkspace('Unable to send controlled document for review', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'send-review', {
      defaultClass: controlledDocuments.class.ControlledDocument,
      id: req.params.id,
      input: req.body
    })
  })
)
app.post(
  '/api/v2/:workspaceId/controlled-documents/:id/approval',
  withWorkspace('Unable to send controlled document for approval', async (client, primary, workspaceId, req) => {
    const current = session(client, primary, workspaceId)
    return await invokeV2Capability(current.ctx, current.session, getBearerToken(req), 'send-approval', {
      defaultClass: controlledDocuments.class.ControlledDocument,
      id: req.params.id,
      input: req.body
    })
  })
)

const standardErrorResponses = {
  400: { $ref: '#/components/responses/ValidationError' },
  401: { $ref: '#/components/responses/UnauthorizedError' },
  403: { $ref: '#/components/responses/ForbiddenError' },
  404: { $ref: '#/components/responses/NotFoundError' },
  503: { $ref: '#/components/responses/ServiceUnavailableError' },
  500: { $ref: '#/components/responses/InternalError' }
}

const openApi = {
  openapi: '3.0.3',
  info: { title: 'TraceX workspace API v2', version: 'v2' },
  paths: {
    '/api/v2/{workspaceId}/schema': {
      get: {
        summary: 'Get classes, visible fields, enum/status values, and allowed space classes',
        parameters: workspacePathParameters(),
        responses: successResponses('WorkspaceSchema')
      }
    },
    '/api/v2/{workspaceId}/spaces': {
      get: {
        summary: 'List visible spaces with their visible class names',
        parameters: workspacePathParameters(
          optionalQueryParameter(
            'class',
            'Optional visible class name. When specified, returns only spaces where that class can be created.'
          ),
          listLimitParameter()
        ),
        responses: successResponses('Spaces')
      }
    },
    '/api/v2/{workspaceId}/documents': {
      get: {
        summary: 'List documents',
        parameters: workspacePathParameters(
          optionalQueryParameter('class', 'Visible Document subclass name. Omit for Document.', {
            default: 'Document'
          }),
          optionalQueryParameter('space', 'Optional visible space name used to filter the result'),
          listLimitParameter()
        ),
        responses: successResponses('DocumentList')
      },
      post: {
        summary: 'Create document',
        parameters: workspacePathParameters(),
        requestBody: jsonRequestBody('CreateDocumentRequest'),
        responses: successResponses('Document')
      },
      patch: {
        summary: 'Update document by id',
        parameters: workspacePathParameters(),
        requestBody: jsonRequestBody('PatchDocumentRequest'),
        responses: successResponses('Document')
      }
    },
    '/api/v2/{workspaceId}/cards': {
      get: {
        summary: 'List cards',
        parameters: workspacePathParameters(
          optionalQueryParameter('class', 'Visible Card subclass name. Omit for Card.', { default: 'Card' }),
          optionalQueryParameter('space', 'Optional visible Card space name used to filter the result'),
          listLimitParameter()
        ),
        responses: successResponses('DocumentList')
      },
      post: { summary: 'Create card', parameters: workspacePathParameters(), responses: standardErrorResponses },
      patch: { summary: 'Update card by id', parameters: workspacePathParameters(), responses: standardErrorResponses }
    },
    '/api/v2/{workspaceId}/cards/{id}': {
      get: {
        summary: 'Get card strictly by id',
        parameters: workspacePathParameters(
          idPathParameter(),
          optionalQueryParameter('class', 'Visible Card subclass name. Omit for Card.', { default: 'Card' })
        ),
        responses: successResponses('Document')
      }
    },
    '/api/v2/{workspaceId}/comments': {
      get: {
        summary: 'Read comments using the workspace-selected backend',
        parameters: workspacePathParameters(
          optionalQueryParameter('class', 'Target class name. Omit for a Card target.', { default: 'Card' }),
          requiredQueryParameter('id', 'Target document id'),
          listLimitParameter()
        ),
        responses: successResponses('CommentList')
      },
      post: {
        summary: 'Create a comment using the workspace-selected backend',
        parameters: workspacePathParameters(),
        requestBody: jsonRequestBody('CommentRequest'),
        responses: successResponses('Comment')
      }
    },
    '/api/v2/{workspaceId}/chats/messages': {
      get: {
        summary: 'Read chat messages using the workspace-selected backend',
        parameters: workspacePathParameters(
          optionalQueryParameter(
            'class',
            'Target class name. Omit for a Card target; channel selects a legacy Channel.',
            {
              default: 'Card'
            }
          ),
          optionalQueryParameter('id', 'Target document id; use with class for a target-based chat'),
          optionalQueryParameter('channel', 'Unique legacy channel name; use instead of id'),
          listLimitParameter()
        ),
        responses: successResponses('CommentList')
      },
      post: {
        summary: 'Write a chat message using the workspace-selected backend',
        parameters: workspacePathParameters(),
        requestBody: jsonRequestBody('ChatMessageRequest'),
        responses: successResponses('Comment')
      }
    },
    '/api/v2/{workspaceId}/contacts': {
      get: {
        summary: 'List contacts',
        parameters: workspacePathParameters(
          optionalQueryParameter('type', 'Contact kind', {
            enum: ['Person', 'Organization', 'Employee'],
            default: 'Person'
          }),
          listLimitParameter()
        ),
        responses: successResponses('DocumentList')
      },
      post: {
        summary: 'Create contact',
        parameters: workspacePathParameters(),
        requestBody: jsonRequestBody('ContactCreateRequest'),
        responses: successResponses('Document')
      },
      patch: {
        summary: 'Update contact',
        parameters: workspacePathParameters(),
        requestBody: jsonRequestBody('ContactPatchRequest'),
        responses: successResponses('Document')
      }
    },
    '/api/v2/{workspaceId}/calendar/events': {
      get: {
        summary: 'List events',
        parameters: workspacePathParameters(
          requiredQueryParameter('calendar', 'Visible calendar name'),
          listLimitParameter()
        ),
        responses: successResponses('DocumentList')
      },
      post: {
        summary: 'Create event',
        parameters: workspacePathParameters(),
        requestBody: jsonRequestBody('CalendarEventCreateRequest'),
        responses: successResponses('Document')
      },
      patch: {
        summary: 'Update event',
        parameters: workspacePathParameters(),
        requestBody: jsonRequestBody('CalendarEventPatchRequest'),
        responses: successResponses('Document')
      }
    },
    '/api/v2/{workspaceId}/todos': {
      get: {
        summary: 'List ToDos',
        parameters: workspacePathParameters(
          optionalQueryParameter('type', 'ToDo kind', { enum: ['ToDo', 'ProcessToDo'], default: 'ToDo' }),
          listLimitParameter()
        ),
        responses: successResponses('DocumentList')
      },
      post: {
        summary: 'Create ToDo',
        parameters: workspacePathParameters(),
        requestBody: jsonRequestBody('ToDoCreateRequest'),
        responses: successResponses('Document')
      },
      patch: {
        summary: 'Update ToDo without completing it',
        parameters: workspacePathParameters(),
        requestBody: jsonRequestBody('ToDoPatchRequest'),
        responses: successResponses('Document')
      }
    },
    '/api/v2/{workspaceId}/controlled-documents': {
      get: {
        summary: 'List controlled documents',
        parameters: workspacePathParameters(listLimitParameter()),
        responses: successResponses('DocumentList')
      }
    },
    '/api/v2/{workspaceId}/controlled-documents/{id}/versions': {
      get: {
        summary: 'Read current and archived versions',
        parameters: workspacePathParameters(idPathParameter()),
        responses: successResponses('DocumentList')
      }
    },
    '/api/v2/{workspaceId}/controlled-documents/{id}/drafts': {
      post: {
        summary: 'Create controlled document draft',
        parameters: workspacePathParameters(idPathParameter()),
        responses: successResponses('Document')
      }
    },
    '/api/v2/{workspaceId}/controlled-documents/{id}/review': {
      post: {
        summary: 'Send controlled document for review',
        parameters: workspacePathParameters(idPathParameter()),
        requestBody: jsonRequestBody('ReviewRequest'),
        responses: successResponses('Document')
      }
    },
    '/api/v2/{workspaceId}/controlled-documents/{id}/approval': {
      post: {
        summary: 'Send controlled document for approval',
        parameters: workspacePathParameters(idPathParameter()),
        requestBody: jsonRequestBody('ApprovalRequest'),
        responses: successResponses('Document')
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API key' }
    },
    schemas: {
      ApiError: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                enum: ['validation_error', 'unauthorized', 'forbidden', 'not_found', 'internal_error']
              },
              message: { type: 'string' },
              details: { type: 'object', additionalProperties: true }
            }
          }
        }
      },
      WorkspaceSchema: {
        type: 'object',
        required: ['classes'],
        properties: {
          classes: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'fields'],
              properties: {
                name: { type: 'string' },
                factory: { type: 'boolean' },
                createIn: { type: 'array', items: { type: 'string' } },
                operations: { type: 'array', items: { type: 'string' } },
                fields: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['name', 'type', 'required', 'custom'],
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string' },
                      required: { type: 'boolean' },
                      custom: { type: 'boolean' },
                      markdown: { type: 'boolean' },
                      values: { type: 'array', items: { type: 'string' } }
                    }
                  }
                }
              }
            }
          }
        }
      },
      Spaces: {
        type: 'object',
        required: ['spaces', 'total'],
        properties: {
          spaces: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'class'],
              properties: { name: { type: 'string' }, class: { type: 'string' } }
            }
          },
          total: { type: 'integer' }
        }
      },
      Document: {
        type: 'object',
        required: ['id', 'class', 'space', 'fields'],
        properties: {
          id: { type: 'string', description: 'Document id; use it for PATCH and exact-object routes.' },
          class: { type: 'string', description: 'Visible class name.' },
          space: { type: 'string', description: 'Visible space name.' },
          fields: { type: 'object', additionalProperties: true }
        }
      },
      DocumentList: {
        type: 'object',
        required: ['documents', 'total'],
        properties: {
          documents: { type: 'array', items: { $ref: '#/components/schemas/Document' } },
          total: { type: 'integer' }
        }
      },
      CreateDocumentRequest: {
        type: 'object',
        required: ['space'],
        properties: {
          class: { type: 'string', description: 'Visible class name. Omit only on a class-specific endpoint.' },
          space: { type: 'string', description: 'Visible name of a compatible space.' },
          fields: { type: 'object', additionalProperties: true }
        }
      },
      PatchDocumentRequest: {
        type: 'object',
        required: ['id', 'fields'],
        properties: {
          id: { type: 'string' },
          class: { type: 'string', description: 'Visible class name when needed to select an endpoint subclass.' },
          fields: { type: 'object', minProperties: 1, additionalProperties: true }
        }
      },
      Comment: {
        type: 'object',
        required: ['id', 'content'],
        properties: {
          id: { type: 'string' },
          content: { type: 'string', description: 'Markdown text.' },
          createdOn: { type: 'integer', format: 'int64', description: 'Unix timestamp in milliseconds.' },
          createdBy: { type: 'string', description: 'Author identifier.' }
        }
      },
      CommentList: {
        type: 'array',
        items: { $ref: '#/components/schemas/Comment' }
      },
      CommentRequest: {
        type: 'object',
        required: ['target', 'content'],
        properties: {
          target: {
            type: 'object',
            required: ['id'],
            properties: {
              class: { type: 'string', description: 'Visible target class name. Omit for Card.' },
              id: { type: 'string', description: 'Target document id.' }
            }
          },
          content: { type: 'string', minLength: 1, description: 'Comment body in Markdown.' }
        }
      },
      ChatMessageRequest: {
        type: 'object',
        required: ['content'],
        properties: {
          target: {
            type: 'object',
            required: ['id'],
            properties: {
              class: { type: 'string', description: 'Visible target class name. Omit for Card.' },
              id: { type: 'string', description: 'Target document id.' }
            }
          },
          channel: { type: 'string', description: 'Unique legacy channel name. Use instead of target.' },
          content: { type: 'string', minLength: 1, description: 'Message body in Markdown.' }
        },
        oneOf: [{ required: ['target'] }, { required: ['channel'] }]
      },
      ContactCreateRequest: {
        type: 'object',
        required: ['type', 'name'],
        properties: {
          type: { type: 'string', enum: ['Person', 'Organization'] },
          name: { type: 'string', minLength: 1, description: 'Full display name.' },
          city: { type: 'string' },
          birthday: { type: 'integer', format: 'int64', nullable: true, description: 'Unix timestamp in milliseconds.' }
        }
      },
      ContactPatchRequest: {
        type: 'object',
        required: ['id', 'type'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['Person', 'Organization'] },
          name: { type: 'string', minLength: 1, description: 'Full display name.' },
          city: { type: 'string' },
          birthday: { type: 'integer', format: 'int64', nullable: true, description: 'Unix timestamp in milliseconds.' }
        }
      },
      CalendarEventCreateRequest: {
        type: 'object',
        required: ['calendar', 'title', 'date', 'dueDate'],
        properties: {
          calendar: { type: 'string', description: 'Visible calendar name.' },
          title: { type: 'string', minLength: 1 },
          date: { type: 'integer', format: 'int64', description: 'Start time as a Unix timestamp in milliseconds.' },
          dueDate: { type: 'integer', format: 'int64', description: 'End time as a Unix timestamp in milliseconds.' },
          allDay: { type: 'boolean' },
          description: { type: 'string', description: 'Description in Markdown.' },
          location: { type: 'string' },
          participants: { type: 'array', items: { type: 'string' } },
          externalParticipants: { type: 'array', items: { type: 'string' } },
          visibility: { type: 'string', enum: ['public', 'freeBusy', 'private'] },
          reminders: { type: 'array', items: { type: 'integer' } },
          timeZone: { type: 'string' }
        }
      },
      CalendarEventPatchRequest: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string', minLength: 1 },
          date: { type: 'integer', format: 'int64', description: 'Start time as a Unix timestamp in milliseconds.' },
          dueDate: { type: 'integer', format: 'int64', description: 'End time as a Unix timestamp in milliseconds.' },
          allDay: { type: 'boolean' },
          description: { type: 'string', description: 'Description in Markdown.' },
          location: { type: 'string' },
          participants: { type: 'array', items: { type: 'string' } },
          externalParticipants: { type: 'array', items: { type: 'string' } },
          visibility: { type: 'string', enum: ['public', 'freeBusy', 'private'] },
          reminders: { type: 'array', items: { type: 'integer' } },
          timeZone: { type: 'string' }
        }
      },
      ToDoCreateRequest: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', description: 'Description in Markdown.' },
          dueDate: { type: 'integer', format: 'int64', nullable: true, description: 'Unix timestamp in milliseconds.' },
          priority: {
            type: 'integer',
            enum: [0, 1, 2, 3, 4],
            description: 'Priority: 0 = High, 1 = Medium, 2 = Low, 3 = No priority, 4 = Urgent.'
          },
          visibility: { type: 'string', enum: ['public', 'freeBusy', 'private'] }
        }
      },
      ToDoPatchRequest: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['ToDo', 'ProcessToDo'], default: 'ToDo' },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', description: 'Description in Markdown.' },
          dueDate: { type: 'integer', format: 'int64', nullable: true, description: 'Unix timestamp in milliseconds.' },
          priority: {
            type: 'integer',
            enum: [0, 1, 2, 3, 4],
            description: 'Priority: 0 = High, 1 = Medium, 2 = Low, 3 = No priority, 4 = Urgent.'
          },
          visibility: { type: 'string', enum: ['public', 'freeBusy', 'private'] }
        }
      },
      ReviewRequest: {
        type: 'object',
        required: ['reviewers'],
        properties: {
          reviewers: { type: 'array', minItems: 1, items: { type: 'string', description: 'Employee display name.' } }
        }
      },
      ApprovalRequest: {
        type: 'object',
        required: ['approvers'],
        properties: {
          approvers: { type: 'array', minItems: 1, items: { type: 'string', description: 'Employee display name.' } }
        }
      }
    },
    responses: {
      ValidationError: {
        description: 'Validation failed',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } }
      },
      UnauthorizedError: {
        description: 'Missing, invalid, expired, or revoked API key',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } }
      },
      ForbiddenError: {
        description: 'The API key user is not permitted to perform the operation',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } }
      },
      NotFoundError: {
        description: 'The requested object does not exist or is not visible to the API key user',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } }
      },
      InternalError: {
        description: 'Unexpected server error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } }
      },
      ServiceUnavailableError: {
        description: 'A required API service is temporarily unavailable',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } }
      }
    }
  },
  security: [{ bearerAuth: [] }]
}

function requiredQueryParameter (name: string, description: string): object {
  return { name, in: 'query', required: true, description, schema: { type: 'string' } }
}

function optionalQueryParameter (name: string, description: string, schema: Record<string, unknown> = {}): object {
  return { name, in: 'query', required: false, description, schema: { type: 'string', ...schema } }
}

function workspacePathParameters (...parameters: object[]): object[] {
  return [
    {
      name: 'workspaceId',
      in: 'path',
      required: true,
      description: 'Workspace UUID. It must match the workspace embedded in the API key.',
      schema: { type: 'string', format: 'uuid' }
    },
    ...parameters
  ]
}

function idPathParameter (): object {
  return {
    name: 'id',
    in: 'path',
    required: true,
    description: 'Exact document id.',
    schema: { type: 'string' }
  }
}

function jsonRequestBody (schema: string): object {
  return {
    required: true,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } }
  }
}

function successResponses (schema: string): object {
  return {
    200: {
      description: 'Successful response',
      content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } }
    },
    ...standardErrorResponses
  }
}

function listLimitParameter (): object {
  return {
    name: 'limit',
    in: 'query',
    required: false,
    description: 'Maximum number of items to return. Defaults to 100; maximum is 1000.',
    schema: { type: 'integer', minimum: 1, maximum: 1000, default: 100 }
  }
}

function publicSwaggerUiHtml (): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TraceX Workspace API v2</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css">
    <style>body { margin: 0; background: #fafafa; font-family: sans-serif; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({
        url: '/api/v2/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: false
      })
    </script>
  </body>
</html>`
}

function swaggerUiHtml (): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TraceX Workspace API v2</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui.css">
    <style>
      body { margin: 0; background: #fafafa; font-family: sans-serif; }
      #credentials { display: flex; gap: 8px; align-items: center; padding: 16px; background: #fff; border-bottom: 1px solid #ddd; }
      #api-key { flex: 1; max-width: 480px; padding: 8px; }
      #load { padding: 8px 12px; cursor: pointer; }
      #hint { color: #666; font-size: 14px; }
    </style>
  </head>
  <body>
    <form id="credentials">
      <label for="api-key">API key</label>
      <input id="api-key" type="password" autocomplete="off" placeholder="Paste the workspace API key">
      <button id="load" type="submit">Open API</button>
      <span id="hint">The key is kept only in this page and is never added to the URL.</span>
    </form>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
    <script>
      const form = document.getElementById('credentials')
      const apiKeyInput = document.getElementById('api-key')
      const specUrl = window.location.pathname.replace(/\\/swagger$/, '/openapi.json')
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        const apiKey = apiKeyInput.value.trim()
        if (apiKey === '') {
          apiKeyInput.focus()
          return
        }
        SwaggerUIBundle({
          url: specUrl,
          dom_id: '#swagger-ui',
          deepLinking: true,
          persistAuthorization: false,
          requestInterceptor: (request) => {
            request.headers = request.headers || {}
            request.headers.Authorization = 'Bearer ' + apiKey
            return request
          }
        })
      })
    </script>
  </body>
</html>`
}

function getWorkspaceOpenApi (classes: V2Class[]): object {
  return {
    ...openApi,
    components: {
      ...openApi.components,
      schemas: {
        ...openApi.components.schemas,
        CreateDocumentRequest: {
          oneOf: classes.filter((item) => item.factory === true).map((item) => getDocumentSchema(item, false))
        },
        PatchDocumentRequest: {
          oneOf: classes.filter((item) => item.factory === true).map((item) => getDocumentSchema(item, true))
        }
      }
    }
  }
}

function getDocumentSchema (documentClass: V2Class, patch: boolean): object {
  return {
    title: documentClass.name,
    type: 'object',
    required: patch ? ['class', 'id', 'fields'] : ['class', 'space'],
    properties: {
      class: { type: 'string', enum: [documentClass.name] },
      ...(patch ? { id: { type: 'string' } } : { space: { type: 'string' } }),
      fields: {
        type: 'object',
        minProperties: patch ? 1 : undefined,
        properties: Object.fromEntries(documentClass.fields.map((field) => [field.name, getFieldSchema(field)])),
        ...(patch
          ? {}
          : { required: documentClass.fields.filter((field) => field.required).map((field) => field.name) })
      }
    }
  }
}

function getFieldSchema (field: V2Field): object {
  return {
    type: 'string',
    ...(field.markdown === true ? { description: 'Markdown text', format: 'markdown' } : {}),
    ...(field.values === undefined ? {} : { enum: field.values })
  }
}

function getBearerToken (req: Request): string {
  const value = req.header('authorization')
  if (value === undefined || !value.startsWith('Bearer ')) throw new Error('Missing Authorization header')
  return value.slice('Bearer '.length)
}

function sendError (res: Response, error: unknown): void {
  const apiError = toApiError(error)
  res.status(apiError.status).json(apiError.body)
}

function logWorkspaceError (req: Request, workspaceId: string, operation: string, stage: string, error: unknown): void {
  const apiError = toApiError(error)
  const exception = error instanceof Error ? error : undefined
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'Workspace API request failed',
      operation,
      stage,
      method: req.method,
      path: req.path,
      workspaceId,
      status: apiError.status,
      error: {
        name: exception?.name ?? 'UnknownError',
        message: exception?.message ?? 'Non-error exception',
        stack: exception?.stack
      }
    })
  )
}

function logWorkspaceProgress (
  req: Request,
  workspaceId: string,
  operation: string,
  stage: string,
  startedAt: number
): void {
  console.info(
    JSON.stringify({
      level: 'info',
      message: 'Workspace API request progress',
      operation,
      stage,
      method: req.method,
      path: req.path,
      workspaceId,
      elapsedMs: Date.now() - startedAt
    })
  )
}

function toApiError (error: unknown): ApiError {
  const message = error instanceof Error ? error.message : undefined
  const status = errorToStatus(error)
  const details = isRecord(status.params) && Object.keys(status.params).length > 0 ? status.params : undefined

  if (
    error instanceof TokenError ||
    message === 'Missing Authorization header' ||
    isUnauthorizedStatus(status.code) ||
    getHttpStatus(error) === 401
  ) {
    return apiError(401, 'unauthorized', 'API key is missing, invalid, expired, or revoked')
  }
  if (message === 'Invalid workspace' || status.code === platform.status.Forbidden || getHttpStatus(error) === 403) {
    return apiError(403, 'forbidden', 'The API key user is not allowed to perform this operation', details)
  }
  if (isNetworkError(error)) {
    return apiError(503, 'internal_error', 'A required API service is temporarily unavailable')
  }
  if (message !== undefined && message.startsWith('Connection timeout, and no connection established')) {
    return apiError(503, 'internal_error', 'The workspace service did not accept the API key in time')
  }
  if (error instanceof PlatformError || hasPlatformStatus(error)) {
    if (status.code === platform.status.BadRequest || status.code === platform.status.InvalidId) {
      return apiError(400, 'validation_error', getStatusMessage(details, 'Request validation failed'), details)
    }
    return apiError(500, 'internal_error', 'The request could not be completed')
  }
  if (message !== undefined) {
    if (message.includes(' was not found') && !message.includes('ambiguous')) {
      return apiError(404, 'not_found', message)
    }
    return apiError(400, 'validation_error', message)
  }
  return apiError(500, 'internal_error', 'The request could not be completed')
}

function apiError (status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>): ApiError {
  return { status, body: { error: { code, message, ...(details === undefined ? {} : { details }) } } }
}

function isUnauthorizedStatus (code: string): boolean {
  return [
    platform.status.Unauthorized,
    platform.status.TokenExpired,
    platform.status.TokenNotActive,
    platform.status.PasswordExpired
  ].includes(code as any)
}

function getStatusMessage (details: Record<string, unknown> | undefined, fallback: string): string {
  return typeof details?.message === 'string' && details.message !== '' ? details.message : fallback
}

function hasPlatformStatus (error: unknown): boolean {
  return isRecord(error) && isRecord(error.status) && typeof error.status.code === 'string'
}

function getHttpStatus (error: unknown): number | undefined {
  if (!isRecord(error)) return undefined
  return typeof error.status === 'number'
    ? error.status
    : typeof error.statusCode === 'number'
      ? error.statusCode
      : undefined
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function sendJson (res: Response, value: unknown): Promise<void> {
  res.status(200).json(value)
}

app.use((error: unknown, _req: Request, res: Response, next: (error?: unknown) => void): void => {
  if (res.headersSent) {
    next(error)
    return
  }
  sendError(res, error)
})

export { app }

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Workspace API pod listening on ${port}`)
  })
}
