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

import chunter, { type Channel, type ChatMessage } from '@hcengineering/chunter'
import { type Class, type Doc, type Ref, SortingOrder } from '@hcengineering/core'
import documents from '@hcengineering/controlled-documents'
import type { WorkspaceApiContext } from '@hcengineering/integration'

type Input = Record<string, unknown>
function limit (input: Input): number {
  const value = input.limit ?? 100
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1000) {
    throw new Error('limit must be an integer from 1 to 1000')
  }
  return value as number
}
function id (input: Input, label: string): Ref<Doc> {
  if (typeof input.id !== 'string' || input.id.trim() === '') throw new Error(`${label} id is required`)
  return input.id as Ref<Doc>
}
function content (input: Input): string {
  if (typeof input.content !== 'string' || input.content.trim() === '') throw new Error('content is required')
  return input.content
}
function targetClass (input: Input): Ref<Class<Doc>> {
  if (typeof input.targetClass !== 'string') throw new Error('Target class is required')
  return input.targetClass as Ref<Class<Doc>>
}

async function target (context: WorkspaceApiContext, input: Input): Promise<Doc> {
  const doc = await context.client.findOne(targetClass(input), { _id: id(input, 'Target') })
  if (doc === undefined) throw new Error(`Target with id "${String(input.id)}" was not found`)
  return doc
}
function commentClass (context: WorkspaceApiContext, doc: Doc): Ref<Class<ChatMessage>> {
  return context.client.getHierarchy().isDerived(doc._class, documents.class.ControlledDocument)
    ? documents.class.DocumentComment
    : chunter.class.ChatMessage
}

export async function GetLegacyComments (context: WorkspaceApiContext, input: Input): Promise<ChatMessage[]> {
  const doc = await target(context, input)
  return await context.client.findAll(
    commentClass(context, doc),
    { attachedTo: doc._id, attachedToClass: doc._class, collection: 'comments' },
    { limit: limit(input), sort: { createdOn: SortingOrder.Descending } }
  )
}
export async function CreateLegacyComment (context: WorkspaceApiContext, input: Input): Promise<ChatMessage> {
  const doc = await target(context, input)
  const created = await context.client.addCollection(
    commentClass(context, doc),
    doc.space,
    doc._id,
    doc._class,
    'comments',
    { message: content(input) }
  )
  const comment = await context.client.findOne(commentClass(context, doc), { _id: created })
  if (comment === undefined) throw new Error('Comment was not created')
  return comment
}
async function channel (context: WorkspaceApiContext, input: Input): Promise<Channel> {
  const value = await context.client.findOne(chunter.class.Channel, { _id: id(input, 'Channel') as Ref<Channel> })
  if (value === undefined || value.archived) {
    throw new Error(`Channel with id "${String(input.id)}" was not found or is archived`)
  }
  return value
}
async function channelByName (context: WorkspaceApiContext, input: Input): Promise<Channel> {
  if (typeof input.channel !== 'string' || input.channel.trim() === '') throw new Error('channel name is required')
  const values = await context.client.findAll(chunter.class.Channel, { name: input.channel }, { limit: 2 })
  if (values.length !== 1 || values[0].archived) {
    throw new Error(`Channel named "${input.channel}" was not found or is ambiguous`)
  }
  return values[0]
}
export async function GetChannelMessages (context: WorkspaceApiContext, input: Input): Promise<ChatMessage[]> {
  const value = await channel(context, input)
  return await context.client.findAll(
    chunter.class.ChatMessage,
    { attachedTo: value._id, attachedToClass: value._class, collection: 'messages' },
    { limit: limit(input), sort: { createdOn: SortingOrder.Descending } }
  )
}
export async function CreateChannelMessage (context: WorkspaceApiContext, input: Input): Promise<ChatMessage> {
  const value = await channel(context, input)
  const created = await context.client.addCollection(
    chunter.class.ChatMessage,
    value.space,
    value._id,
    value._class,
    'messages',
    { message: content(input) }
  )
  const message = await context.client.findOne(chunter.class.ChatMessage, { _id: created })
  if (message === undefined) throw new Error('Message was not created')
  return message
}
export async function GetChannelMessagesByName (context: WorkspaceApiContext, input: Input): Promise<ChatMessage[]> {
  const value = await channelByName(context, input)
  return await GetChannelMessages(context, { id: value._id, limit: input.limit })
}
export async function CreateChannelMessageByName (context: WorkspaceApiContext, input: Input): Promise<ChatMessage> {
  const value = await channelByName(context, input)
  return await CreateChannelMessage(context, { id: value._id, content: input.content })
}
