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

import type { Static } from 'typebox'
import type {
  ApplyAgentOpsRequest,
  ApplyAgentOpsResponse,
  FindAgentNodesRequest,
  FindAgentNodesResponse,
  GetAgentSchemaRequest,
  GetAgentOutlineRequest,
  GetAgentOutlineResponse,
  GetAgentSchemaResponse,
  ReadAgentNodeRequest,
  ReadAgentNodeResponse
} from '@hcengineering/collaborator-client'
import type { CollabApplyInputSchema, CollabApplyOutputSchema } from '../collab.apply'
import type { CollabFindInputSchema, CollabFindOutputSchema } from '../collab.find'
import type { CollabOutlineInputSchema, CollabOutlineOutputSchema } from '../collab.outline'
import type { CollabSchemaInputSchema, CollabSchemaOutputSchema } from '../collab.schema'
import type { CollabReadInputSchema, CollabReadOutputSchema } from '../collab.read'

// Bidirectional assignability keeps the client DTOs and MCP schemas in sync at compile time.
type Matches<L, R> = [L] extends [R] ? ([R] extends [L] ? true : false) : false
type Assert<T extends true> = T
type McpRequest<T> = Omit<T, 'document'> & { docName: string }
export type CollabContractParity = [
  Assert<Matches<Static<typeof CollabSchemaInputSchema>, GetAgentSchemaRequest>>,
  Assert<Matches<Static<typeof CollabApplyInputSchema>, McpRequest<ApplyAgentOpsRequest>>>,
  Assert<Matches<Static<typeof CollabApplyOutputSchema>, Extract<ApplyAgentOpsResponse, { ok: true }>>>,
  Assert<Matches<Static<typeof CollabFindInputSchema>, McpRequest<FindAgentNodesRequest>>>,
  Assert<Matches<Static<typeof CollabFindOutputSchema>, FindAgentNodesResponse>>,
  Assert<Matches<Static<typeof CollabOutlineInputSchema>, McpRequest<GetAgentOutlineRequest>>>,
  Assert<Matches<Static<typeof CollabOutlineOutputSchema>, GetAgentOutlineResponse>>,
  Assert<Matches<Static<typeof CollabReadInputSchema>, McpRequest<ReadAgentNodeRequest>>>,
  Assert<Matches<Static<typeof CollabReadOutputSchema>, ReadAgentNodeResponse>>,
  Assert<Matches<Static<typeof CollabSchemaOutputSchema>, GetAgentSchemaResponse>>
]
