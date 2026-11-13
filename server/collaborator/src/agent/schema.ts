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

import type { CollaborativeDoc } from '@hcengineering/core'
import { Type } from 'typebox'

const HANDLE_PATTERN = '[0-9a-z]+\\.[0-9a-z]+'

export const NodeRefSchema = Type.String({
  pattern: `^${HANDLE_PATTERN}$`,
  description: 'Opaque handle of a non-text node in one collaborative field. Deleted handles cannot be reused.'
})

export const HashSchema = Type.String({
  minLength: 1,
  description:
    'Opaque fingerprint of the complete node subtree, including attributes, marks and embedded ' +
    'nodes. Copy it from a read result; do not calculate it from the visible text. A hash is a ' +
    'deletion precondition, not a node address.'
})

export const MarkJsonSchema = Type.Object(
  {
    type: Type.String({ minLength: 1, description: 'Technical mark type name in the configured editor schema.' }),
    attrs: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description: 'Native mark attributes. Values must satisfy the editor schema and access rules.'
      })
    )
  },
  { additionalProperties: false, description: 'One ProseMirror formatting mark or existing anchor.' }
)

export const NodeJsonSchema = Type.Cyclic(
  {
    AgentNode: Type.Object(
      {
        type: Type.String({
          minLength: 1,
          description: 'Technical node type name, including text for a text child.'
        }),
        attrs: Type.Optional(
          Type.Record(Type.String(), Type.Unknown(), {
            description:
              'Native node attributes. Supply only known, writable attributes when inserting a node; omit ' +
              'readonly and hidden attributes.'
          })
        ),
        text: Type.Optional(
          Type.String({
            minLength: 1,
            description: 'Literal text for a node whose type is "text". Never HTML or Markdown.'
          })
        ),
        marks: Type.Optional(
          Type.Array(MarkJsonSchema, { description: 'Marks applied to this node, subject to the editor schema.' })
        ),
        content: Type.Optional(
          Type.Array(Type.Ref('AgentNode'), {
            description: 'Ordered child nodes. Nesting and text-node structure are validated against the editor schema.'
          })
        )
      },
      {
        additionalProperties: false,
        description: 'One native node, including text, attributes, marks and ordered children.'
      }
    )
  },
  'AgentNode',
  {
    description: 'Recursive ProseMirror node JSON. Attributes, marks and content must satisfy the editor schema.'
  }
)

export const PositionSchema = Type.Object(
  {
    ref: Type.Union(
      [NodeRefSchema, Type.Literal('root', { description: 'The document root; use only start/end positions.' })],
      {
        description: 'Existing node handle, or "root" for the document root. The root supports only start/end.'
      }
    ),
    where: Type.Union(
      [
        Type.Literal('before', { description: 'Insert as the preceding sibling.' }),
        Type.Literal('after', { description: 'Insert as the following sibling.' }),
        Type.Literal('start', { description: 'Insert as the first child.' }),
        Type.Literal('end', { description: 'Insert as the last child.' })
      ],
      {
        description:
          'before/after insert next to the target. start/end insert as the first/last child of the target. ' +
          'Leaf and atom nodes cannot contain inserted children.'
      }
    )
  },
  {
    additionalProperties: false,
    description: 'Insertion position. Content must fit exactly without wrapping or moving it to repair invalid nesting.'
  }
)

export const NodeSummarySchema = Type.Object(
  {
    ref: NodeRefSchema,
    type: Type.String({ minLength: 1, description: 'Technical node type name.' }),
    preview: Type.String({
      description: 'Short plain-text preview. It may omit content and does not replace the complete node JSON.'
    }),
    hash: HashSchema,
    childCount: Type.Integer({
      minimum: 0,
      description:
        'Number of immediate ProseMirror children, including text children; not the number of all ' + 'descendants.'
    })
  },
  { additionalProperties: false, description: 'Compact summary of one addressable non-text node.' }
)

export const PageFromSchema = Type.Optional(
  Type.Integer({
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    default: 0,
    description:
      'Zero-based index of the first result in the current document snapshot. Pages can shift during ' +
      'concurrent editing.'
  })
)

export const PageLimitSchema = Type.Optional(
  Type.Integer({
    minimum: 1,
    maximum: 200,
    default: 50,
    description: 'Maximum number of results to return. Defaults to 50, up to 200.'
  })
)

