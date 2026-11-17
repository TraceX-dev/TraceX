//
// Copyright © 2026 TraceX.
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
import type * as Api from '@hcengineering/collaborator-client'
import type * as Schemas from '../schema'

type Matches<L, R> = [L] extends [R] ? ([R] extends [L] ? true : false) : false
type Assert<T extends true> = T

/** Bidirectional contract checks run as part of native TypeScript validation. */
export type AgentApiSchemaParity = [
  Assert<Matches<Static<typeof Schemas.NodeJsonSchema>, Api.AgentNodeJSON>>,
  Assert<Matches<Static<typeof Schemas.MarkJsonSchema>, Api.AgentMarkJSON>>,
  Assert<Matches<Static<typeof Schemas.OpSchema>, Api.AgentOperation>>,
  Assert<Matches<Static<typeof Schemas.GetAgentSchemaRequestSchema>, Api.GetAgentSchemaRequest>>,
  Assert<Matches<Static<typeof Schemas.GetAgentSchemaResponseSchema>, Api.GetAgentSchemaResponse>>,
  Assert<Matches<Static<typeof Schemas.GetAgentOutlineRequestSchema>, Api.GetAgentOutlineRequest>>,
  Assert<Matches<Static<typeof Schemas.GetAgentOutlineResponseSchema>, Api.GetAgentOutlineResponse>>,
  Assert<Matches<Static<typeof Schemas.FindAgentNodesRequestSchema>, Api.FindAgentNodesRequest>>,
  Assert<Matches<Static<typeof Schemas.FindAgentNodesResponseSchema>, Api.FindAgentNodesResponse>>,
  Assert<Matches<Static<typeof Schemas.ReadAgentNodeRequestSchema>, Api.ReadAgentNodeRequest>>,
  Assert<Matches<Static<typeof Schemas.ReadAgentNodeResponseSchema>, Api.ReadAgentNodeResponse>>,
  Assert<Matches<Static<typeof Schemas.ApplyAgentOpsBodySchema>, Api.ApplyAgentOpsBody>>,
  Assert<Matches<Static<typeof Schemas.ApplyAgentOpsRequestSchema>, Api.ApplyAgentOpsRequest>>,
  Assert<Matches<Static<typeof Schemas.ApplyAgentOpsResponseSchema>, Api.ApplyAgentOpsResponse>>,
  Assert<Matches<Static<typeof Schemas.AgentApiErrorResponseSchema>, Api.AgentApiErrorResponse>>
]
