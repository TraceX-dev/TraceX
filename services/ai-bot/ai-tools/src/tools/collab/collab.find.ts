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

import { type PlatformContext, createTool, toolOk } from '@hcengineering/ai-core'
import { CollaboratorAgentError } from '@hcengineering/collaborator-client'
import { Type, type Static } from 'typebox'
import { decodeAgentDocument } from '../shared/collaborative-document'
import { collabFindToolId } from './tool-ids'
import { DocNameSchema, NodePageSchema, PageFromSchema, PageLimitSchema } from './schema'

export const CollabFindInputSchema = Type.Object(
  {
    docName: DocNameSchema,
    text: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          'Case-sensitive literal substring of the node subtree text. Not a regular expression or a fulltext query.'
      })
    ),
    type: Type.Optional(
      Type.String({ minLength: 1, description: 'Exact technical node type name, for example heading or todoItem.' })
    ),
    from: PageFromSchema,
    limit: PageLimitSchema
  },
  {
    additionalProperties: false,
    description:
      'Find non-text nodes at any depth. Provide text, type, or both; both filters must match when ' +
      'supplied together.'
  }
)

export const CollabFindOutputSchema = NodePageSchema

type CollabFindInput = Static<typeof CollabFindInputSchema>

export const collabFindTool = createTool({
  name: collabFindToolId,
  title: 'Find document content',
  description:
    'Find addressable nodes, including nested nodes, inside one existing collaborative document by ' +
    'literal text and/or exact node type. Filters are combined with AND. Results are paginated in ' +
    'document order, with handles, previews and subtree hashes. Ancestors and descendants may both ' +
    'match. For an explicit literal replacement or mark change in an unambiguous target, use find then apply directly. ' +
    'Read the full node when context is needed and before deleting it. This searches live document content, not the ' +
    'workspace fulltext index.',
  inputSchema: CollabFindInputSchema,
  outputSchema: CollabFindOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true
  },
  execute: async (args: CollabFindInput, toolCtx: PlatformContext) => {
    try {
      const { docName, ...request } = args
      return toolOk(await toolCtx.collaborator.findAgentNodes({ ...request, document: decodeAgentDocument(docName) }))
    } catch (error: unknown) {
      if (error instanceof CollaboratorAgentError) {
        return { ok: false, error: error.toJSON() }
      }
      throw error
    }
  }
})