export const NodePageSchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0, description: 'Total number of matching nodes before pagination.' }),
    from: Type.Integer({ minimum: 0, description: 'Requested zero-based starting index.' }),
    rows: Type.Array(NodeSummarySchema, {
      description: 'Result page in document order. Read another page while from + rows.length is less than total.'
    })
  },
  { additionalProperties: false, description: 'A page of node summaries from one document snapshot.' }
)

export const AttributeDefinitionSchema = Type.Object(
  {
    name: Type.String({ description: 'Technical attribute name.' }),
    description: Type.Optional(Type.String({ description: 'Meaning and usage of this attribute.' })),
    type: Type.Union([Type.String({ minLength: 1 }), Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })], {
      description:
        'Native value type, an array of alternative types, or unknown when it cannot be inferred. ' +
        'Nullability is separate.'
    }),
    required: Type.Boolean({ description: 'Whether the native attribute has no default and must be supplied.' }),
    nullable: Type.Boolean({ description: 'Whether null is allowed by the described native constraint.' }),
    default: Type.Optional(
      Type.Unknown({ description: 'Native default, when defined. Omitting an attribute uses its default.' })
    ),
    enum: Type.Optional(
      Type.Array(Type.String(), {
        description: 'Allowed string values from the native enum validator, when available.'
      })
    ),
    access: Type.Optional(
      Type.Union(
        [
          Type.Literal('readwrite', { description: 'Writable when the document and operation policy also allow it.' }),
          Type.Literal('readonly', { description: 'Cannot be changed or explicitly supplied by the agent.' })
        ],
        {
          description:
            'Agent attribute access. Readonly cannot be explicitly supplied on insertion or changed with ' +
            'update_attrs. Readwrite does not override document or operation permissions.'
        }
      )
    ),
    hidden: Type.Optional(
      Type.Boolean({
        description: 'Internal attribute. Hidden attributes cannot be explicitly supplied or changed by the agent.'
      })
    )
  },
  {
    additionalProperties: false,
    description: 'Native attribute constraints combined with extension-owned descriptions and access rules.'
  }
)

export const NodeDefinitionSchema = Type.Object(
  {
    name: Type.String({ description: 'Technical node type name, also used as its map key.' }),
    label: Type.Optional(Type.String({ description: 'Human-readable node label.' })),
    description: Type.Optional(Type.String({ description: 'Semantic purpose and usage hints.' })),
    type: Type.Literal('node', { description: 'This definition describes a node type.' }),
    attributes: Type.Record(Type.String(), AttributeDefinitionSchema, {
      description: 'Actual attributes of the configured node type, keyed by technical name.'
    }),
    content: Type.String({
      description:
        'Native ProseMirror content expression. It defines child order and cardinality; an empty ' +
        'expression means no children.'
    }),
    allowedChildren: Type.Array(Type.String(), {
      description:
        'Possible direct child type names. This list does not replace content ordering and cardinality ' +
        'constraints.'
    }),
    group: Type.Optional(Type.String({ description: 'Space-separated native content groups.' })),
    inline: Type.Boolean({ description: 'Whether this is an inline node.' }),
    marks: Type.Array(Type.String(), { description: 'Mark types allowed by this node type.' }),
    example: Type.Optional(NodeJsonSchema)
  },
  {
    additionalProperties: false,
    description:
      'One configured native node type. Presence in the schema does not itself grant insertion, ' +
      'deletion or editing permission.'
  }
)

export const MarkDefinitionSchema = Type.Object(
  {
    name: Type.String({ description: 'Technical mark type name, also used as its map key.' }),
    label: Type.Optional(Type.String({ description: 'Human-readable mark label.' })),
    description: Type.Optional(Type.String({ description: 'Semantic purpose and usage hints.' })),
    type: Type.Literal('mark', { description: 'This definition describes a mark type.' }),
    attributes: Type.Record(Type.String(), AttributeDefinitionSchema, {
      description: 'Actual attributes of the configured mark type.'
    }),
    group: Type.Optional(Type.String({ description: 'Space-separated native mark groups.' })),
    excludes: Type.Array(Type.String(), {
      description: 'Mark types excluded by this mark. Applying a mark must not remove protected anchors.'
    })
  },
  {
    additionalProperties: false,
    description:
      'One configured native mark type. Comment anchors can exist in documents while being protected ' +
      'from agent formatting operations.'
  }
)

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
      description: 'Final operation targets after the complete batch commits.'
    })
  },
  { additionalProperties: false, description: 'Confirmed atomic batch success.' }
)

