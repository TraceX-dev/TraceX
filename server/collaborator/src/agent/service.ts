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

import { encodeDocumentId } from '@hcengineering/collaborator-client'
import type { CollaborativeDoc } from '@hcengineering/core'
import type { Hocuspocus } from '@hocuspocus/server'
import type { Doc } from 'yjs'
import type {
  ApplyAgentOpsRequest,
  ApplyAgentOpsResponse,
  FindAgentNodesRequest,
  FindAgentNodesResponse,
  GetAgentOutlineRequest,
  GetAgentOutlineResponse,
  GetAgentSchemaRequest,
  GetAgentSchemaResponse,
  ReadAgentNodeRequest,
  ReadAgentNodeResponse
} from '@hcengineering/collaborator-client'
import type { Context } from '../context'
import { AgentEditor } from './editor'
import type { AgentActor } from './access'
import { authorizeAgentDocument } from './access'
import { AgentApiFailure } from './errors'

type AuthorizeDocument = (actor: AgentActor, docName: string, write: boolean) => Promise<Context>

/** One shared editor configuration; each operation leases and closes a direct Hocuspocus connection. */
export class AgentService {
  readonly editor = new AgentEditor()

  constructor (
    private readonly hocuspocus: Hocuspocus,
    private readonly authorize: AuthorizeDocument = authorizeAgentDocument
  ) {}

  schema (request?: GetAgentSchemaRequest): GetAgentSchemaResponse {
    return this.editor.schema(request)
  }

  private async withDocument<T>(
    actor: AgentActor,
    target: CollaborativeDoc,
    write: boolean,
    run: (document: Doc, origin: unknown, docName: string) => T
  ): Promise<T> {
    if (write && actor.readonly) throw new AgentApiFailure(403, 'forbidden', 'This account has read-only access.')
    const docName = encodeDocumentId(actor.workspace, target)
    const context = await this.authorize(actor, docName, write)
    const connection = await this.hocuspocus.openDirectConnection(docName, context)
    try {
      const document = connection.document
      if (document === null) {
        throw new AgentApiFailure(503, 'document_unavailable', 'The document connection is closed.')
      }
      if (!write) return run(document, connection, docName)
      let result: T | undefined
      await connection.transact((document) => {
        result = run(document, connection, docName)
      })
      if (result === undefined) {
        throw new AgentApiFailure(500, 'invalid_result', 'The operation did not return a result.')
      }
      return result
    } finally {
      await connection.disconnect()
    }
  }

  async outline (actor: AgentActor, request: GetAgentOutlineRequest): Promise<GetAgentOutlineResponse> {
    return await this.withDocument(actor, request.document, false, (document, _origin, docName) =>
      this.editor.outline(document, docName, request.from, request.limit)
    )
  }

  async find (actor: AgentActor, request: FindAgentNodesRequest): Promise<FindAgentNodesResponse> {
    return await this.withDocument(actor, request.document, false, (document, _origin, docName) =>
      this.editor.find(document, docName, request)
    )
  }

  async read (actor: AgentActor, request: ReadAgentNodeRequest): Promise<ReadAgentNodeResponse> {
    return await this.withDocument(actor, request.document, false, (document, _origin, docName) =>
      this.editor.read(document, docName, request.ref)
    )
  }

  async apply (actor: AgentActor, request: ApplyAgentOpsRequest): Promise<ApplyAgentOpsResponse> {
    return await this.withDocument(actor, request.document, true, (document, origin, docName) =>
      this.editor.apply(document, docName, request.ops, origin)
    )
  }
}
