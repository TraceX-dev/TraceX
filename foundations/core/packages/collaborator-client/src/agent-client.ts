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

import { concatLink } from '@hcengineering/core'
import { AGENT_API_PATH } from './agent'
import type {
  AgentApiErrorResponse,
  ApplyAgentOpsBody,
  ApplyAgentOpsRequest,
  ApplyAgentOpsResponse,
  CollaboratorAgentClient,
  FindAgentNodesRequest,
  FindAgentNodesResponse,
  GetAgentOutlineRequest,
  GetAgentOutlineResponse,
  GetAgentSchemaResponse,
  ReadAgentNodeRequest,
  ReadAgentNodeResponse
} from './agent'

/** A failed request is never automatically retried, especially when a write outcome is uncertain. */
export class CollaboratorAgentError extends Error {
  readonly retryable = false

  constructor (readonly code: string, message: string, readonly status?: number) {
    super(message)
    this.name = 'CollaboratorAgentError'
  }
}

function isApiError (value: unknown): value is AgentApiErrorResponse {
  if (value === null || typeof value !== 'object' || !('error' in value)) return false
  const error = value.error
  return (
    error !== null && typeof error === 'object' &&
    'code' in error && typeof error.code === 'string' &&
    'message' in error && typeof error.message === 'string'
  )
}

/** HTTP implementation shared by the existing collaborator client. */
export class AgentClient implements CollaboratorAgentClient {
  constructor (
    private readonly agentWorkspace: string,
    private readonly agentToken: string,
    private readonly agentUrl: string
  ) {}

  private documentPath (docName: string): string {
    const parts = docName.split('|')
    if (parts.length !== 4 || parts.some((part) => part.length === 0)) {
      throw new CollaboratorAgentError('invalid_document', 'Expected workspaceId|objectClass|objectId|objectAttr.', 400)
    }
    if (parts[0] !== this.agentWorkspace) {
      throw new CollaboratorAgentError('forbidden', 'The document belongs to a different workspace.', 403)
    }
    return `${AGENT_API_PATH}/${encodeURIComponent(docName)}`
  }

  private async request<T> (method: 'GET' | 'POST', path: string, body?: ApplyAgentOpsBody): Promise<T> {
    let response: Response
    try {
      response = await fetch(concatLink(this.agentUrl, path), {
        method,
        headers: {
          Authorization: `Bearer ${this.agentToken}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    } catch {
      throw new CollaboratorAgentError(
        'collaborator_unavailable',
        method === 'POST'
          ? 'Collaborator request failed; the write outcome may be unknown. Read the document before another write.'
          : 'Collaborator request failed.'
      )
    }
    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new CollaboratorAgentError(
        'invalid_response',
        method === 'POST'
          ? 'Invalid collaborator response; the write outcome may be unknown. Read the document before another write.'
          : 'Invalid collaborator response.',
        response.status
      )
    }
    if (!response.ok) {
      if (isApiError(data)) throw new CollaboratorAgentError(data.error.code, data.error.message, response.status)
      throw new CollaboratorAgentError(
        'collaborator_http_error', `Collaborator returned HTTP ${response.status}.`, response.status
      )
    }
    return data as T
  }

  private query (values: Record<string, string | number | undefined>): string {
    const query = new URLSearchParams()
    for (const [name, value] of Object.entries(values)) {
      if (value !== undefined) query.set(name, String(value))
    }
    const encoded = query.toString()
    return encoded === '' ? '' : `?${encoded}`
  }

  async getAgentSchema (): Promise<GetAgentSchemaResponse> {
    return await this.request('GET', `${AGENT_API_PATH}/schema`)
  }

  async getAgentOutline (request: GetAgentOutlineRequest): Promise<GetAgentOutlineResponse> {
    const query = this.query({ from: request.from, limit: request.limit })
    return await this.request('GET', `${this.documentPath(request.docName)}/outline${query}`)
  }

  async findAgentNodes (request: FindAgentNodesRequest): Promise<FindAgentNodesResponse> {
    const query = this.query({ text: request.text, type: request.type, from: request.from, limit: request.limit })
    return await this.request('GET', `${this.documentPath(request.docName)}/find${query}`)
  }

  async readAgentNode (request: ReadAgentNodeRequest): Promise<ReadAgentNodeResponse> {
    return await this.request('GET', `${this.documentPath(request.docName)}/nodes/${encodeURIComponent(request.ref)}`)
  }

  async applyAgentOps (request: ApplyAgentOpsRequest): Promise<ApplyAgentOpsResponse> {
    const body: ApplyAgentOpsBody = { ops: request.ops }
    return await this.request('POST', `${this.documentPath(request.docName)}/ops`, body)
  }
}
