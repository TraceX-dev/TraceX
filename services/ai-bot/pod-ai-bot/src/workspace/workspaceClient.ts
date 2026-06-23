//
// Copyright © 2024 Hardcore Engineering Inc.
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
import aiBot, {
  AIEventRequest,
  ConnectMeetingRequest,
  DisconnectMeetingRequest,
  IdentityResponse
} from '@hcengineering/ai-bot'
import attachment, { Attachment } from '@hcengineering/attachment'
import chunter, { ChatMessage, ThreadMessage } from '@hcengineering/chunter'
import contact, {
  AvatarType,
  combineName,
  ensureEmployee,
  getFirstName,
  getLastName,
  Person
} from '@hcengineering/contact'
import core, {
  AccountRole,
  AccountUuid,
  Blob,
  Client,
  Doc,
  MeasureContext,
  PersonId,
  PersonUuid,
  pickPrimarySocialId,
  RateLimiter,
  Ref,
  SocialId,
  SortingOrder,
  toIdMap,
  TxOperations,
  type Account,
  type WorkspaceIds
} from '@hcengineering/core'
import { Room } from '@hcengineering/love'
import { CollaboratorClient } from '@hcengineering/collaborator-client'
import { getAccountClient } from '@hcengineering/server-client'
import { StorageAdapter } from '@hcengineering/server-core'
import { extractReferences, jsonToMarkup, markupToText } from '@hcengineering/text'
import { markdownToMarkup } from '@hcengineering/text-markdown'

import fs from 'fs'
import { LRUCache } from 'lru-cache'

import type {
  ChatMessageAttachment,
  ChatMessageReference,
  ContextMode,
  ChatMessage as LLMChatMessage
} from '../providers'
import { ChatResult, type LLMService } from '../services'
import { type MemoryStorage, type PersonHistoryRecord } from '../storage'
import { type ToolContext, type WorkspaceOps } from '../tools'
import { getGlobalPerson } from '../utils/account'
import { connectPlatform } from '../utils/platform'
import config from '../config'
import { LoveController } from './love'

interface LLMHistoryRecord {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const MAX_PROMPT_ATTACHMENT_BYTES = 1024 * 1024 * 10

export class WorkspaceClient {
  rate = new RateLimiter(1)

  primarySocialId: SocialId
  aiPerson: Person | undefined
  personUuidBySocialId = new Map<PersonId, PersonUuid>()
  processedMessages = new LRUCache({ max: 10000, ttl: 1000 * 60 * 5 })

  love: LoveController | undefined
  clientPromise: Promise<TxOperations>

  constructor (
    readonly storage: StorageAdapter,
    readonly collaborator: CollaboratorClient,
    readonly transactorUrl: string,
    readonly token: string,
    readonly wsIds: WorkspaceIds,
    readonly personUuid: AccountUuid,
    readonly socialIds: SocialId[],
    readonly ctx: MeasureContext,
    readonly llmService: LLMService,
    readonly memoryStorage: MemoryStorage
  ) {
    this.primarySocialId = pickPrimarySocialId(this.socialIds)
    this.clientPromise = this.initClient()
  }

  private async initClient (): Promise<TxOperations> {
    const client = await connectPlatform(this.token, this.wsIds.uuid, this.transactorUrl)

    const txOps = new TxOperations(client, core.account.System)

    await this.ensureEmployee(txOps)
    await this.checkEmployeeInfo(txOps)

    if (this.aiPerson !== undefined && config.LoveEndpoint !== '') {
      this.love = new LoveController(
        this.wsIds.uuid,
        this.ctx.newChild('love', {}, { span: false }),
        this.token,
        txOps,
        this.aiPerson
      )
    }

    this.ctx.info('Initialized workspace', { workspace: this.wsIds })

    return new TxOperations(client, this.primarySocialId._id)
  }

  private async ensureEmployee (client: Client): Promise<void> {
    const me: Account = {
      uuid: this.personUuid,
      role: AccountRole.User,
      primarySocialId: this.primarySocialId._id,
      socialIds: this.socialIds.map((it) => it._id),
      fullSocialIds: this.socialIds
    }
    await ensureEmployee(this.ctx, me, client, this.socialIds, async () => await getGlobalPerson(this.token))
  }

