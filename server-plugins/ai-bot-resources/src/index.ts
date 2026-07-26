//
// Copyright © 2024-2025 Hardcore Engineering Inc.
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

import { AccountUuid, Doc, PersonId, Ref, SortingOrder, Tx, TxCreateDoc, TxProcessor } from '@hcengineering/core'
import { PlatformQueueProducer, QueueTopic, TriggerControl } from '@hcengineering/server-core'
import aiBot, { aiBotEmailSocialKey, AIEventRequest } from '@hcengineering/ai-bot'
import activity from '@hcengineering/activity'
import chunter, { ChatMessage, DirectMessage, ThreadMessage } from '@hcengineering/chunter'
import contact, { Employee, SocialIdentity } from '@hcengineering/contact'
import { extractReferences } from '@hcengineering/text-core'

interface WorkspaceCacheEntry {
  primary: SocialIdentity[]
  all: PersonId[]
  employee: Employee
}

const cacheKey = 'ai-info'

function isBotMentioned (entry: WorkspaceCacheEntry, personRef: Ref<Doc>): boolean {
  return entry.primary.some((it) => personRef === it.attachedTo)
}

function isBotTx (entry: WorkspaceCacheEntry, tx: Tx): boolean {
  return entry.all.includes(tx.modifiedBy)
}

async function getAIWorkspaceID (control: TriggerControl): Promise<WorkspaceCacheEntry | undefined> {
  let wsEntry = control.cache.get(cacheKey) as WorkspaceCacheEntry | undefined
  if (wsEntry === undefined) {
    const primaryIdentities = await control.findAll(
      control.ctx,
      contact.class.SocialIdentity,
      { key: aiBotEmailSocialKey },
      {}
    )

    if (primaryIdentities.length === 0) {
      return undefined
    }

    const attachedTo = primaryIdentities.map((it) => it.attachedTo as Ref<Employee>)
    const allAiSocialIds: PersonId[] = (
      await control.findAll(control.ctx, contact.class.SocialIdentity, {
        attachedTo: { $in: attachedTo }
      })
    ).map((it) => it._id)

    const employee = (
      await control.findAll(
        control.ctx,
        contact.mixin.Employee,
        { _id: { $in: attachedTo } },
        { limit: 1, sort: { modifiedOn: SortingOrder.Descending } }
      )
    ).shift()
    if (employee === undefined) {
      return undefined
    }
    wsEntry = {
      all: allAiSocialIds,
      primary: primaryIdentities,
      employee
    }
    control.cache.set(cacheKey, wsEntry)
  }
  return wsEntry
}

async function OnMessageSend (txes: TxCreateDoc<ChatMessage>[], control: TriggerControl): Promise<Tx[]> {
  const wsID = await getAIWorkspaceID(control)
  if (wsID === undefined) {
    return []
  }

  const producer = control.queue?.getProducer<AIEventRequest>(control.ctx, QueueTopic.AI)
  if (producer === undefined) {
    return []
  }

  const { hierarchy } = control
  const result: Tx[] = []

  for (const tx of txes) {
    // IGNORE AI operations
    if (isBotTx(wsID, tx)) continue

    const message = TxProcessor.createDoc2Doc(tx)
    const isThread = hierarchy.isDerived(tx.objectClass, chunter.class.ThreadMessage)
    const docClass = isThread ? (message as ThreadMessage).objectClass : message.attachedToClass

    try {
      const references = extractReferences(message.message)
      const mentioned = references.some((p) => isBotMentioned(wsID, p.objectId))

      if (docClass === chunter.class.DirectMessage) {
        await handleBotDirectMessage(control, message, wsID, producer)
      } else if (mentioned) {
        await handleBotMention(control, message, producer)
        result.push(markAsAIThread(control, message))
      } else if (isThread) {
        const threadMsg = message as ThreadMessage
        await handleBotThreadMessage(control, threadMsg, wsID, producer)
      }
    } catch (err: any) {
      control.ctx.error('Failed to prepare a ai bot message', { err })
    }
  }

  return result
}