export const GetAgentSchemaRequestSchema = Type.Object(
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

export const GetAgentSchemaResponseSchema = Type.Object(
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

export const ReadAgentNodeResponseSchema = Type.Object(
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

export const CollaborativeDocSchema = Type.Unsafe<CollaborativeDoc>(
  Type.Object(
    {
      objectClass: Type.String({ minLength: 1, pattern: '^[^|]+$', description: 'Actual platform object class.' }),
      objectId: Type.String({ minLength: 1, pattern: '^[^|]+$', description: 'Platform object identifier.' }),
      objectAttr: Type.String({ minLength: 1, pattern: '^[^|]+$', description: 'Collaborative field key.' })
    },
    { additionalProperties: false, description: 'One collaborative field in the authenticated workspace.' }
  )
)

export const GetAgentOutlineRequestSchema = Type.Object(
  { document: CollaborativeDocSchema, from: PageFromSchema, limit: PageLimitSchema },
  { additionalProperties: false, description: 'Read a page of document root children.' }
)

export const FindAgentNodesRequestSchema = Type.Object(
  {
    document: CollaborativeDocSchema,
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
    anyOf: [{ required: ['text'] }, { required: ['type'] }],
    description: 'Find nodes by at least one literal text or exact type filter.'
  }
)

export const ReadAgentNodeRequestSchema = Type.Object(
  { document: CollaborativeDocSchema, ref: NodeRefSchema },
  { additionalProperties: false, description: 'Read a complete addressable node subtree.' }
)

export const AgentOpsSchema = Type.Array(OpSchema, {
  minItems: 1,
  maxItems: 100,
  description: 'One atomic batch of 1 to 100 operations on existing handles.'
})

export const ApplyAgentOpsBodySchema = Type.Object(
  { ops: AgentOpsSchema },
  { additionalProperties: false, description: 'REST body of a batch write; the document address is in the route.' }
)

export const ApplyAgentOpsRequestSchema = Type.Object(
  { document: CollaborativeDocSchema, ops: AgentOpsSchema },
  { additionalProperties: false, description: 'Apply an atomic batch to one collaborative field.' }
)

export const AgentErrorSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, description: 'Machine-readable failure code.' }),
    message: Type.String({ description: 'Failure explanation and recovery guidance.' }),
    retryable: Type.Literal(false, { description: 'Never automatically retry this request.' }),
    outcome: Type.Union(
      [
        Type.Literal('not_applied', { description: 'The request was rejected without applying its edits.' }),
        Type.Literal('unknown', { description: 'A write may have applied; read before another write.' })
      ],
      { description: 'Whether the write outcome is known.' }
    ),
    opIndex: Type.Optional(Type.Integer({ minimum: 0, description: 'Failed operation index, when applicable.' }))
  },
  { additionalProperties: false, description: 'Common REST error payload.' }
)

export const AgentOperationErrorSchema = Type.Object(
  {
    ...AgentErrorSchema.properties,
    code: OperationErrorCodeSchema,
    outcome: Type.Literal('not_applied', { description: 'No operations from this batch were committed.' }),
    opIndex: Type.Integer({ minimum: 0, description: 'Zero-based failed operation index.' })
  },
  { additionalProperties: false, description: 'Known atomic batch rejection.' }
)

export const ApplyAgentOpsResponseSchema = Type.Union(
  [
    ApplyAgentOpsSuccessSchema,
    Type.Object(
      { ok: Type.Literal(false), error: AgentOperationErrorSchema },
      { additionalProperties: false, description: 'Rejected batch; no operations were applied.' }
    )
  ],
  { description: 'Confirmed batch success or known rejection.' }
)

export const AgentApiErrorResponseSchema = Type.Object(
  { error: AgentErrorSchema },
  { additionalProperties: false, description: 'REST request failure.' }
)

export const GetAgentOutlineResponseSchema = Type.Object(
  {
    ...NodePageSchema.properties,
    typesPresent: Type.Array(Type.String(), {
      description:
        'Distinct addressable node types in the entire document, including nested nodes and other pages. Names can be used as exact node type filters.'
    })
  },
  { additionalProperties: false, description: 'Top-level node page and node types present throughout the document.' }
)
export const FindAgentNodesResponseSchema = NodePageSchema
