import { Type } from 'typebox'

import { createLlmTool } from '../llmTool'

function createProvider (text: string): any {
  return {
    chatCompletion: jest.fn(async () => ({
      text,
      usage: { inputTokens: 1, outputTokens: 2 }
    }))
  }
}

const ctx: any = {}
const toolCtx: any = { ctx }

describe('createLlmTool', () => {
  it('returns string output when no output schema is configured', async () => {
    const provider = createProvider('plain answer')
    const tokenUsage = { addTokenUsage: jest.fn() }
    const tool = createLlmTool({
      name: 'ask_specialist',
      description: 'Ask specialist',
      provider
    })

    const result = await tool.execute({ query: 'question' }, { ...toolCtx, tokenUsage })

    expect(result).toEqual({
      ok: true,
      output: 'plain answer'
    })
    expect(tokenUsage.addTokenUsage).toHaveBeenCalledWith(
      { inputTokens: 1, outputTokens: 2 },
      { tool: 'ask_specialist' }
    )
  })

  it('parses object output when object output schema is configured', async () => {
    const provider = createProvider('{"value":"answer"}')
    const tool = createLlmTool({
      name: 'ask_specialist',
      description: 'Ask specialist',
      outputSchema: Type.Object({
        value: Type.String()
      }),
      provider
    })

    const result = await tool.execute({ query: 'question' }, toolCtx)

    expect(result).toEqual({
      ok: true,
      output: { value: 'answer' }
    })
  })

  it('returns structured error when object output cannot be parsed', async () => {
    const provider = createProvider('plain answer')
    const tokenUsage = { addTokenUsage: jest.fn() }
    const tool = createLlmTool({
      name: 'ask_specialist',
      description: 'Ask specialist',
      outputSchema: Type.Object({
        value: Type.String()
      }),
      provider
    })

    const result = await tool.execute({ query: 'question' }, { ...toolCtx, tokenUsage })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid_tool_output',
        message: 'LLM tool response does not match the configured object output schema.',
        details: { response: 'plain answer' }
      }
    })
    expect(tokenUsage.addTokenUsage).toHaveBeenCalledWith(
      { inputTokens: 1, outputTokens: 2 },
      { tool: 'ask_specialist' }
    )
  })
})
