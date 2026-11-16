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

import { Router, json } from 'express'
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express'
import { AgentOperationFailure } from '@hcengineering/text-agent'
import { decodeDocumentId } from '@hcengineering/collaborator-client'
import type { AgentApiErrorResponse } from '@hcengineering/collaborator-client'
import { Type, type Static, type TSchema } from 'typebox'
import Schema from 'typebox/schema'
import {
  GetAgentSchemaRequestSchema,
  GetAgentSchemaResponseSchema,
  GetAgentOutlineRequestSchema,
  GetAgentOutlineResponseSchema,
  FindAgentNodesRequestSchema,
  FindAgentNodesResponseSchema,
  ReadAgentNodeRequestSchema,
  ReadAgentNodeResponseSchema,
  ApplyAgentOpsBodySchema,
  ApplyAgentOpsRequestSchema,
  ApplyAgentOpsResponseSchema
} from './schema'
import type { AgentActor } from './access'
import type { AgentService } from './service'
import { AgentApiFailure } from './errors'

export type AuthenticateAgent = (rawToken: string) => Promise<AgentActor>

function sendError (
  response: Response<AgentApiErrorResponse>,
  status: number,
  code: string,
  message: string,
  outcome: AgentApiErrorResponse['error']['outcome'] = 'not_applied'
): void {
  const output: AgentApiErrorResponse = { error: { code, message, retryable: false, outcome } }
  response.status(status).json(output)
}

function handleFailure (response: Response<AgentApiErrorResponse>, error: unknown): void {
  if (error instanceof AgentApiFailure) {
    sendError(response, error.status, error.code, error.message)
  } else if (error instanceof AgentOperationFailure) {
    const status = error.code === 'STALE_REFERENCE' ? 409 : error.code === 'FORBIDDEN' ? 403 : 422
    sendError(response, status, error.code, error.message)
  } else {
    sendError(
      response,
      500,
      'collaborator_request_failed',
      'Collaborative request failed. If this was a write, its outcome may be uncertain; read before another write.',
      'unknown'
    )
  }
}

function handle<I extends TSchema, O extends TSchema> (
  inputSchema: I,
  outputSchema: O,
  parse: (request: Request) => unknown,
  run: (input: Static<I>, actor: AgentActor) => Static<O> | Promise<Static<O>>
): RequestHandler {
  const inputValidator = Schema.Compile(inputSchema)
  const outputValidator = Schema.Compile(outputSchema)
  return (request, response) => {
    const actor: AgentActor = response.locals.agentActor
    void Promise.resolve()
      .then(async () => {
        const input = parse(request)
        if (!inputValidator.Check(input)) {
          throw new AgentApiFailure(400, 'invalid_request', 'Request does not match the API schema.')
        }
        const output = await run(input, actor)
        if (!outputValidator.Check(output)) throw new Error('Response does not match the API schema.')
        response.json(output)
      })
      .catch((error: unknown) => {
        handleFailure(response, error)
      })
  }
}

function pageQuery (request: Request): Record<string, unknown> {
  const values: Record<string, unknown> = { ...request.query }
  if (Object.hasOwn(values, 'document')) {
    throw new AgentApiFailure(400, 'invalid_request', 'Document address belongs in the route.')
  }
  for (const name of ['from', 'limit']) {
    const value = values[name]
    if (typeof value === 'string' && /^\d+$/.test(value)) values[name] = Number(value)
  }
  return values
}

/** Authenticated REST API over the service's live Hocuspocus documents. */
export function createAgentRouter (authenticate: AuthenticateAgent, api: AgentService): Router {
  const router = Router()
  router.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    const match = request.headers.authorization?.match(/^Bearer ([^\s]+)$/i)
    if (match === undefined || match === null) {
      sendError(response, 401, 'unauthorized', 'A bearer token is required.')
      return
    }
    void Promise.resolve()
      .then(async () => await authenticate(match[1]))
      .then(
        (actor) => {
          response.locals.agentActor = actor
          next()
        },
        () => {
          sendError(response, 401, 'unauthorized', 'The bearer token cannot access a workspace.')
        }
      )
  })
  router.use(json({ limit: '10mb' }))
  router.param('docName', (_request, response, next, docName: string) => {
    const actor: AgentActor = response.locals.agentActor
    const parts = docName.split('|')
    if (parts.length !== 4 || parts.some((part) => part.length === 0)) {
      sendError(response, 400, 'invalid_document', 'Expected workspaceId|objectClass|objectId|objectAttr.')
      return
    }
    if (parts[0] !== actor.workspace) {
      sendError(response, 403, 'forbidden', 'The document belongs to a different workspace.')
      return
    }
    next()
  })
  const queryValidator = Schema.Compile(Type.Object({}, { additionalProperties: false }))
  router.get(
    '/schema',
    handle(
      GetAgentSchemaRequestSchema,
      GetAgentSchemaResponseSchema,
      (request) => {
        const values: Record<string, unknown> = { ...request.query }
        for (const name of ['nodes', 'marks']) {
          if (typeof values[name] === 'string') {
            try {
              values[name] = JSON.parse(values[name])
            } catch {
              throw new AgentApiFailure(400, 'invalid_request', 'Schema filters must be JSON arrays of type names.')
            }
          }
        }
        return values
      },
      (input) => api.schema(input)
    )
  )
  router.get(
    '/:docName/outline',
    handle(
      GetAgentOutlineRequestSchema,
      GetAgentOutlineResponseSchema,
      (request) => ({ ...pageQuery(request), document: decodeDocumentId(request.params.docName).documentId }),
      async (input, actor) => await api.outline(actor, input)
    )
  )
  router.get(
    '/:docName/find',
    handle(
      FindAgentNodesRequestSchema,
      FindAgentNodesResponseSchema,
      (request) => ({ ...pageQuery(request), document: decodeDocumentId(request.params.docName).documentId }),
      async (input, actor) => await api.find(actor, input)
    )
  )
  router.get(
    '/:docName/nodes/:ref',
    handle(
      ReadAgentNodeRequestSchema,
      ReadAgentNodeResponseSchema,
      (request) => {
        if (!queryValidator.Check(request.query)) {
          throw new AgentApiFailure(400, 'invalid_request', 'This method does not accept query parameters.')
        }
        return { document: decodeDocumentId(request.params.docName).documentId, ref: request.params.ref }
      },
      async (input, actor) => await api.read(actor, input)
    )
  )
  // Check body and query separately so address and operation fields cannot be injected through another channel.
  const bodyValidator = Schema.Compile(ApplyAgentOpsBodySchema)
  router.post(
    '/:docName/ops',
    handle(
      ApplyAgentOpsRequestSchema,
      ApplyAgentOpsResponseSchema,
      (request) => {
        if (!queryValidator.Check(request.query)) {
          throw new AgentApiFailure(400, 'invalid_request', 'This method does not accept query parameters.')
        }
        const body: unknown = request.body
        if (!bodyValidator.Check(body)) {
          throw new AgentApiFailure(400, 'invalid_request', 'Body does not match the API schema.')
        }
        return { ...body, document: decodeDocumentId(request.params.docName).documentId }
      },
      async (input, actor) => await api.apply(actor, input)
    )
  )
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof SyntaxError) sendError(response, 400, 'invalid_request', 'Invalid JSON request body.')
    else handleFailure(response, error)
  }
  router.use(errors)
  return router
}
