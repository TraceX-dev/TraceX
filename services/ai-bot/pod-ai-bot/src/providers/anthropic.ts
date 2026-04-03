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

import Anthropic from '@anthropic-ai/sdk'
import {
  type LLMProvider,
  type CompletionRequest,
  type CompletionResponse,
  type Message
} from './types'

export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic

  constructor (apiKey: string) {
    this.client = new Anthropic({ apiKey })
  }

  async chatCompletion (request: CompletionRequest): Promise<CompletionResponse> {
    const messages: Anthropic.MessageParam[] = []

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        continue // System prompt handled separately
      }

      if (msg.role === 'tool') {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId ?? '',
              content: msg.content
            }
          ]
        })
      } else if (msg.role === 'assistant' && msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
        const content: Anthropic.ContentBlockParam[] = []
        if (msg.content !== null && msg.content !== '') {
          content.push({ type: 'text', text: msg.content })
        }
        for (const tc of msg.toolCalls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments)
          })
        }
        messages.push({ role: 'assistant', content })
      } else {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })
      }
    }

    const tools: Anthropic.Tool[] | undefined =
      request.tools !== undefined && request.tools.length > 0
        ? request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema as Anthropic.Tool.InputSchema
        }))
        : undefined

    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: 4096,
      system: request.systemPrompt ?? '',
      messages,
      ...(tools !== undefined ? { tools } : {})
    })

    let textContent: string | null = null
    const toolCalls: Array<{ id: string, name: string, arguments: string }> = []

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent = block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input)
        })
      }
    }

    return {
      content: textContent,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      },
      finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : response.stop_reason === 'max_tokens' ? 'length' : 'stop'
    }
  }
}
