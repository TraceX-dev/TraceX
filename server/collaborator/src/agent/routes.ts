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

import { Router } from 'express'
import type { RequestHandler, Response } from 'express'
import type {
  AgentApiErrorResponse,
  ApplyAgentOpsBody,
  ApplyAgentOpsResponse,
  FindAgentNodesResponse,
  GetAgentOutlineResponse,
  GetAgentSchemaResponse,
  ReadAgentNodeResponse
} from '@hcengineering/collaborator-client'

/** Resolve and authorize the token workspace using the service's existing authentication. */
export type AuthenticateAgent = (rawToken: string) => Promise<string>

function sendError (response: Response<AgentApiErrorResponse>, status: number, code: string, message: string): void {
  const output: AgentApiErrorResponse = { error: { code, message, retryable: false } }
  response.status(status).json(output)
}

function placeholder<T, Body = unknown> (): RequestHandler<Record<string, string>, T | AgentApiErrorResponse, Body> {
  return (_request, response) => {
    const output: AgentApiErrorResponse = {
      error: { code: 'not_implemented', message: 'Collaborative agent API is not implemented yet.', retryable: false }
    }
    response.status(501).json(output)
  }
}

/** REST scaffold only: authenticates requests but never opens, reads or mutates a document. */
export function createAgentRouter (authenticate: AuthenticateAgent): Router {
  const router = Router()
  router.use((request, response, next) => {
    response.setHeader('Cache-Control', 'no-store')
    const authorization = request.headers.authorization
    const match = authorization?.match(/^Bearer ([^\s]+)$/i)
    if (match === undefined || match === null) {
      sendError(response, 401, 'unauthorized', 'A bearer token is required.')
      return
    }
    void Promise.resolve().then(async () => await authenticate(match[1])).then(
      (workspace) => {
        response.locals.agentWorkspace = workspace
        next()
      },
      () => { sendError(response, 401, 'unauthorized', 'The bearer token cannot access a workspace.') }
    )
  })
  router.param('docName', (request, response, next, docName: string) => {
    const parts = docName.split('|')
    if (parts.length !== 4 || parts.some((part) => part.length === 0)) {
      sendError(response, 400, 'invalid_document', 'Expected workspaceId|objectClass|objectId|objectAttr.')
      return
    }
    if (parts[0] !== response.locals.agentWorkspace) {
      sendError(response, 403, 'forbidden', 'The document belongs to a different workspace.')
      return
    }
    next()
  })

  router.get('/schema', placeholder<GetAgentSchemaResponse>())
  router.get('/:docName/outline', placeholder<GetAgentOutlineResponse>())
  router.get('/:docName/find', placeholder<FindAgentNodesResponse>())
  router.get('/:docName/nodes/:ref', placeholder<ReadAgentNodeResponse>())
  router.post('/:docName/ops', placeholder<ApplyAgentOpsResponse, ApplyAgentOpsBody>())
  return router
}
