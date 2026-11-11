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

/// <reference types="node" />

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import type { Static } from 'typebox'
import type {
  ApplyAgentOpsRequest, ApplyAgentOpsResponse, FindAgentNodesRequest, FindAgentNodesResponse,
  GetAgentOutlineRequest, GetAgentOutlineResponse, GetAgentSchemaResponse, ReadAgentNodeRequest, ReadAgentNodeResponse
} from '@hcengineering/collaborator-client'
import type { CollabApplyInputSchema, CollabApplyOutputSchema } from '../collab.apply'
import type { CollabFindInputSchema, CollabFindOutputSchema } from '../collab.find'
import type { CollabOutlineInputSchema, CollabOutlineOutputSchema } from '../collab.outline'
import type { CollabSchemaOutputSchema } from '../collab.schema'
import type { CollabReadInputSchema, CollabReadOutputSchema } from '../collab.read'


it('validates the collab wire contracts and descriptions with real TypeBox and editor context', () => {
  const result = spawnSync(process.execPath, [join(__dirname, 'contracts-probe.mjs')], {
    encoding: 'utf8', timeout: 30000
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  const report: { checks: number } = JSON.parse(result.stdout)
  expect(report.checks).toBeGreaterThan(50)
})


// Bidirectional assignability keeps the client DTOs and MCP schemas in sync at compile time.
type Matches<L, R> = [L] extends [R] ? [R] extends [L] ? true : false : false
type Assert<T extends true> = T
export type CollabContractParity = [
  Assert<Matches<Static<typeof CollabApplyInputSchema>, ApplyAgentOpsRequest>>,
  Assert<Matches<Static<typeof CollabApplyOutputSchema>, ApplyAgentOpsResponse>>,
  Assert<Matches<Static<typeof CollabFindInputSchema>, FindAgentNodesRequest>>,
  Assert<Matches<Static<typeof CollabFindOutputSchema>, FindAgentNodesResponse>>,
  Assert<Matches<Static<typeof CollabOutlineInputSchema>, GetAgentOutlineRequest>>,
  Assert<Matches<Static<typeof CollabOutlineOutputSchema>, GetAgentOutlineResponse>>,
  Assert<Matches<Static<typeof CollabReadInputSchema>, ReadAgentNodeRequest>>,
  Assert<Matches<Static<typeof CollabReadOutputSchema>, ReadAgentNodeResponse>>,
  Assert<Matches<Static<typeof CollabSchemaOutputSchema>, GetAgentSchemaResponse>>
]
