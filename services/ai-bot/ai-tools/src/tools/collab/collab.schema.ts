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
import { ServerKit } from '@hcengineering/text'
import { Awareness, getAgentSchemaCatalog } from '@hcengineering/text-agent'
import { Type, type Static } from 'typebox'
import { collabSchemaToolId } from './tool-ids'
import { MarkDefinitionSchema, NodeDefinitionSchema } from './schema'

export const CollabSchemaInputSchema = Type.Object(
  {
    nodes: Type.Optional(
      Type.Array(Type.String({ minLength: 1, description: 'Technical node type name.' }), {
        description:
          'Node definitions to return. When any filter is supplied, an omitted or empty nodes filter ' +
          'selects no nodes. Dependencies are not expanded. Unknown names are rejected.'
      })
    ),
    marks: Type.Optional(
      Type.Array(Type.String({ minLength: 1, description: 'Technical mark type name.' }), {
        description:
          'Mark definitions to return. When any filter is supplied, an omitted or empty marks filter ' +
          'selects no marks. Dependencies are not expanded. Unknown names are rejected.'
      })
    )
  },
  {
    additionalProperties: false,
    description:
      'Read the shared editor schema without reading document content. Omit filters for the full ' +
      'model; supplied filters select only named definitions, without expanding dependencies.'
  }
)

export const CollabSchemaOutputSchema = Type.Object(
  {
    topNode: Type.String({ description: 'Technical name of the native document root type.' }),
    nodes: Type.Record(Type.String(), NodeDefinitionSchema, {
      description: 'Selected node definitions keyed by technical name; the complete set when no filters are supplied.'
    }),
    marks: Type.Record(Type.String(), MarkDefinitionSchema, {
      description: 'Selected mark definitions keyed by technical name; the complete set when no filters are supplied.'
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
  title: 'Describe document schema',
  description:
    'Describe the shared collaborative editor schema: node and mark types, native attribute ' +
    'constraints, access rules, allowed content and JSON examples. Use the catalog below to discover ' +
    'technical type names without an extra call. This describes the model, not document content or authorization.\n' +
    getAgentSchemaCatalog(new Awareness([ServerKit])) +
    '\n' +
    'Details and JSON examples: collab_schema({nodes:[...], marks:[...]}). Request only the types you need.',
  inputSchema: CollabSchemaInputSchema,
  outputSchema: CollabSchemaOutputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true
  },
  execute: async (args: CollabSchemaInput, toolCtx: PlatformContext) => {
    try {
      return toolOk(await toolCtx.collaborator.getAgentSchema(args))
    } catch (error: unknown) {
      if (error instanceof CollaboratorAgentError) {
        return { ok: false, error: error.toJSON() }
      }
      throw error
    }
  }
})
