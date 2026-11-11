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
import { collabSchemaToolId } from './tool-ids'
import { MarkDefinitionSchema, NodeDefinitionSchema } from './schema'

export const CollabSchemaInputSchema = Type.Object(
  {},
  {
    additionalProperties: false,
    description:
      'Read the shared editor schema used by the collaborative-document tools. No document content is ' + 'read.'
  }
)

export const CollabSchemaOutputSchema = Type.Object(
  {
    topNode: Type.String({ description: 'Technical name of the native document root type.' }),
    nodes: Type.Record(Type.String(), NodeDefinitionSchema, {
      description: 'All configured node types, including the root and text types, keyed by technical name.'
    }),
    marks: Type.Record(Type.String(), MarkDefinitionSchema, {
      description: 'All configured mark types, keyed by technical name.'
    })
  },
  {
    additionalProperties: false,
    description: 'Serializable editor context produced by Awareness for the shared editor configuration.'
  }
)

type CollabSchemaInput = Static<typeof CollabSchemaInputSchema>

export const collabSchemaTool = createTool({
  name: collabSchemaToolId,
  description:
    'Describe the shared collaborative editor schema: node and mark types, native attribute ' +
    'constraints, access rules, allowed content and custom-node examples. Call before constructing ' +
    'node JSON or changing attributes or marks. Use technical type names; labels are for display. ' +
    'This describes the model, not document content or authorization.',
  inputSchema: CollabSchemaInputSchema,
  outputSchema: CollabSchemaOutputSchema,
  execute: async (_args: CollabSchemaInput, _toolCtx: PlatformContext) => {
    return toolFail('Collaborative document tools are not connected to the collaborator yet.', 'not_implemented', {
      retryable: false
    })
  }
})
