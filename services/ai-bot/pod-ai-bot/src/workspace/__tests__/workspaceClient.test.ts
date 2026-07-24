import aiBot from '@hcengineering/ai-bot'
import chunter from '@hcengineering/chunter'
import { jsonToMarkup, MarkupNodeType } from '@hcengineering/text'

import { WorkspaceClient } from '../workspaceClient'

jest.mock('../../config', () => ({
  __esModule: true,
  default: {
    LoveEndpoint: '',
    MaxContentTokens: 12800,
    BotAvatarPath: '',
    BotAvatarName: 'avatar.png',
    BotAvatarContentType: 'image/png',
    BotFirstName: 'AI',
    BotLastName: 'Bot'
  }
}))

jest.mock('@hcengineering/server-token', () => ({
  decodeToken: jest.fn(() => ({
    account: 'bot-person',
    workspace: '00000000-0000-4000-8000-000000000001'
  }))
}))

const workspace = '00000000-0000-4000-8000-000000000001'
const personUuid = '00000000-0000-4000-8000-000000000002'

function markup (text: string): any {
  return jsonToMarkup({
    type: MarkupNodeType.doc,
    content: [
      {
        type: MarkupNodeType.paragraph,
        content: [{ type: MarkupNodeType.text, text }]
      }
    ]
  })
}

function createCtx (): any {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}

function createEvent (overrides: Record<string, any> = {}): any {
  return {
    user: 'social-user',
    messageId: 'message-1',
    messageClass: chunter.class.ChatMessage,
    messageSpace: 'space-1',
    message: markup('Hello bot'),
    objectId: 'direct-1',
    objectClass: chunter.class.DirectMessage,
    objectSpace: 'space-1',
    collection: 'messages',
    ...overrides
  }
}

function createTxClient (): any {
  return {
    findOne: jest.fn(),
    findAll: jest.fn(async () => []),
    addCollection: jest.fn(async () => 'reply-1'),
    createMixin: jest.fn(),
    getHierarchy: jest.fn(() => ({})),
    getModel: jest.fn(() => ({})),
    close: jest.fn()
  }
}

function createWorkspaceClient (overrides: Record<string, any> = {}): any {
  const txClient = overrides.txClient ?? createTxClient()
  const history = overrides.history ?? {
    assistantMemory: 'assistant memory',
    userMemory: 'user memory',
    sharedContext: 'shared context',
    history: []
  }
  const memoryStorage = overrides.memoryStorage ?? {
    getHistory: jest.fn(async () => history),
    pushHistory: jest.fn(),
    saveHistory: jest.fn()
  }
  const llmService = overrides.llmService ?? {
    countTokens: jest.fn(() => 99),
    chat: jest.fn(async () => ({
      completion: 'Assistant response',
      usage: { inputTokens: 5, outputTokens: 7 },
      tools: ['lookup']
    }))
  }

  const client = Object.create(WorkspaceClient.prototype)
  client.wsIds = { uuid: workspace, url: 'workspace-url', dataId: 'workspace-data' }
  client.storage = {}
  client.collaborator = {}
  client.token = 'token'
  client.personUuid = 'bot-person'
  client.socialIds = []
  client.ctx = createCtx()
  client.llmService = llmService
  client.memoryStorage = memoryStorage
  client.clientPromise = Promise.resolve(txClient)
  client.personUuidBySocialId = new Map()
  client.processedMessages = new Map()
  client.aiPerson = { personUuid: 'bot-person' }
  client.findPersonUuid = jest.fn(async () => personUuid)
  client.extractReferences = jest.fn(() => [])
  client.readAttachments = jest.fn(async () => [])

  return { client, txClient, memoryStorage, llmService, history }
}

