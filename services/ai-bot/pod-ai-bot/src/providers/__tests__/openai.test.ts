import OpenAI from 'openai'

import { OpenAIProvider } from '../openai'
import { type ChatMessage, type LLMToolDefinition } from '../types'

jest.mock('openai', () => jest.fn())

const createMock = jest.fn()

const ctx: any = {
  with: jest.fn(async (_name: string, _props: Record<string, unknown>, fn: () => Promise<unknown>) => await fn())
}

describe('OpenAIProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      responses: {
        create: createMock
      }
    }))
  })

  it('converts messages, supported attachments, response text, and usage', async () => {
    createMock.mockResolvedValue({
      output_text: 'done',
      output: [],
      usage: {
        input_tokens: 11,
        output_tokens: 7
      },
      created_at: 12345
    })

    const provider = new OpenAIProvider('key', 'gpt-test', 'https://example.com')
    const messages: ChatMessage[] = [
      { role: 'system', content: 'system one' },
      { role: 'system', content: 'system two' },
      {
        role: 'user',
        content: 'hello',
        attachments: [
          {
            uuid: 'pdf',
            name: 'file.pdf',
            type: 'application/pdf',
            data: Buffer.from('pdf bytes').toString('base64')
          },
          {
            uuid: 'text',
            name: 'notes.md',
            type: 'application/markdown; charset=utf-8',
            data: Buffer.from('# Notes').toString('base64')
          },
          {
            uuid: 'image',
            name: 'image.png',
            type: 'image/png',
            data: Buffer.from('ignored').toString('base64')
          }
        ]
      },
      {
        role: 'assistant',
        content: 'need tool',
        toolCalls: [{ id: 'call-1', name: 'lookup', arguments: '{"q":"x"}' }]
      },
      { role: 'tool', content: 'tool result', toolCallId: 'call-1' }
    ]

    const result = await provider.chatCompletion(ctx, messages, { user: 'user-1', maxTokens: 100 })

    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'key', baseURL: 'https://example.com' })
    expect(createMock).toHaveBeenCalledWith({
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'hello' },
            {
              type: 'input_file',
              filename: 'file.pdf',
              file_data: `data:application/pdf;base64,${Buffer.from('pdf bytes').toString('base64')}`
            },
            {
              type: 'input_text',
              text: '\n\nAttachment "notes.md" (application/markdown):\n# Notes'
            }
          ]
        },
        {
          type: 'message',
          role: 'assistant',
          content: 'need tool'
        },
        {
          type: 'function_call',
          call_id: 'call-1',
          name: 'lookup',
          arguments: '{"q":"x"}'
        },
        {
          type: 'function_call_output',
          call_id: 'call-1',
          output: 'tool result'
        }
      ],
      model: 'gpt-test',
      user: 'user-1',
      instructions: 'system one\nsystem two',
      max_output_tokens: 100,
      store: false,
      stream: false
    })
    expect(result).toEqual({
      text: 'done',
      usage: { inputTokens: 11, outputTokens: 7 },
      created: 12345,
      toolCalls: undefined
    })
  })

  it('converts tools and response function calls', async () => {
    createMock.mockResolvedValue({
      output_text: '',
      output: [
        {
          type: 'function_call',
          call_id: 'call-1',
          name: 'lookup',
          arguments: '{"q":"x"}'
        }
      ],
      usage: {
        input_tokens: 5,
        output_tokens: 3
      },
      created_at: 67890
    })

    const provider = new OpenAIProvider('key', 'gpt-test')
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

    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'key' })
    expect(createMock).toHaveBeenCalledWith({
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'use tool' }]
        }
      ],
      model: 'gpt-test',
      tools: [
        {
          type: 'function',
          name: 'lookup',
          description: 'Lookup data',
          parameters: tools[0].parameters,
          strict: null
        }
      ],
      user: undefined,
      stream: false
    })
    expect(result).toEqual({
      text: undefined,
      usage: { inputTokens: 5, outputTokens: 3 },
      created: 67890,
      toolCalls: [{ id: 'call-1', name: 'lookup', arguments: '{"q":"x"}' }]
    })
  })
})
