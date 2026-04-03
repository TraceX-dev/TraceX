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

import OpenAI from 'openai'
import {
  type LLMProvider,
  type CompletionRequest,
  type CompletionResponse,
  type Message
} from './types'

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI

  constructor (apiKey: string, baseUrl?: string) {
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl !== undefined && baseUrl !== '' ? { baseURL: baseUrl } : {})
    })
  }

  async chatCompletion (request: CompletionRequest): Promise<CompletionResponse> {
    const messages: OpenAI.ChatCompletionMessageParam[] = []

    if (request.systemPrompt !== undefined && request.systemPrompt !== '') {
      messages.push({ role: 'system', content: request.systemPrompt })
    }

    for (const msg of request.messages) {
      if (msg.role === 'tool') {
        messages.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId ?? ''
        })
      } else if (msg.role === 'assistant' && msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: msg.content ?? null,
          tool_calls: msg.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments
            }
          }))
        })
      } else {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        })
      }
    }

    const tools: OpenAI.ChatCompletionTool[] | undefined =
      request.tools !== undefined && request.tools.length > 0
        ? request.tools.map((t) => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema
          }
        }))
        : undefined

    const response = await this.client.chat.completions.create({
      model: request.model,
      messages,
      tools
    })

    const choice = response.choices[0]
    const toolCalls = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments
    }))

    return {
      content: choice.message.content,
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0
      },
      finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : choice.finish_reason === 'length' ? 'length' : 'stop'
    }
  }
}
