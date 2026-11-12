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
import { collabOutlineToolId } from './tool-ids'
import { DocNameSchema, NodePageSchema, PageFromSchema, PageLimitSchema } from './schema'

export const CollabOutlineInputSchema = Type.Object(
  {
    docName: DocNameSchema,
    from: PageFromSchema,
    limit: PageLimitSchema
  },
  { additionalProperties: false, description: 'Read a page of direct children of the document root.' }
)

export const CollabOutlineOutputSchema = Type.Object(
  {
    ...NodePageSchema.properties,
    typesPresent: Type.Array(Type.String(), {
      description:
        'Distinct addressable node types in the entire document, including nested nodes and other pages. Use with collab_find.type.'
    })
  },
  { additionalProperties: false, description: 'Top-level node page and node types present throughout the document.' }
)

type CollabOutlineInput = Static<typeof CollabOutlineInputSchema>

export const collabOutlineTool = createTool({
  name: collabOutlineToolId,
  description:
    'List top-level nodes of an existing collaborative document in document order, with handles, ' +
    'previews, subtree hashes and immediate child counts. typesPresent lists node types throughout the document. Use this to navigate before reading or ' +
    'editing. Paginate with from/limit; previews are abbreviated. Use collab_read for a subtree and ' +
    'collab_find to locate nested nodes. Reading does not change document content.',
  inputSchema: CollabOutlineInputSchema,
  outputSchema: CollabOutlineOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true
  },
  execute: async (args: CollabOutlineInput, toolCtx: PlatformContext) => {
    try {
      const { docName, ...request } = args
      return toolOk(await toolCtx.collaborator.getAgentOutline({ ...request, document: decodeAgentDocument(docName) }))
    } catch (error: unknown) {
      if (error instanceof CollaboratorAgentError) {
        return { ok: false, error: error.toJSON() }
      }
      throw error
    }
  }
})
