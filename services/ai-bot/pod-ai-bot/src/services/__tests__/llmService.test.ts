import { type PersonMessage } from '@hcengineering/ai-bot'

import { DefaultLLMService } from '../llmService'
import { type ChatCompletionResult, type ChatMessage, type LLMProvider } from '../../providers/types'
import { pushTokensData } from '../../billing'

let mockTools: any[] = []

jest.mock('../../tools', () => ({
  getTools: jest.fn(() => mockTools)
}))

jest.mock('../../billing', () => ({
  pushTokensData: jest.fn()
}))

const workspace = '00000000-0000-4000-8000-000000000001' as any

function createCtx (): any {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }
}

function createToolCtx (): any {
  return {
    workspace,
    user: 'user-1',
    memoryStorage: {},
    collaborator: {},
    workspaceOps: {}
  }
}

function createProvider (): LLMProvider & {
  chatCompletion: jest.Mock<Promise<ChatCompletionResult>, any>
  chatCompletionWithTools: jest.Mock<Promise<ChatCompletionResult>, any>
  countTokens: jest.Mock<number, any>
} {
  return {
    chatCompletion: jest.fn(),
    chatCompletionWithTools: jest.fn(),
    countTokens: jest.fn((message: ChatMessage) => message.content.length)
  }
}