  private async checkEmployeeInfo (client: TxOperations): Promise<void> {
    this.ctx.info('Upload avatar file', { workspace: this.wsIds })

    try {
      const stat = fs.statSync(config.BotAvatarPath)
      const lastModified = stat.mtime.getTime()

      const uploadInfo = await this.storage.stat(this.ctx, this.wsIds, config.BotAvatarName)

      const shouldUpload = uploadInfo === undefined || uploadInfo.modifiedOn !== lastModified
      if (shouldUpload) {
        const data = fs.readFileSync(config.BotAvatarPath)

        await this.storage.put(
          this.ctx,
          this.wsIds,
          config.BotAvatarName,
          data,
          config.BotAvatarContentType,
          data.length
        )
        this.ctx.info('Avatar file uploaded successfully', { workspace: this.wsIds, path: config.BotAvatarPath })
      }
    } catch (e) {
      this.ctx.error('Failed to upload avatar file', { e })
    }

    await this.checkPersonData(client)
  }

  private async checkPersonData (client: TxOperations): Promise<void> {
    this.aiPerson = this.aiPerson ?? (await client.findOne(contact.class.Person, { personUuid: this.personUuid }))

    if (this.aiPerson === undefined) {
      this.ctx.error('Cannot find AI Person ', { personUuid: this.personUuid })
      return
    }

    const firstName = getFirstName(this.aiPerson.name)
    const lastName = getLastName(this.aiPerson.name)

    if (lastName !== config.BotLastName || firstName !== config.BotFirstName) {
      await client.update(this.aiPerson, {
        name: combineName(config.BotFirstName, config.BotLastName)
      })
    }

    if (this.aiPerson.avatar === config.BotAvatarName) {
      return
    }

    const exist = await this.storage.stat(this.ctx, this.wsIds, config.BotAvatarName)

    if (exist === undefined) {
      this.ctx.error('Cannot find file', { file: config.BotAvatarName, workspace: this.wsIds })
      return
    }
    const pData = await client.findOne(this.aiPerson._class, { _id: this.aiPerson._id })
    if (pData?.avatar !== config.BotAvatarName || pData.avatarType !== AvatarType.IMAGE) {
      await client.update(this.aiPerson, {
        avatar: config.BotAvatarName as Ref<Blob>,
        avatarType: AvatarType.IMAGE
      })
    }
  }

  private toLlmHistory (history: PersonHistoryRecord, promptTokens: number): Array<LLMHistoryRecord> {
    const result: Array<{ role: 'user' | 'assistant' | 'system', content: string }> = []
    let totalTokens = promptTokens
    const maxRecentMessages = 20

    const recentMessages = history.history.slice(-maxRecentMessages)

    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const record = recentMessages[i]
      const tokens = record.tokens

      if (totalTokens + tokens > config.MaxContentTokens) break

      result.unshift({ content: record.message, role: record.role as 'user' | 'assistant' | 'system' })
      totalTokens += tokens
    }

    return result
  }

  async findPersonUuid (user: PersonId): Promise<PersonUuid | undefined> {
    const cachedUuid = this.personUuidBySocialId.get(user)
    if (cachedUuid !== undefined) {
      return cachedUuid
    }

    const accountClient = getAccountClient(this.token)
    const personUuid = await accountClient.findPersonBySocialId(user)
    if (personUuid !== undefined) {
      this.personUuidBySocialId.set(user, personUuid)
      return personUuid
    }
  }