describe('WorkspaceClient', () => {
  it('builds prompt from markup, references, and attachments', async () => {
    const { client, llmService, memoryStorage } = createWorkspaceClient()
    client.extractReferences = jest.fn(() => [
      {
        objectId: 'doc-1',
        objectClass: 'document:class:Document',
        objectLabel: 'Spec'
      }
    ])
    client.readAttachments = jest.fn(async () => [
      {
        uuid: 'file-1',
        name: 'notes.md',
        type: 'text/markdown',
        data: Buffer.from('# Notes').toString('base64')
      }
    ])

    await client.processMessageEvent(createCtx(), createEvent())

    const chatMessages = llmService.chat.mock.calls[0][2]
    const prompt = chatMessages[chatMessages.length - 1]

    expect(prompt).toEqual({
      role: 'user',
      content:
        'Hello bot\n\nReferences:\nObjectId:doc-1 ObjectClass:document:class:Document ObjectLabel:Spec\n\nAttachments:\nName:notes.md FileId:file-1 Type:text/markdown',
      attachments: [
        {
          uuid: 'file-1',
          name: 'notes.md',
          type: 'text/markdown',
          data: Buffer.from('# Notes').toString('base64')
        }
      ]
    })
    expect(memoryStorage.pushHistory).toHaveBeenNthCalledWith(
      1,
      personUuid,
      prompt.content,
      'user',
      99,
      personUuid,
      'direct-1',
      chunter.class.DirectMessage
    )
  })

  it('uses direct context mode and replies to direct chat messages', async () => {
    const { client, txClient, llmService } = createWorkspaceClient()
    const event = createEvent()

    await client.processMessageEvent(createCtx(), event)

    expect(llmService.chat.mock.calls[0][3]).toBe('direct')
    expect(txClient.addCollection).toHaveBeenCalledWith(
      chunter.class.ChatMessage,
      'space-1',
      'direct-1',
      chunter.class.DirectMessage,
      'messages',
      expect.objectContaining({ message: expect.any(String) })
    )
    expect(txClient.createMixin).toHaveBeenCalledWith(
      'reply-1',
      chunter.class.ChatMessage,
      'space-1',
      aiBot.mixin.AIBotMessage,
      {
        tools: ['lookup'],
        inputTokens: 5,
        outputTokens: 7
      }
    )
  })

  it('uses thread context mode and replies to object threads', async () => {
    const txClient = createTxClient()
    const { client, llmService } = createWorkspaceClient({ txClient })
    const event = createEvent({
      objectId: 'issue-1',
      objectClass: 'tracker:class:Issue',
      messageId: 'message-1',
      messageClass: chunter.class.ChatMessage
    })

    await client.processMessageEvent(createCtx(), event)

    expect(llmService.chat.mock.calls[0][3]).toBe('thread')
    expect(txClient.addCollection).toHaveBeenCalledWith(
      chunter.class.ThreadMessage,
      'space-1',
      'message-1',
      chunter.class.ChatMessage,
      'replies',
      expect.objectContaining({
        objectId: 'issue-1',
        objectClass: 'tracker:class:Issue',
        message: expect.any(String)
      })
    )
    expect(txClient.createMixin).toHaveBeenCalledWith(
      'reply-1',
      chunter.class.ChatMessage,
      'space-1',
      aiBot.mixin.AIBotMessage,
      {
        tools: ['lookup'],
        inputTokens: 5,
        outputTokens: 7
      }
    )
  })

  it('replies to parent chat message when event message is already a thread message', async () => {
    const txClient = createTxClient()
    txClient.findOne.mockResolvedValue({
      _id: 'thread-message-1',
      attachedTo: 'root-message-1',
      attachedToClass: chunter.class.ChatMessage
    })
    const { client } = createWorkspaceClient({ txClient })
    const event = createEvent({
      messageId: 'thread-message-1',
      messageClass: chunter.class.ThreadMessage
    })

    await client.processMessageEvent(createCtx(), event)

    expect(txClient.addCollection).toHaveBeenCalledWith(
      chunter.class.ThreadMessage,
      'space-1',
      'root-message-1',
      chunter.class.ChatMessage,
      'replies',
      expect.objectContaining({
        objectId: 'direct-1',
        objectClass: chunter.class.DirectMessage
      })
    )
  })

  it('appends and saves assistant history after successful LLM response', async () => {
    const { client, memoryStorage } = createWorkspaceClient()

    await client.processMessageEvent(createCtx(), createEvent())

    expect(memoryStorage.pushHistory).toHaveBeenNthCalledWith(
      2,
      personUuid,
      'Assistant response',
      'assistant',
      12,
      personUuid,
      'direct-1',
      chunter.class.DirectMessage
    )
    expect(memoryStorage.saveHistory).toHaveBeenCalledWith(personUuid, expect.any(Object))
  })

  it('does not append assistant history when LLM response is unavailable and sends fallback reply', async () => {
    const llmService = {
      countTokens: jest.fn(() => 99),
      chat: jest.fn(async () => undefined)
    }
    const { client, memoryStorage, txClient } = createWorkspaceClient({ llmService })

    await client.processMessageEvent(createCtx(), createEvent())

    expect(memoryStorage.pushHistory).toHaveBeenCalledTimes(1)
    expect(memoryStorage.saveHistory).not.toHaveBeenCalled()
    expect(txClient.addCollection).toHaveBeenCalledWith(
      chunter.class.ChatMessage,
      'space-1',
      'direct-1',
      chunter.class.DirectMessage,
      'messages',
      expect.objectContaining({ message: expect.any(String) })
    )
  })
})
