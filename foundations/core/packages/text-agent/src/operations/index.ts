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

export type {
  AgentNodeJSON,
  AgentMarkJSON,
  AgentNodePolicy,
  AgentMarkPolicy,
  AgentPolicy,
  AgentScope,
  AgentReferenceSource,
  AgentPosition,
  AgentOperation,
  AgentErrorCode,
  AgentError,
  AgentOperationResult
} from './types'
export type { AgentNodeEntry, AgentIndex, AgentTarget } from './references'
export type { AgentPreparedSuccess, AgentPreparedFailure, AgentPreparedBatch, AgentPreparedTarget } from './operations'
export { canonicalAgentJSON, fingerprintAgentNode, indexAgentDocument, resolveAgentTarget } from './references'
export { AgentOperationFailure, parseAgentNode } from './schema'
export { getAgentSchemaCatalog } from './catalog'
export { findAgentText } from './text'
export { prepareAgentOperations, finalizeAgentOperations } from './operations'
export { createYjsReferences } from './yjs-references'
