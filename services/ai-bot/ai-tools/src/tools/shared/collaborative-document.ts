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

import { Buffer } from 'node:buffer'
import type { PlatformContext } from '@hcengineering/ai-core'
import core, { makeDocCollabId, type CollaborativeDoc, type Doc } from '@hcengineering/core'
import { CollaboratorAgentError } from '@hcengineering/collaborator-client'
import { translate } from '@hcengineering/platform'
import { Type, type Static } from 'typebox'

export const DocNameSchema = Type.String({
  minLength: 1,
  description:
    'Opaque address of one collaborative field within the selected workspace. Copy docName from ' +
    'collaborativeFields in object or card results. Do not construct or decode it. This is not a blob ID or a node handle.'
})

export const CollaborativeFieldSchema = Type.Object(
  {
    key: Type.String({ description: 'Technical collaborative field key.' }),
    label: Type.String({ description: 'Human-readable collaborative field label.' }),
    docName: DocNameSchema
  },
  { additionalProperties: false, description: 'A supported collaborative field and its ready-to-use address.' }
)

export const CollaborativeFieldsSchema = Type.Array(CollaborativeFieldSchema, {
  description:
    'Visible collaborative fields of this object, including inherited fields. Pass a returned docName ' +
    'unchanged to collab tools in the same workspace. Tag mixin fields are not included.'
})

export type CollaborativeField = Static<typeof CollaborativeFieldSchema>

/** Encode the current address representation; callers must treat the result as opaque. */
export function encodeAgentDocument (document: CollaborativeDoc): string {
  const parts = [document.objectClass, document.objectId, document.objectAttr]
  return 'd1.' + Buffer.from(JSON.stringify(parts)).toString('base64url')
}

/** Resolve an MCP address before passing the native CollaborativeDoc to the API client. */
export function decodeAgentDocument (docName: string): CollaborativeDoc {
  try {
    if (!docName.startsWith('d1.')) throw new Error('Unknown address format')
    const encoded = docName.slice(3)
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded) throw new Error('Invalid address encoding')
    const parts: unknown = JSON.parse(bytes.toString('utf8'))
    if (
      !Array.isArray(parts) ||
      parts.length !== 3 ||
      parts.some((part) => typeof part !== 'string' || part.length === 0 || part.includes('|'))
    ) {
      throw new Error('Invalid collaborative field')
    }
    return {
      objectClass: parts[0] as CollaborativeDoc['objectClass'],
      objectId: parts[1] as CollaborativeDoc['objectId'],
      objectAttr: parts[2]
    }
  } catch {
    throw new CollaboratorAgentError(
      'invalid_document',
      'Use a docName returned in collaborativeFields for this workspace.',
      400
    )
  }
}

/** Discover class-owned fields using the same actual class and field keys as the editor. */
export async function getCollaborativeFields (ctx: PlatformContext, doc: Doc): Promise<CollaborativeField[]> {
  const { hierarchy } = ctx
  const fields = [...hierarchy.getAllAttributes(doc._class, core.class.Doc).entries()].filter(
    ([, attr]) =>
      attr.hidden !== true &&
      !hierarchy.isMixin(attr.attributeOf) &&
      hierarchy.isDerived(attr.type._class, core.class.TypeCollaborativeDoc)
  )
  return await Promise.all(
    fields.map(async ([key, attr]) => {
      const field: CollaborativeField = {
        key,
        label: await translate(attr.label, {}),
        docName: encodeAgentDocument(makeDocCollabId(doc, key))
      }
      return field
    })
  )
}
