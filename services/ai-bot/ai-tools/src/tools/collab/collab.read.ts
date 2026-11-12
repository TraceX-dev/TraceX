//
// Copyright © 2026 TraceX.
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

import { type PlatformContext, createTool, toolOk } from '@hcengineering/ai-core'
import { CollaboratorAgentError } from '@hcengineering/collaborator-client'
import { Type, type Static } from 'typebox'
import { decodeAgentDocument } from '../shared/collaborative-document'
import { collabReadToolId } from './tool-ids'
import { DocNameSchema, NodeRefSchema, HashSchema, NodeJsonSchema, NodeSummarySchema } from './schema'

export const CollabReadInputSchema = Type.Object(
  {
    docName: DocNameSchema,
    ref: NodeRefSchema
  },
  { additionalProperties: false, description: 'Read one addressable non-text node and its complete subtree.' }
)

export const CollabReadOutputSchema = Type.Object(
  {
    ref: NodeRefSchema,
    hash: HashSchema,
    node: NodeJsonSchema,
    children: Type.Array(NodeSummarySchema, {
      description:
        'Immediate non-text children with handles for further navigation. Text children remain in ' +
        'node.content and have no handles.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Complete native node JSON and its current subtree fingerprint, plus handles for direct non-text ' + 'children.'
  }
)

type CollabReadInput = Static<typeof CollabReadInputSchema>

export const collabReadTool = createTool({
  name: collabReadToolId,
  title: 'Read document node',
  description:
    'Read the complete ProseMirror JSON subtree of one node by a handle obtained from ' +
    'collab_outline, collab_find or an earlier read. Returns its subtree hash and handles for direct ' +
    'non-text children. Preserve existing embedded objects and protected marks when planning edits. ' +
    'Use the returned hash as the required deletion precondition. Reading does not assign IDs or ' +
    'change document content.',
  inputSchema: CollabReadInputSchema,
  outputSchema: CollabReadOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true
  },
  execute: async (args: CollabReadInput, toolCtx: PlatformContext) => {
    try {
      const { docName, ...request } = args
      return toolOk(await toolCtx.collaborator.readAgentNode({ ...request, document: decodeAgentDocument(docName) }))
    } catch (error: unknown) {
      if (error instanceof CollaboratorAgentError) {
        return { ok: false, error: error.toJSON() }
      }
      throw error
    }
  }
})
