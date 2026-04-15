//
// Copyright © 2024 Hardcore Engineering Inc.
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
import {
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
  Space,
  toIdMap,
  TxOperations,
  type Account,
  type WorkspaceIds
} from '@hcengineering/core'
import { Room } from '@hcengineering/love'
import fs from 'fs'
import type { ChatMessage as LLMChatMessage } from '../providers'
import { type LLMService } from '../services'
import { type MemoryStorage, type PersonHistoryRecord } from '../storage'
import { type ToolDependencies, type WorkspaceOps } from '../tools'

import { getAccountClient } from '@hcengineering/server-client'
import { StorageAdapter } from '@hcengineering/server-core'
import { jsonToMarkup, markupToText } from '@hcengineering/text'
import { markdownToMarkup } from '@hcengineering/text-markdown'
import config from '../config'
import { getGlobalPerson } from '../utils/account'
import { connectPlatform } from '../utils/platform'
import { LoveController } from './love'

interface LLMHistoryRecord {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export class WorkspaceClient {
  rate = new RateLimiter(1)

  primarySocialId: SocialId
  aiPerson: Person | undefined
  personUuidBySocialId = new Map<PersonId, PersonUuid>()

  love: LoveController | undefined
  clientPromise: Promise<TxOperations>

  constructor (
    readonly storage: StorageAdapter,
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

      const isAlreadyUploaded = uploadInfo !== undefined && uploadInfo.modifiedOn !== lastModified
      if (!isAlreadyUploaded) {
        const data = fs.readFileSync(config.BotAvatarPath)

        await this.storage.put(this.ctx, this.wsIds, config.BotAvatarName, data, config.BotAvatarContentType, data.length)
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

  private async getAttachments (client: TxOperations, objectId: Ref<Doc>): Promise<Attachment[]> {
    return await client.findAll(attachment.class.Attachment, { attachedTo: objectId })
  }

  async processMessageEvent (event: AIEventRequest): Promise<void> {
    const client = await this.clientPromise

    const { user, objectId, objectClass, messageClass } = event
    const accountClient = getAccountClient(this.token)
    const personUuid = this.personUuidBySocialId.get(user) ?? (await accountClient.findPersonBySocialId(user))

    const contextMode = objectClass === chunter.class.DirectMessage ? 'direct' : 'thread'

    if (personUuid === undefined) {
      return
    }

    this.personUuidBySocialId.set(user, personUuid)

    let promptText = markupToText(event.message)
    const files = await this.getAttachments(client, event.messageId)
    if (files.length > 0) {
      promptText += '\n\nAttachments:'
      for (const file of files) {
        promptText += `\nName:${file.name} FileId:${file.file} Type:${file.type}`
      }
    }
    const prompt: LLMChatMessage = { content: promptText, role: 'user' as const }
    const promptTokens = this.llmService.countTokens([prompt])

    const space = (event as any).objectIdIsSpace != null ? (objectId as Ref<Space>) : event.objectSpace

    const rawHistory = await this.memoryStorage.getHistory(personUuid)
    const history = this.toLlmHistory(rawHistory, promptTokens)

    await this.memoryStorage.pushHistory(personUuid, promptText, 'user', promptTokens, personUuid, objectId, objectClass)

    const useHistory = history.filter((it) => it.role !== 'system')

    const systemPrompts: LLMHistoryRecord[] = []

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
    }

    const workspaceOps: WorkspaceOps = {
      storage: this.storage,
      ctx: this.ctx,
      wsIds: this.wsIds,
      getClient: () => this.clientPromise
    }

    const toolDeps: ToolDependencies = {
      memoryStorage: this.memoryStorage,
      user: personUuid as AccountUuid,
      workspace: this.wsIds.uuid,
      workspaceOps
    }

    const chatMessages: LLMChatMessage[] = [
      ...systemPrompts,
      ...useHistory,
      prompt
    ]

    const chatCompletion = await this.llmService.chat(
      this.ctx,
      this.wsIds.uuid,
      chatMessages,
      contextMode,
      rawHistory.assistantMemory,
      rawHistory.userMemory,
      rawHistory.sharedContext,
      toolDeps,
      { user: personUuid as AccountUuid }
    )
    const response = chatCompletion?.completion

    if (response == null) {
      return
    }
    const responseTokens =
      chatCompletion?.usage ?? this.llmService.countTokens([{ role: 'assistant', content: response }])

    await this.memoryStorage.pushHistory(personUuid, response, 'assistant', responseTokens, personUuid, objectId, objectClass)
    await this.memoryStorage.saveHistory(personUuid, await this.memoryStorage.getHistory(personUuid))

    const parseResponse = jsonToMarkup(markdownToMarkup(response, { refUrl: '', imageUrl: '' }))

    if (messageClass === chunter.class.ChatMessage) {
      await client.addCollection<Doc, ChatMessage>(
        chunter.class.ChatMessage,
        space,
        objectId,
        objectClass,
        event.collection,
        { message: parseResponse }
      )
    } else if (messageClass === chunter.class.ThreadMessage) {
      const parent = await client.findOne<ChatMessage>(chunter.class.ChatMessage, {
        _id: objectId as Ref<ChatMessage>
      })

      if (parent !== undefined) {
        await client.addCollection<Doc, ThreadMessage>(
          chunter.class.ThreadMessage,
          space,
          objectId,
          objectClass,
          event.collection,
          { message: parseResponse, objectId: parent.attachedTo, objectClass: parent.attachedToClass }
        )
      }
    }
  }

  async close (): Promise<void> {
    this.ctx.info('Closed workspace client: ', { workspace: this.wsIds })
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
