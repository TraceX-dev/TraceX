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

import { concatLink, type CollaborativeDoc } from '@hcengineering/core'
import { encodeDocumentId } from './utils'
import { AGENT_API_PATH } from './agent'
import type {
  AgentApiErrorResponse,
  AgentError,
  ApplyAgentOpsBody,
  ApplyAgentOpsRequest,
  ApplyAgentOpsResponse,
  CollaboratorAgentClient,
  FindAgentNodesRequest,
  FindAgentNodesResponse,
  GetAgentOutlineRequest,
  GetAgentOutlineResponse,
  GetAgentSchemaRequest,
  GetAgentSchemaResponse,
  ReadAgentNodeRequest,
  ReadAgentNodeResponse
} from './agent'

/** A failed request is never automatically retried, especially when a write outcome is uncertain. */
export class CollaboratorAgentError extends Error {
  readonly retryable = false

  constructor (
    readonly code: string,
    message: string,
    readonly status?: number,
    readonly outcome: AgentError['outcome'] = 'not_applied'
  ) {
    super(message)
    this.name = 'CollaboratorAgentError'
  }

  /** Serialize the same error fields as a rejected atomic batch. */
  toJSON (): AgentError {
    return { code: this.code, message: this.message, retryable: false, outcome: this.outcome }
  }
}

function isApiError (value: unknown): value is AgentApiErrorResponse {
  if (value === null || typeof value !== 'object' || !('error' in value)) return false
  const error = value.error
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string' &&
    'outcome' in error &&
    (error.outcome === 'not_applied' || error.outcome === 'unknown')
  )
}

/** HTTP implementation shared by the existing collaborator client. */
export class AgentClient implements CollaboratorAgentClient {
  constructor (
    private readonly agentWorkspace: string,
    private readonly agentToken: string,
    private readonly agentUrl: string
  ) {}

  private documentPath (document: CollaborativeDoc): string {
    if (
      [document.objectClass, document.objectId, document.objectAttr].some(
        (part) => part.length === 0 || part.includes('|')
      )
    ) {
      throw new CollaboratorAgentError('invalid_document', 'Expected a collaborative object and field.', 400)
    }
    return `${AGENT_API_PATH}/${encodeURIComponent(encodeDocumentId(this.agentWorkspace, document))}`
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: ApplyAgentOpsBody): Promise<T> {
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
          : 'Collaborator request failed.',
        undefined,
        method === 'POST' ? 'unknown' : 'not_applied'
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
        response.status,
        method === 'POST' ? 'unknown' : 'not_applied'
      )
    }
    if (!response.ok) {
      if (isApiError(data)) {
        throw new CollaboratorAgentError(data.error.code, data.error.message, response.status, data.error.outcome)
      }
      throw new CollaboratorAgentError(
        'collaborator_http_error',
        `Collaborator returned HTTP ${response.status}.`,
        response.status,
        method === 'POST' ? 'unknown' : 'not_applied'
      )
    }
    return data as T
  }

  private query (values: Record<string, string | number | string[] | undefined>): string {
    const query = new URLSearchParams()
    for (const [name, value] of Object.entries(values)) {
      if (value !== undefined) query.set(name, Array.isArray(value) ? JSON.stringify(value) : String(value))
    }
    const encoded = query.toString()
    return encoded === '' ? '' : `?${encoded}`
  }

  async getAgentSchema (request: GetAgentSchemaRequest = {}): Promise<GetAgentSchemaResponse> {
    const query = this.query({ nodes: request.nodes, marks: request.marks })
    return await this.request('GET', `${AGENT_API_PATH}/schema${query}`)
  }

  async getAgentOutline (request: GetAgentOutlineRequest): Promise<GetAgentOutlineResponse> {
    const query = this.query({ from: request.from, limit: request.limit })
    return await this.request('GET', `${this.documentPath(request.document)}/outline${query}`)
  }

  async findAgentNodes (request: FindAgentNodesRequest): Promise<FindAgentNodesResponse> {
    const query = this.query({ text: request.text, type: request.type, from: request.from, limit: request.limit })
    return await this.request('GET', `${this.documentPath(request.document)}/find${query}`)
  }

  async readAgentNode (request: ReadAgentNodeRequest): Promise<ReadAgentNodeResponse> {
    return await this.request('GET', `${this.documentPath(request.document)}/nodes/${encodeURIComponent(request.ref)}`)
  }

  async applyAgentOps (request: ApplyAgentOpsRequest): Promise<ApplyAgentOpsResponse> {
    const body: ApplyAgentOpsBody = { ops: request.ops }
    return await this.request('POST', `${this.documentPath(request.document)}/ops`, body)
  }
}
