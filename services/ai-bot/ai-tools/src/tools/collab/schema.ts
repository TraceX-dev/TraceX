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

import { Type } from 'typebox'
import { collabFindToolId, collabOutlineToolId, collabReadToolId, collabSchemaToolId } from './tool-ids'

export { DocNameSchema } from '../shared/collaborative-document'

const HANDLE_PATTERN = '[0-9a-z]+\\.[0-9a-z]+'

export const NodeRefSchema = Type.String({
  pattern: `^${HANDLE_PATTERN}$`,
  description:
    `Opaque node handle returned by ${collabOutlineToolId}, ${collabFindToolId} or ${collabReadToolId}. ` +
    'Use it only with the same docName. Do not construct handles, use paths as addresses, or reuse ' +
    'a deleted node handle. Text nodes have no handles.'
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
    type: Type.String({ minLength: 1, description: `Technical mark type name from ${collabSchemaToolId}.` }),
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
    CollabNode: Type.Object(
      {
        type: Type.String({
          minLength: 1,
          description: `Technical node type name from ${collabSchemaToolId}, or "text" for a text child.`
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
          Type.Array(Type.Ref('CollabNode'), {
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
  'CollabNode',
  {
    description:
      `Recursive ProseMirror node JSON. Use examples from ${collabSchemaToolId}. ` +
      'Attributes, marks and content are validated by the editor schema.'
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
    description:
      'Insertion position. Content must fit exactly; the tool does not wrap or move it to repair ' + 'invalid nesting.'
  }
)

export const NodeSummarySchema = Type.Object(
  {
    ref: NodeRefSchema,
    type: Type.String({ minLength: 1, description: 'Technical node type name.' }),
    preview: Type.String({
      description:
        `Short plain-text preview for locating content. It may omit content; use ${collabReadToolId} when context is needed before ` +
        'editing.'
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
