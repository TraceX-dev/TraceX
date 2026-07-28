//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import card, { type Card } from '@hcengineering/card'
import { SortingOrder, type OperationDomain, type Ref } from '@hcengineering/core'
import type { WorkspaceApiContext } from '@hcengineering/integration'

type Input = Record<string, unknown>
function id (input: Input): Ref<Card> {
  if (typeof input.id !== 'string' || input.id.trim() === '') throw new Error('Card id is required')
  return input.id as Ref<Card>
}
async function target (context: WorkspaceApiContext, input: Input): Promise<Card> {
  const value = await context.client.findOne(card.class.Card, { _id: id(input) })
  if (value === undefined) throw new Error(`Card with id "${String(input.id)}" was not found`)
  return value
}

export async function GetCommunicationMessages (context: WorkspaceApiContext, input: Input): Promise<unknown> {
  const value = await target(context, input)
  const limit = input.limit === undefined ? 100 : input.limit
  if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 1000) {
    throw new Error('limit must be an integer from 1 to 1000')
  }
  const response = await context.client.domainRequest('communication' as OperationDomain, {
    findMessagesMeta: { params: { cardId: value._id, limit, order: SortingOrder.Descending } }
  })
  return response.value
}

export async function CreateCommunicationMessage (context: WorkspaceApiContext, input: Input): Promise<unknown> {
  const value = await target(context, input)
  if (typeof input.content !== 'string' || input.content.trim() === '') throw new Error('content is required')
  const response = await context.client.domainRequest('communication' as OperationDomain, {
    event: {
      type: 'createMessage',
      cardId: value._id,
      cardType: value._class,
      messageType: 'text',
      content: input.content,
      socialId: context.currentUser
    }
  })
  return response.value
}