  async processMessageEvent (ctx: MeasureContext, event: AIEventRequest): Promise<void> {
    if (this.processedMessages.has(event.messageId)) {
      ctx.warn('Duplicate message event, skipping', {
        workspace: this.wsIds.uuid,
        messageId: event.messageId
      })
      return
    }
    this.processedMessages.set(event.messageId, true)

    ctx.info('Processing message event', { workspace: this.wsIds.uuid, event })

    const personUuid = await this.findPersonUuid(event.user)
    if (personUuid === undefined) {
      ctx.warn('Cannot resolve personUuid for user, skipping event', {
        workspace: this.wsIds.uuid,
        user: event.user
      })
      return
    }

    const { objectId, objectClass } = event

    const client = await this.clientPromise

    const references = this.extractReferences(event.message)
    const attachments = await this.readAttachments(ctx, client, event)
    const promptText = buildPrompt(event.message, references, attachments)

    const prompt: LLMChatMessage = {
      content: promptText,
      role: 'user' as const,
      attachments
    }
    const promptTokens = this.llmService.countTokens(prompt)

    ctx.info('Prepared prompt', {
      workspace: this.wsIds.uuid,
      personUuid,
      promptTokens,
      references: references.length,
      attachments: attachments.length
    })

    const rawHistory = await this.memoryStorage.getHistory(personUuid)
    const history = this.toLlmHistory(rawHistory, promptTokens)

    await this.memoryStorage.pushHistory(
      personUuid,
      prompt.content,
      'user',
      promptTokens,
      personUuid,
      objectId,
      objectClass
    )

    const useHistory = history.filter((it) => it.role !== 'system')

    const systemPrompts: LLMHistoryRecord[] = []

    const contextMode = objectClass === chunter.class.DirectMessage ? 'direct' : 'thread'
    if (contextMode !== 'direct') {
      const msg = await client.findOne<Doc>(objectClass, { _id: objectId })
      if (msg !== undefined) {
        systemPrompts.push({
          role: 'system' as const,
          content: 'Document type:' + msg?._class
        })
        if (msg._class === chunter.class.ThreadMessage || msg._class === chunter.class.ChatMessage) {
          systemPrompts.push({
            role: 'system' as const,
            content: 'Content: ' + markupToText((msg as ChatMessage).message)
          })
        }
      }

      const lastMessages =
        (await client.findAll(
          chunter.class.ChatMessage,
          { attachedTo: objectId, attachedToClass: objectClass },
          { limit: 500, sort: { modifiedOn: SortingOrder.Descending } }
        )) ?? []

      lastMessages.sort((a, b) => a.modifiedOn - b.modifiedOn)

      const personIds = new Set(lastMessages.map((it) => it.modifiedBy))

      const socialIds = toIdMap(
        (await client.findAll(contact.class.SocialIdentity, { _id: { $in: Array.from(personIds) as any } })) ?? []
      )

      const employeesInChannel =
        (await client.findAll(contact.class.Person, {
          _id: { $in: Array.from(socialIds.values()).map((it) => it.attachedTo) }
        })) ?? []
      const empAsMap = toIdMap(employeesInChannel.filter((it) => it.personUuid !== undefined))

      for (const msg of lastMessages) {
        let emp: Person | undefined
        const sid = socialIds.get(msg.modifiedBy as any)
        if (sid !== undefined) {
          emp = empAsMap.get(sid.attachedTo)
        }
        const msgRole: 'assistant' | 'user' = this.aiPerson?.personUuid === emp?.personUuid ? 'assistant' : 'user'
        useHistory.push({
          role: msgRole,
          content: markupToText(msg.message)
        })
      }

      ctx.info('Thread context loaded', {
        workspace: this.wsIds.uuid,
        threadMessages: lastMessages.length,
        systemPrompts: systemPrompts.length
      })
    }

    const workspaceOps: WorkspaceOps = {
      ctx,
      storage: this.storage,
      wsIds: this.wsIds,
      getClient: () => this.clientPromise
    }

    const toolCtx: ToolContext = {
      memoryStorage: this.memoryStorage,
      collaborator: this.collaborator,
      user: personUuid as AccountUuid,
      workspace: this.wsIds.uuid,
      workspaceOps,
      objectId: event.objectId,
      objectClass: event.objectClass,
      objectSpace: event.objectSpace
    }

    const chatMessages: LLMChatMessage[] = [...systemPrompts, ...useHistory, prompt]

    const chatCompletion = await this.llmService.chat(
      ctx,
      this.wsIds.uuid,
      chatMessages,
      contextMode,
      rawHistory.assistantMemory,
      rawHistory.userMemory,
      rawHistory.sharedContext,
      toolCtx,
      { user: personUuid as AccountUuid }
    )

    if (chatCompletion !== undefined) {
      const response = chatCompletion.completion ?? ''
      ctx.info('LLM response received', {
        workspace: this.wsIds.uuid,
        personUuid,
        responseLength: response.length,
        usage: chatCompletion?.usage
      })

      const usage = chatCompletion.usage
      const responseTokens =
        usage !== undefined
          ? usage.inputTokens + usage.outputTokens
          : this.llmService.countTokens({ role: 'assistant', content: response })

      await this.memoryStorage.pushHistory(
        personUuid,
        response,
        'assistant',
        responseTokens,
        personUuid,
        objectId,
        objectClass
      )
      await this.memoryStorage.saveHistory(personUuid, await this.memoryStorage.getHistory(personUuid))
    }

    await this.sendReply(client, contextMode, event, chatCompletion)
  }

