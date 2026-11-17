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

import core from '@hcengineering/core'
import type { Ref, Blob } from '@hcengineering/core'
import { decodeDocumentId } from '@hcengineering/collaborator-client'
import type { Context } from '../context'
import type { ClientFactory } from '../platform'
import { AgentApiFailure } from './errors'

export interface AgentActor {
  workspace: string
  readonly: boolean
  context: Context
  readClientFactory: ClientFactory
}

/** Authorize with the caller's platform client before exposing or changing live collaborative data. */
export async function authorizeAgentDocument (actor: AgentActor, docName: string, write: boolean): Promise<Context> {
  const { documentId } = decodeDocumentId(docName)
  const { objectClass, objectId, objectAttr } = documentId
  if (write && actor.readonly) throw new AgentApiFailure(403, 'forbidden', 'This account has read-only access.')
  const client = await actor.readClientFactory()
  try {
    const hierarchy = client.getHierarchy()
    if (hierarchy.isMixin(objectClass)) {
      throw new AgentApiFailure(400, 'invalid_document', 'Tag mixin collaborative fields are not supported yet.')
    }
    const attribute = hierarchy.findAttribute(objectClass, objectAttr)
    if (attribute === undefined || !hierarchy.isDerived(attribute.type._class, core.class.TypeCollaborativeDoc)) {
      throw new AgentApiFailure(400, 'invalid_document', 'The requested field is not a collaborative document.')
    }
    const doc = await client.findOne(objectClass, { _id: objectId })
    if (doc === undefined) {
      throw new AgentApiFailure(404, 'not_found', 'The document does not exist or is not accessible.')
    }
    if (doc._class !== objectClass) {
      throw new AgentApiFailure(
        400,
        'invalid_document',
        'Use the collaborative address returned for the actual object class.'
      )
    }
    if (write) {
      if (
        attribute.readonly === true ||
        Reflect.get(doc, 'readonly') === true ||
        Reflect.get(doc, 'isLatest') === false
      ) {
        throw new AgentApiFailure(403, 'forbidden', 'The document or field is read-only.')
      }
    }
    const content: unknown = Reflect.get(doc, objectAttr)
    return {
      ...actor.context,
      ...(typeof content === 'string' && content !== '' ? { content: content as Ref<Blob> } : {})
    }
  } finally {
    await client.close()
  }
}