describe('DefaultLLMService', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockTools = []
  })

  it('translateHtml sends translate prompt and user HTML', async () => {
    const provider = createProvider()
    provider.chatCompletion.mockResolvedValue({
      text: '<p>Hola</p>',
      usage: { inputTokens: 10, outputTokens: 3 },
      created: 100
    })
    const service = new DefaultLLMService(provider, { maxToolRounds: 3 })

    const result = await service.translateHtml(createCtx(), workspace, '<p>Hello</p>', 'es')

    expect(provider.chatCompletion).toHaveBeenCalledWith(expect.anything(), [
      {
        role: 'system',
        content: expect.stringContaining('Translate the text into es')
      },
      { role: 'user', content: '<p>Hello</p>' }
    ])
    expect(result).toEqual({
      text: '<p>Hola</p>',
      usage: { inputTokens: 10, outputTokens: 3 }
    })
    expect(pushTokensData).toHaveBeenCalledWith(expect.anything(), [
      {
        workspace,
        reason: 'manual-translate',
        inputTokens: 10,
        outputTokens: 3,
        date: '1970-01-01T00:01:40.000Z'
      }
    ])
  })

  it('translateHtml returns undefined text when provider returns no text', async () => {
    const provider = createProvider()
    provider.chatCompletion.mockResolvedValue({
      usage: { inputTokens: 0, outputTokens: 0 }
    })
    const service = new DefaultLLMService(provider, { maxToolRounds: 3 })

    await expect(service.translateHtml(createCtx(), workspace, '<p>Hello</p>', 'es')).resolves.toEqual({
      text: undefined,
      usage: { inputTokens: 0, outputTokens: 0 }
    })
  })

  it('summarizeMessages builds participant content and rewrites participant references', async () => {
    const provider = createProvider()
    provider.chatCompletion.mockResolvedValue({
      text: '**@Alice**\n- First point\n**@Bob**\n- Second point',
      usage: { inputTokens: 20, outputTokens: 7 },
      created: 200
    })
    const service = new DefaultLLMService(provider, { maxToolRounds: 3 })
    const messages: PersonMessage[] = [
      { personRef: 'person-alice' as any, personName: 'Alice', text: 'First message', time: 1 },
      { personRef: 'person-bob' as any, personName: 'Bob', text: 'Second message', time: 2 }
    ]

    const result = await service.summarizeMessages(createCtx(), workspace, messages, 'en')

    expect(provider.chatCompletion).toHaveBeenCalledWith(expect.anything(), [
      {
        role: 'system',
        content: expect.stringContaining('Generate a summary')
      },
      {
        role: 'user',
        content: '---\n\n@Alice\nFirst message\n\n---\n\n@Bob\nSecond message'
      }
    ])
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 7 })
    expect(result.text).toContain('_id=person-alice')
    expect(result.text).toContain('label=Alice')
    expect(result.text).toContain('_id=person-bob')
    expect(result.text).not.toContain('**@Alice**')
  })

  it('chat handles plain completion and strips text before think close tag', async () => {
    const provider = createProvider()
    provider.chatCompletionWithTools.mockResolvedValue({
      text: '<think>hidden</think>visible',
      usage: { inputTokens: 3, outputTokens: 4 }
    })
    const service = new DefaultLLMService(provider, { maxToolRounds: 3 })

    const result = await service.chat(
      createCtx(),
      workspace,
      [{ role: 'user', content: 'Hello' }],
      'direct',
      'assistant memory',
      'user memory',
      'shared context',
      createToolCtx(),
      { user: 'user-1' }
    )

    expect(provider.chatCompletionWithTools).toHaveBeenCalledWith(
      expect.anything(),
      [
        {
          role: 'system',
          content: expect.stringContaining('assistant memory')
        },
        { role: 'user', content: 'Hello' }
      ],
      [],
      { user: 'user-1' }
    )
    expect(result).toEqual({
      completion: 'visible',
      usage: { inputTokens: 3, outputTokens: 4 },
      tools: []
    })
  })

  it('chat handles tool-call rounds and accumulates provider and tool usage', async () => {
    const executor = jest.fn(async (args: any) => ({
      text: `value:${args.q}`,
      usage: { inputTokens: 4, outputTokens: 5 }
    }))
    mockTools = [
      {
        contextMode: 'any',
        definition: {
          name: 'lookup',
          description: 'Lookup data',
          parameters: { type: 'object', properties: { q: { type: 'string' } } }
        },
        createExecutor: () => executor
      }
    ]

    const provider = createProvider()
    provider.chatCompletionWithTools
      .mockResolvedValueOnce({
        text: 'tool please',
        toolCalls: [{ id: 'call-1', name: 'lookup', arguments: '{"q":"x"}' }],
        usage: { inputTokens: 1, outputTokens: 1 }
      })
      .mockResolvedValueOnce({
        text: 'done',
        usage: { inputTokens: 2, outputTokens: 3 }
      })
    const service = new DefaultLLMService(provider, { maxToolRounds: 3 })

    const ctx = createCtx()
    const result = await service.chat(
      ctx,
      workspace,
      [{ role: 'user', content: 'Use a tool' }],
      'thread',
      '',
      '',
      'shared context',
      createToolCtx()
    )

    expect(executor).toHaveBeenCalledWith({ q: 'x' })
    expect(provider.chatCompletionWithTools).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.arrayContaining([
        {
          role: 'assistant',
          content: 'tool please',
          toolCalls: [{ id: 'call-1', name: 'lookup', arguments: '{"q":"x"}' }]
        },
        {
          role: 'tool',
          content: 'value:x',
          toolCallId: 'call-1'
        }
      ]),
      expect.any(Array),
      undefined
    )
    expect(result).toEqual({
      completion: 'done',
      usage: { inputTokens: 7, outputTokens: 9 },
      tools: ['lookup']
    })
  })

  it('chat handles unknown tool names', async () => {
    const ctx = createCtx()
    const provider = createProvider()
    provider.chatCompletionWithTools
      .mockResolvedValueOnce({
        toolCalls: [{ id: 'call-1', name: 'missing', arguments: '{}' }],
        usage: { inputTokens: 1, outputTokens: 1 }
      })
      .mockResolvedValueOnce({
        text: 'done',
        usage: { inputTokens: 2, outputTokens: 3 }
      })
    const service = new DefaultLLMService(provider, { maxToolRounds: 3 })

    const result = await service.chat(
      ctx,
      workspace,
      [{ role: 'user', content: 'Use a tool' }],
      'direct',
      '',
      '',
      '',
      createToolCtx()
    )

    expect(ctx.warn).toHaveBeenCalledWith('Unknown tool requested by LLM', { workspace, tool: 'missing' })
    expect(provider.chatCompletionWithTools).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.arrayContaining([
        {
          role: 'tool',
          content: 'Error: Unknown tool: missing',
          toolCallId: 'call-1'
        }
      ]),
      [],
      undefined
    )
    expect(result?.tools).toEqual(['missing'])
  })

  it('chat handles malformed tool arguments', async () => {
    const ctx = createCtx()
    const executor = jest.fn()
    mockTools = [
      {
        contextMode: 'any',
        definition: {
          name: 'lookup',
          description: 'Lookup data',
          parameters: { type: 'object' }
        },
        createExecutor: () => executor
      }
    ]
    const provider = createProvider()
    provider.chatCompletionWithTools
      .mockResolvedValueOnce({
        toolCalls: [{ id: 'call-1', name: 'lookup', arguments: '{bad json' }],
        usage: { inputTokens: 1, outputTokens: 1 }
      })
      .mockResolvedValueOnce({
        text: 'done',
        usage: { inputTokens: 2, outputTokens: 3 }
      })
    const service = new DefaultLLMService(provider, { maxToolRounds: 3 })

    const result = await service.chat(
      ctx,
      workspace,
      [{ role: 'user', content: 'Use a tool' }],
      'direct',
      '',
      '',
      '',
      createToolCtx()
    )

    expect(executor).not.toHaveBeenCalled()
    expect(ctx.error).toHaveBeenCalledWith(
      'Tool execution failed',
      expect.objectContaining({ workspace, tool: 'lookup' })
    )
    expect(provider.chatCompletionWithTools).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          content: expect.stringContaining('Error: Error executing tool:')
        })
      ]),
      expect.any(Array),
      undefined
    )
    expect(result?.tools).toEqual(['lookup'])
  })

  it('chat performs final non-tool completion after max tool rounds', async () => {
    mockTools = [
      {
        contextMode: 'any',
        definition: {
          name: 'lookup',
          description: 'Lookup data',
          parameters: { type: 'object' }
        },
        createExecutor: () => async () => ({ text: 'tool result' })
      }
    ]
    const provider = createProvider()
    provider.chatCompletionWithTools.mockResolvedValue({
      toolCalls: [{ id: 'call-1', name: 'lookup', arguments: '{}' }],
      usage: { inputTokens: 1, outputTokens: 2 }
    })
    provider.chatCompletion.mockResolvedValue({
      text: 'final',
      usage: { inputTokens: 3, outputTokens: 4 }
    })
    const service = new DefaultLLMService(provider, { maxToolRounds: 1 })

    const result = await service.chat(
      createCtx(),
      workspace,
      [{ role: 'user', content: 'Use a tool' }],
      'direct',
      '',
      '',
      '',
      createToolCtx()
    )

    expect(provider.chatCompletion).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        {
          role: 'tool',
          content: 'tool result',
          toolCallId: 'call-1'
        }
      ]),
      undefined
    )
    expect(result).toEqual({
      completion: 'final',
      usage: { inputTokens: 4, outputTokens: 6 },
      tools: ['lookup']
    })
  })
})
