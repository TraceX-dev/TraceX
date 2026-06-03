import Anthropic from '@anthropic-ai/sdk'

import { AnthropicProvider } from '../anthropic'
import { type ChatMessage, type LLMToolDefinition } from '../types'

jest.mock('@anthropic-ai/sdk', () => jest.fn())

const createMock = jest.fn()
const ctx: any = {}

describe('AnthropicProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(Anthropic as unknown as jest.Mock).mockImplementation(() => ({
      messages: {
        create: createMock
      }
    }))
  })

  it('converts messages, response text, tool calls, and usage', async () => {
    createMock.mockResolvedValue({
      content: [
        { type: 'text', text: 'done' },
        { type: 'tool_use', id: 'toolu-1', name: 'lookup', input: { q: 'x' } }
      ],
      usage: {
        input_tokens: 13,
        output_tokens: 8
      }
    })

    const provider = new AnthropicProvider('key', 'claude-test')
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system one' },
      { role: 'system', content: 'system two' },
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: 'need tool',
        toolCalls: [{ id: 'toolu-1', name: 'lookup', arguments: '{"q":"x"}' }]
      },
      { role: 'tool', content: 'tool result', toolCallId: 'toolu-1' }
    ]

    const result = await provider.chatCompletion(ctx, messages, { maxTokens: 200 })

    expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'key' })
    expect(createMock).toHaveBeenCalledWith({
      model: 'claude-test',
      max_tokens: 200,
      system: 'system one\nsystem two',
      messages: [
        {
          role: 'user',
          content: 'hello'
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'need tool' },
            {
              type: 'tool_use',
              id: 'toolu-1',
              name: 'lookup',
              input: { q: 'x' }
            }
          ]
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu-1',
              content: 'tool result'
            }
          ]
        }
      ]
    })
    expect(result).toEqual({
      text: 'done',
      usage: { inputTokens: 13, outputTokens: 8 },
      toolCalls: [{ id: 'toolu-1', name: 'lookup', arguments: '{"q":"x"}' }]
    })
  })

  it('converts tool definitions for tool-capable completions', async () => {
    createMock.mockResolvedValue({
      content: [],
      usage: undefined
    })

    const provider = new AnthropicProvider('key', 'claude-test')
    const tools: LLMToolDefinition[] = [
      {
        name: 'lookup',
        description: 'Lookup data',
        parameters: {
          type: 'object',
          properties: { q: { type: 'string' } },
          required: ['q']
        }
      }
    ]

    const result = await provider.chatCompletionWithTools(ctx, [{ role: 'user', content: 'use tool' }], tools)

    expect(createMock).toHaveBeenCalledWith({
      model: 'claude-test',
      max_tokens: 4096,
      system: '',
      messages: [
        {
          role: 'user',
          content: 'use tool'
        }
      ],
      tools: [
        {
          name: 'lookup',
          description: 'Lookup data',
          input_schema: tools[0].parameters
        }
      ]
    })
    expect(result).toEqual({
      text: '',
      usage: { inputTokens: 0, outputTokens: 0 },
      toolCalls: undefined
    })
  })
})
