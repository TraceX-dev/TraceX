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

export interface AgentNodeJSON {
  type: string
  attrs?: Record<string, unknown>
  text?: string
  marks?: AgentMarkJSON[]
  content?: AgentNodeJSON[]
}

export interface AgentMarkJSON {
  type: string
  attrs?: Record<string, unknown>
}

export interface AgentNodePolicy {
  protectedAttrs?: readonly string[]
  editableAttrs?: readonly string[]
  insertable?: boolean
  deletable?: boolean
  textEditable?: boolean
}

export interface AgentMarkPolicy {
  editable?: boolean
}

/** Unlisted write capabilities are denied. All persisted attributes remain visible. */
export interface AgentPolicy {
  nodes: Readonly<Record<string, AgentNodePolicy | undefined>>
  marks: Readonly<Record<string, AgentMarkPolicy | undefined>>
}

/** The caller supplies a synchronous cryptographic hash, e.g. SHA-256 in the server. */
export interface AgentScope {
  document: string
  field: string
  hash: (canonicalJSON: string) => string
}

/** Live node identities for one synchronous read/prepare/commit, without awaiting or reusing after mutation. */
export interface AgentReferenceSource {
  document: string
  field: string
  refForNode: (node: object) => string
}

export interface AgentPosition {
  ref: string
  where: 'before' | 'after' | 'start' | 'end'
}

export type AgentOperation =
  | { op: 'insert_node', at: AgentPosition, node: AgentNodeJSON }
  | { op: 'update_attrs', ref: string, attrs: Record<string, unknown> }
  | { op: 'delete_node', ref: string, expectedFingerprint: string }
  | { op: 'replace_text', ref: string, search: string, all?: boolean, replace: string }
  | { op: 'add_mark', ref: string, mark: AgentMarkJSON, search: string, all?: boolean }
  | { op: 'remove_mark', ref: string, mark: string, search: string, all?: boolean }

export type AgentErrorCode =
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

export interface AgentError {
  code: AgentErrorCode
  message: string
}

export interface AgentOperationResult {
  opIndex: number
  ref?: string
  deleted?: boolean
  fingerprint?: string
}