function markAsAIThread (control: TriggerControl, message: ChatMessage): Tx {
  const { hierarchy } = control
  const isThread = hierarchy.isDerived(message._class, chunter.class.ThreadMessage)

  if (isThread) {
    // Mark thread root so future replies get forwarded
    const threadMsg = message as ThreadMessage
    return control.txFactory.createTxMixin(
      threadMsg.attachedTo,
      threadMsg.attachedToClass,
      threadMsg.space,
      aiBot.mixin.AIBotThread,
      {}
    )
  } else {
    return control.txFactory.createTxMixin(message._id, message._class, message.space, aiBot.mixin.AIBotThread, {})
  }
}

function getMessageData (doc: Doc, message: ChatMessage): AIEventRequest {
  return {
    createdOn: message.createdOn ?? message.modifiedOn,
    objectId: message.attachedTo,
    objectClass: message.attachedToClass,
    objectSpace: doc.space,
    collection: message.collection,
    message: message.message,
    messageClass: message._class,
    messageId: message._id,
    messageSpace: message.space,
    user: message.createdBy ?? message.modifiedBy
  }
}

function getThreadMessageData (message: ThreadMessage): AIEventRequest {
  return {
    createdOn: message.createdOn ?? message.modifiedOn,
    objectId: message.objectId,
    objectClass: message.objectClass,
    objectSpace: message.space,
    collection: message.collection,
    message: message.message,
    messageClass: message._class,
    messageId: message._id,
    messageSpace: message.space,
    user: message.createdBy ?? message.modifiedBy
  }
}

async function getMessageDoc (message: ChatMessage, control: TriggerControl): Promise<Doc | undefined> {
  if (control.hierarchy.isDerived(message._class, chunter.class.ThreadMessage)) {
    const thread = message as ThreadMessage
    const _id = thread.objectId
    const _class = thread.objectClass

    return (await control.queryFind(control.ctx, _class, { _id }))[0]
  } else {
    const _id = message.attachedTo
    const _class = message.attachedToClass

    return (await control.queryFind(control.ctx, _class, { _id }))[0]
  }
}

function isDirectAvailable (direct: DirectMessage, control: TriggerControl, wsID: WorkspaceCacheEntry): boolean {
  const { members } = direct

  if (!members.includes(wsID.employee.personUuid as AccountUuid)) {
    return false
  }

  return members.length === 2
}

async function handleBotDirectMessage (
  control: TriggerControl,
  message: ChatMessage,
  wsID: WorkspaceCacheEntry,
  producer: PlatformQueueProducer<AIEventRequest>
): Promise<void> {
  const direct = (await getMessageDoc(message, control)) as DirectMessage
  if (direct === undefined) {
    return
  }
  const isAvailable = isDirectAvailable(direct, control, wsID)
  if (!isAvailable) {
    return
  }

  const messageEvent = control.hierarchy.isDerived(message._class, chunter.class.ThreadMessage)
    ? getThreadMessageData(message as ThreadMessage)
    : getMessageData(direct, message)

  await producer.send(control.ctx, control.workspace.uuid, [messageEvent])
}

async function handleBotMention (
  control: TriggerControl,
  message: ChatMessage,
  producer: PlatformQueueProducer<AIEventRequest>
): Promise<void> {
  const messageEvent = control.hierarchy.isDerived(message._class, chunter.class.ThreadMessage)
    ? getThreadMessageData(message as ThreadMessage)
    : getMessageData(message, message)
  await producer.send(control.ctx, control.workspace.uuid, [messageEvent])
}

async function handleBotThreadMessage (
  control: TriggerControl,
  message: ThreadMessage,
  wsID: WorkspaceCacheEntry,
  producer: PlatformQueueProducer<AIEventRequest>
): Promise<void> {
  const parentMessages = await control.findAll(
    control.ctx,
    activity.class.ActivityMessage,
    { _id: message.attachedTo },
    { limit: 1 }
  )
  const parentMsg = parentMessages[0]
  if (parentMsg !== undefined && control.hierarchy.hasMixin(parentMsg, aiBot.mixin.AIBotThread)) {
    const messageEvent = getThreadMessageData(message)
    await producer.send(control.ctx, control.workspace.uuid, [messageEvent])
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export default async () => ({
  trigger: {
    OnMessageSend
  }
})
