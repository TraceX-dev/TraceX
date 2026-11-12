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

import type { CollaborativeDoc } from '@hcengineering/core'

/** REST prefix shared by the collaborator service and its client. */
export const AGENT_API_PATH = '/api/v1/agent'

/** ProseMirror JSON on the wire; native schema validation is performed by the collaborator. */
export interface AgentMarkJSON {
  type: string
  attrs?: Record<string, unknown>
}

export interface AgentNodeJSON {
  type: string
  attrs?: Record<string, unknown>
  text?: string
  marks?: AgentMarkJSON[]
  content?: AgentNodeJSON[]
}

export interface AgentAttributeDefinition {
  name: string
  description?: string
  type: string | string[]
  required: boolean
  nullable: boolean
  default?: unknown
  enum?: string[]
  access?: 'readwrite' | 'readonly'
  hidden?: boolean
}

export interface AgentNodeDefinition {
  name: string
  label?: string
  description?: string
  type: 'node'
  attributes: Record<string, AgentAttributeDefinition>
  content: string
  allowedChildren: string[]
  group?: string
  inline: boolean
  marks: string[]
  example?: AgentNodeJSON
}

export interface AgentMarkDefinition {
  name: string
  label?: string
  description?: string
  type: 'mark'
  attributes: Record<string, AgentAttributeDefinition>
  group?: string
  excludes: string[]
}

/** Omitted filters return the full model; supplied filters select only the named definitions. */
export interface GetAgentSchemaRequest {
  nodes?: string[]
  marks?: string[]
}

export interface GetAgentSchemaResponse {
  topNode: string
  nodes: Record<string, AgentNodeDefinition>
  marks: Record<string, AgentMarkDefinition>
}

export interface AgentDocumentRequest {
  /** One collaborative field; the client supplies its authenticated workspace. */
  document: CollaborativeDoc
}

export interface AgentPageRequest extends AgentDocumentRequest {
  from?: number
  limit?: number
}

export type GetAgentOutlineRequest = AgentPageRequest

/** At least one of text/type is required by the server. Both filters are combined with AND. */
export interface FindAgentNodesRequest extends AgentPageRequest {
  text?: string
  type?: string
}

export interface AgentNodeSummary {
  ref: string
  type: string
  preview: string
  hash: string
  childCount: number
}

export interface AgentNodePage {
  total: number
  from: number
  rows: AgentNodeSummary[]
}

export interface GetAgentOutlineResponse extends AgentNodePage {
  /** Addressable node types present in the entire document, including nested nodes and other pages. */
  typesPresent: string[]
}
export type FindAgentNodesResponse = AgentNodePage

export interface ReadAgentNodeRequest extends AgentDocumentRequest {
  ref: string
}

export interface ReadAgentNodeResponse {
  ref: string
  hash: string
  node: AgentNodeJSON
  children: AgentNodeSummary[]
}

export interface AgentPosition {
  ref: string
  where: 'before' | 'after' | 'start' | 'end'
}

export type AgentOperation =
  | { op: 'insert_node', at: AgentPosition, node: AgentNodeJSON }
  | { op: 'update_attrs', ref: string, attrs: Record<string, unknown> }
  | { op: 'replace_text', ref: string, search: string, replace: string, all?: boolean }
  | { op: 'delete_node', ref: string, expect: { hash: string } }
  | { op: 'add_mark', ref: string, search: string, mark: AgentMarkJSON, all?: boolean }
  | { op: 'remove_mark', ref: string, search: string, mark: string, all?: boolean }

export interface ApplyAgentOpsRequest extends AgentDocumentRequest {
  ops: AgentOperation[]
}

/** The REST document name is in the route, not duplicated in the request body. */
export interface ApplyAgentOpsBody {
  ops: AgentOperation[]
}

export type AgentOperationResult = { opIndex: number, ref: string, hash: string } | { opIndex: number, deleted: true }

export type AgentOperationErrorCode =
  | 'STALE_REFERENCE'
  | 'AMBIGUOUS_REF'
  | 'SCHEMA_INVALID'
  | 'UNSUPPORTED_SCHEMA'
  | 'POSITION_INVALID'
  | 'TEXT_NOT_FOUND'
  | 'AMBIGUOUS_MATCH'
  | 'FORBIDDEN'
  | 'INVALID_OPERATION'
  | 'TOO_MANY_OPS'

/** A common API error payload; unknown means the caller must read before another write. */
export interface AgentError {
  code: string
  message: string
  retryable: false
  outcome: 'not_applied' | 'unknown'
  opIndex?: number
}

export interface AgentOperationError extends AgentError {
  code: AgentOperationErrorCode
  outcome: 'not_applied'
  opIndex: number
}

export type ApplyAgentOpsResponse =
  { ok: true, results: AgentOperationResult[] } | { ok: false, error: AgentOperationError }

/** Transport/service errors are separate from a known atomic batch rejection. */
export interface AgentApiErrorResponse {
  error: AgentError
}

/** Typed agent REST API. Calls are single attempts, without automatic write retries. */
export interface CollaboratorAgentClient {
  /** Read the shared editor configuration without loading document content. */
  getAgentSchema: (request?: GetAgentSchemaRequest) => Promise<GetAgentSchemaResponse>
  /** Page through direct children of the document root. */
  getAgentOutline: (request: GetAgentOutlineRequest) => Promise<GetAgentOutlineResponse>
  /** Find non-text nodes at any depth using text/type filters. */
  findAgentNodes: (request: FindAgentNodesRequest) => Promise<FindAgentNodesResponse>
  /** Read a complete node subtree by its live handle. */
  readAgentNode: (request: ReadAgentNodeRequest) => Promise<ReadAgentNodeResponse>
  /** Apply one atomic batch; a transport failure may leave the outcome uncertain. */
  applyAgentOps: (request: ApplyAgentOpsRequest) => Promise<ApplyAgentOpsResponse>
}