  private async sendReply (
    client: TxOperations,
    contextMode: ContextMode,
    event: AIEventRequest,
    chatCompletion: ChatResult | undefined
  ): Promise<void> {
    const markdown =
      chatCompletion?.completion ?? 'Sorry, I was unable to process your request. Please try again later.'

    const { objectId, objectClass, messageId, messageClass, messageSpace, collection } = event
    const message = jsonToMarkup(markdownToMarkup(markdown, { refUrl: '', imageUrl: '' }))

    const replyTo =
      messageClass === chunter.class.ThreadMessage
        ? 'thread' // If already in a thread, reply to the thread
        : contextMode === 'thread'
          ? 'thread'
          : 'chat' // Otherwise reply depending on context mode

    let replyId: Ref<ChatMessage> | undefined
    if (replyTo === 'chat') {
      replyId = await client.addCollection<Doc, ChatMessage>(
        chunter.class.ChatMessage,
        messageSpace,
        objectId,
        objectClass,
        collection,
        { message }
      )
    } else if (replyTo === 'thread') {
      let parentId = messageId
      let parentClass = messageClass

      if (messageClass === chunter.class.ThreadMessage) {
        const parent = await client.findOne<ThreadMessage>(chunter.class.ThreadMessage, {
          _id: messageId as Ref<ThreadMessage>
        })
        if (parent !== undefined) {
          parentId = parent.attachedTo as Ref<ChatMessage>
          parentClass = parent.attachedToClass
        }
      }

      replyId = (await client.addCollection<Doc, ThreadMessage>(
        chunter.class.ThreadMessage,
        messageSpace,
        parentId,
        parentClass,
        'replies',
        { message, objectId, objectClass }
      )) as unknown as Ref<ChatMessage>
    }

    if (replyId !== undefined && chatCompletion !== undefined) {
      await client.createMixin(replyId, chunter.class.ChatMessage, event.messageSpace, aiBot.mixin.AIBotMessage, {
        tools: chatCompletion.tools,
        inputTokens: chatCompletion.usage.inputTokens,
        outputTokens: chatCompletion.usage.outputTokens
      })
    }
  }

  private extractReferences (message: string): ChatMessageReference[] {
    const refs = extractReferences(message)
    return refs.map((p) => ({
      objectId: p.objectId,
      objectClass: p.objectClass,
      objectLabel: p.objectLabel
    }))
  }

  private async readAttachments (
    ctx: MeasureContext,
    client: TxOperations,
    { messageId }: AIEventRequest
  ): Promise<ChatMessageAttachment[]> {
    const attachments = await client.findAll(attachment.class.Attachment, { attachedTo: messageId })
    const promises = attachments.map((p) => this.readAttachment(ctx, p))
    return (await Promise.all(promises)).filter((p): p is ChatMessageAttachment => p != null)
  }

  private async readAttachment (ctx: MeasureContext, attachment: Attachment): Promise<ChatMessageAttachment | null> {
    if (attachment.size >= MAX_PROMPT_ATTACHMENT_BYTES) {
      ctx.warn('Ignore attachment because it is too large', {
        workspace: this.wsIds.uuid,
        file: attachment.file,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size
      })
      return null
    }

    try {
      const buffer = await this.storage.read(ctx, this.wsIds, attachment.file)
      return {
        uuid: attachment.file,
        name: attachment.name,
        type: attachment.type,
        data: Buffer.concat(buffer).toString('base64')
      }
    } catch (e: any) {
      ctx.warn('Failed to read attachment', {
        workspace: this.wsIds.uuid,
        file: attachment.file,
        name: attachment.name,
        type: attachment.type,
        error: e.message ?? String(e)
      })
    }

    return null
  }

  async close (): Promise<void> {
    this.ctx.info('Closed workspace client: ', { workspace: this.wsIds })
    const client = await this.clientPromise
    await client.close()
  }

  async loveConnect (request: ConnectMeetingRequest): Promise<void> {
    await this.clientPromise
    if (this.love === undefined) {
      this.ctx.error('Love controller is not initialized')
      return
    }
    await this.love.connect(request)
  }

  async loveDisconnect (request: DisconnectMeetingRequest): Promise<void> {
    await this.clientPromise

    if (this.love === undefined) {
      this.ctx.error('Love controller is not initialized')
      return
    }

    await this.love.disconnect(request.roomId)
  }

  async processLoveTranscript (text: string, participant: Ref<Person>, room: Ref<Room>): Promise<void> {
    await this.clientPromise
    if (this.love === undefined) {
      this.ctx.error('Love controller is not initialized')
      return
    }

    await this.love.processTranscript(text, participant, room)
  }

  async getLoveIdentity (): Promise<IdentityResponse | undefined> {
    await this.clientPromise
    if (this.love === undefined) {
      this.ctx.error('Love is not initialized')
      return
    }

    return this.love.getIdentity()
  }

  canClose (): boolean {
    if (this.love === undefined) return true

    return !this.love.hasActiveConnections()
  }
}

function buildPrompt (markup: string, references: ChatMessageReference[], attachments: ChatMessageAttachment[]): string {
  let promptText = markupToText(markup)
  if (references.length > 0) {
    promptText += '\n\nReferences:'
    for (const reference of references) {
      promptText += `\nObjectId:${reference.objectId} ObjectClass:${reference.objectClass} ObjectLabel:${reference.objectLabel}`
    }
  }

  if (attachments.length > 0) {
    promptText += '\n\nAttachments:'
    for (const attachment of attachments) {
      promptText += `\nName:${attachment.name} FileId:${attachment.uuid} Type:${attachment.type}`
    }
  }
  return promptText
}
