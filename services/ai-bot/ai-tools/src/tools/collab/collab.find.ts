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

import { type PlatformContext, createTool, toolFail } from '@hcengineering/ai-core'
import { Type, type Static } from 'typebox'
import { collabFindToolId } from './tool-ids'
import { DocNameSchema, NodePageSchema, PageFromSchema, PageLimitSchema } from './schema'

export const CollabFindInputSchema = Type.Object(
  {
    docName: DocNameSchema,
    text: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          'Case-sensitive literal substring of the node subtree text. Not a regular expression or a ' +
          'fulltext query.'
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
    anyOf: [{ required: ['text'] }, { required: ['type'] }],
    description:
      'Find non-text nodes at any depth. Provide text, type, or both; both filters must match when ' +
      'supplied together.'
  }
)

export const CollabFindOutputSchema = NodePageSchema

type CollabFindInput = Static<typeof CollabFindInputSchema>

export const collabFindTool = createTool({
  name: collabFindToolId,
  description:
    'Find addressable nodes, including nested nodes, inside one existing collaborative document by ' +
    'literal text and/or exact node type. Filters are combined with AND. Results are paginated in ' +
    'document order, with handles, previews and subtree hashes. Ancestors and descendants may both ' +
    'match. Use collab.read on a result before editing. This searches live document content, not the ' +
    'workspace fulltext index.',
  inputSchema: CollabFindInputSchema,
  outputSchema: CollabFindOutputSchema,
  execute: async (_args: CollabFindInput, _toolCtx: PlatformContext) => {
    return toolFail('Collaborative document tools are not connected to the collaborator yet.', 'not_implemented', {
      retryable: false
    })
  }
})
