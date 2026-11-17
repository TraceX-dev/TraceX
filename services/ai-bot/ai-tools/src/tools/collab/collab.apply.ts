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
import { collabApplyToolId } from './tool-ids'
import { DocNameSchema, NodeRefSchema, HashSchema, PositionSchema, NodeJsonSchema, MarkJsonSchema } from './schema'

export const ExpectSchema = Type.Object(
  {
    hash: HashSchema
  },
  {
    additionalProperties: false,
    description:
      'Required deletion precondition: the complete subtree must match the hash read before this ' +
      'batch. Mismatch returns STALE_REFERENCE. Earlier edits in the same atomic batch do not require ' +
      'recomputing this initial hash.'
  }
)

export const InsertNodeOpSchema = Type.Object(
  {
    op: Type.Literal('insert_node', { description: 'Insert a new non-text node.' }),
    at: PositionSchema,
    node: NodeJsonSchema
  },
  {
    additionalProperties: false,
    description:
      'Insert one non-text child node with schema-valid content. Do not insert the document root or a ' +
      'standalone text node. Explicit readonly or hidden attributes are rejected recursively, ' +
      'including null values. Omitted attributes use native defaults.'
  }
)

export const UpdateAttrsOpSchema = Type.Object(
  {
    op: Type.Literal('update_attrs', { description: 'Patch attributes of an existing node.' }),
    ref: NodeRefSchema,
    attrs: Type.Record(Type.String(), Type.Unknown(), {
      minProperties: 1,
      description:
        'Patch of native attributes to set. Omitted attributes stay unchanged. Null is a value allowed ' +
        'only by nullable attributes; it does not remove the attribute. Unknown, readonly, hidden and ' +
        'disallowed attributes are rejected.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Patch attributes of an existing node while preserving its content and marks. Values are ' +
      'validated against the configured editor schema.'
  }
)

export const ReplaceTextOpSchema = Type.Object(
  {
    op: Type.Literal('replace_text', { description: 'Replace matching literal text.' }),
    ref: NodeRefSchema,
    search: Type.String({
      minLength: 1,
      description:
        'Case-sensitive literal text to find within the target subtree. Matches can cross formatting ' +
        'boundaries but not block boundaries, embedded objects or hard breaks.'
    }),
    replace: Type.String({
      description: 'Literal replacement text. An empty string deletes the matched text. Never HTML or Markdown.'
    }),
    all: Type.Optional(
      Type.Boolean({
        default: false,
        description:
          'Set true to replace every matching occurrence. Otherwise exactly one match is required; ' +
          'multiple matches return AMBIGUOUS_MATCH.'
      })
    )
  },
  {
    additionalProperties: false,
    description:
      'Replace literal text in an allowed node or its editable descendants. Ordinary formatting comes ' +
      'from the start of each match; protected anchors are inherited only when they cover the entire ' +
      'match.'
  }
)

export const DeleteNodeOpSchema = Type.Object(
  {
    op: Type.Literal('delete_node', { description: 'Delete a node and its subtree.' }),
    ref: NodeRefSchema,
    expect: ExpectSchema
  },
  {
    additionalProperties: false,
    description:
      'Delete one node and its complete subtree after checking its initial subtree hash. Deletion must ' +
      'be permitted and must leave a valid document; no filler nodes are inserted to repair invalid ' +
      'structure.'
  }
)

export const AddMarkOpSchema = Type.Object(
  {
    op: Type.Literal('add_mark', { description: 'Apply an ordinary formatting mark.' }),
    ref: NodeRefSchema,
    search: Type.String({
      minLength: 1,
      description: 'Case-sensitive literal text selector, with the same matching rules as replace_text.'
    }),
    all: Type.Optional(
      Type.Boolean({
        default: false,
        description: 'Apply to all occurrences; otherwise exactly one match is required.'
      })
    ),
    mark: MarkJsonSchema
  },
  {
    additionalProperties: false,
    description:
      'Apply an allowed ordinary mark, such as bold, italic or link, to matching text. Mark attributes ' +
      'are validated. Existing protected anchors must not be displaced, and new protected identities ' +
      'cannot be supplied.'
  }
)

export const RemoveMarkOpSchema = Type.Object(
  {
    op: Type.Literal('remove_mark', { description: 'Remove an ordinary formatting mark.' }),
    ref: NodeRefSchema,
    search: Type.String({
      minLength: 1,
      description: 'Case-sensitive literal text selector, with the same matching rules as replace_text.'
    }),
    all: Type.Optional(
      Type.Boolean({
        default: false,
        description: 'Apply to all occurrences; otherwise exactly one match is required.'
      })
    ),
    mark: Type.String({
      minLength: 1,
      description: 'Exact technical name of the ordinary mark to remove. Protected comment marks cannot be removed.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Remove one allowed ordinary mark from the matching text while preserving other marks and ' + 'protected anchors.'
  }
)

export const OpSchema = Type.Union(
  [
    InsertNodeOpSchema,
    UpdateAttrsOpSchema,
    ReplaceTextOpSchema,
    DeleteNodeOpSchema,
    AddMarkOpSchema,
    RemoveMarkOpSchema
  ],
  {
    description:
      'One supported edit operation. Moving nodes and referring to newly inserted nodes within the ' +
      'same batch are outside this contract.'
  }
)

export const OperationResultSchema = Type.Union(
  [
    Type.Object(
      {
        opIndex: Type.Integer({ minimum: 0, description: 'Zero-based operation index in the submitted batch.' }),
        ref: NodeRefSchema,
        hash: HashSchema
      },
      {
        additionalProperties: false,
        description:
          'The target survives in the final committed document. Its handle and current subtree hash are ' +
          'issued after reconciliation with the live document.'
      }
    ),
    Type.Object(
      {
        opIndex: Type.Integer({ minimum: 0, description: 'Zero-based operation index in the submitted batch.' }),
        deleted: Type.Literal(true, {
          description:
            'The target is absent in the final document, including deletion by a later operation in this ' + 'batch.'
        })
      },
      {
        additionalProperties: false,
        description: 'The target no longer exists after the complete batch commits; it has no live handle or hash.'
      }
    )
  ],
  { description: 'Final state of one operation target after the entire batch commits.' }
)

export const OperationErrorCodeSchema = Type.Union(
  [
    Type.Literal('STALE_REFERENCE', {
      description: 'The node no longer resolves or the deletion subtree hash changed. Read fresh content.'
    }),
    Type.Literal('AMBIGUOUS_REF', { description: 'The supplied handle cannot identify exactly one target.' }),
    Type.Literal('SCHEMA_INVALID', {
      description: 'The resulting document or an attribute value violates the editor schema.'
    }),
    Type.Literal('UNSUPPORTED_SCHEMA', {
      description: 'The request names an unknown node, mark, attribute or JSON property.'
    }),
    Type.Literal('POSITION_INVALID', { description: 'The insertion position is not valid for the requested node.' }),
    Type.Literal('TEXT_NOT_FOUND', { description: 'The literal selector did not match editable text in the target.' }),
    Type.Literal('AMBIGUOUS_MATCH', {
      description: 'More than one occurrence matched without all=true. Narrow the selector or opt into all matches.'
    }),
    Type.Literal('FORBIDDEN', {
      description: 'Document permissions, operation policy or protected content disallow this edit.'
    }),
    Type.Literal('INVALID_OPERATION', { description: 'The requested operation is malformed or unsupported.' }),
    Type.Literal('TOO_MANY_OPS', { description: 'The batch exceeds the operation limit.' })
  ],
  {
    description:
      'Operation error code. STALE_REFERENCE requires a fresh read; FORBIDDEN requires an allowed ' +
      'operation or document access; schema and position errors require correcting the request.'
  }
)

export const ApplyAgentOpsSuccessSchema = Type.Object(
  {
    ok: Type.Literal(true, { description: 'The entire batch committed.' }),
    results: Type.Array(OperationResultSchema, {
      description: 'One result per submitted operation, returned after the complete batch commits.'
    })
  },
  {
    additionalProperties: false,
    description:
      'Confirmed batch success. Failures use the common MCP error channel with code, message, ' +
      'retryable=false and outcome. A known rejection has outcome=not_applied and error.opIndex; ' +
      'outcome=unknown requires reading current content before deciding on another write.'
  }
)

export const AgentOpsSchema = Type.Array(OpSchema, {
  minItems: 1,
  maxItems: 100,
  description: 'One atomic batch of 1 to 100 operations on existing handles.'
})

export const CollabApplyInputSchema = Type.Object(
  {
    docName: DocNameSchema,
    ops: AgentOpsSchema
  },
  {
    additionalProperties: false,
    description:
      'Directly edit one existing collaborative document as the authenticated user, subject to ' +
      'document and operation permissions.'
  }
)

export const CollabApplyOutputSchema = ApplyAgentOpsSuccessSchema

type CollabApplyInput = Static<typeof CollabApplyInputSchema>

export const collabApplyTool = createTool({
  name: collabApplyToolId,
  title: 'Edit document content',
  description:
    'Apply 1 to 100 operations atomically to one existing collaborative document. Read the schema ' +
    'before constructing node JSON or marks. Read target content when context is needed and always ' +
    'before deletion. Explicit literal replacements and mark changes may use an unambiguous find ' +
    'result directly. Supported operations: insert_node, update_attrs, replace_text, ' +
    'delete_node, add_mark, remove_mark. Use only handles returned for this docName; there are no ' +
    'aliases or move operation. Delete requires the complete subtree hash from a read. Readonly and ' +
    'hidden attributes are rejected on update and explicit insertion. Edits apply directly, without ' +
    'a suggestion/review step. After an uncertain timeout or connection failure, do not ' +
    'automatically retry: read the document and decide whether a new batch is needed.',
  inputSchema: CollabApplyInputSchema,
  outputSchema: CollabApplyOutputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false
  },
  execute: async (args: CollabApplyInput, toolCtx: PlatformContext) => {
    try {
      const { docName, ...request } = args
      const result = await toolCtx.collaborator.applyAgentOps({ ...request, document: decodeAgentDocument(docName) })
      return result.ok ? toolOk(result) : { ok: false, error: result.error }
    } catch (error: unknown) {
      if (error instanceof CollaboratorAgentError) {
        return { ok: false, error: error.toJSON() }
      }
      throw error
    }
  }
})
