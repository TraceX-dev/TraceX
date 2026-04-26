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

import { MeasureContext } from '@hcengineering/core'
import { countTokens } from '@hcengineering/openai'

import OpenAI from 'openai'
import { CompletionUsage } from 'openai/resources/completions'
import { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources'
import { encodingForModel, getEncoding, Tiktoken, TiktokenModel } from 'js-tiktoken'

import {
  type LLMProvider,
  type ChatCompletionResult,
  type ChatCompletionOptions,
  type ChatMessage,
  type LLMToolDefinition,
  type TokenUsage
} from './types'

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI
  private readonly model: string
  private readonly encoding: Tiktoken

  constructor (apiKey: string, model: string, baseUrl?: string) {
    this.client = new OpenAI({
      apiKey,
      ...(baseUrl !== undefined && baseUrl !== '' ? { baseURL: baseUrl } : {})
    })
    this.model = model

    this.encoding = (() => {
      try {
        return encodingForModel(model as TiktokenModel)
      } catch {
        return getEncoding('cl100k_base')
      }
    })()
  }

  countTokens (messages: ChatMessage[]): number {
    const openaiMessages = messages.map(toMessage)
    return countTokens(openaiMessages, this.encoding)
  }

  async chatCompletion (
    ctx: MeasureContext,
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const { systemContent, nonSystemMessages } = splitMessages(messages)

    const response = await this.client.chat.completions.create({
      messages: [
        ...(systemContent !== '' ? [{ role: 'system' as const, content: systemContent }] : []),
        ...nonSystemMessages.map(toMessage)
      ],
      model: this.model,
      user: options?.user,
      ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      stream: false
    })

    const text = response.choices?.[0]?.message?.content ?? undefined
    const created = response.created
    const usage = toTokens(response.usage)

    return { text, usage, created }
  }

  async chatCompletionWithTools (
    ctx: MeasureContext,
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const { systemContent, nonSystemMessages } = splitMessages(messages)

    const openaiTools: ChatCompletionTool[] = tools.map(toTool)

    const response = await this.client.chat.completions.create({
      messages: [
        ...(systemContent !== '' ? [{ role: 'system' as const, content: systemContent }] : []),
        ...nonSystemMessages.map(toMessage)
      ],
      model: this.model,
      tools: openaiTools,
      user: options?.user,
      ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      stream: false
    })

    const choice = response.choices?.[0]
    const text = choice?.message?.content ?? undefined
    const created = response.created
    const usage = toTokens(response.usage)

    const toolCalls = choice?.message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments
    }))

    return { text, usage, created, toolCalls }
  }
}

function splitMessages (messages: ChatMessage[]): { systemContent: string, nonSystemMessages: ChatMessage[] } {
  const systemContent = messages
    .filter((it) => it.role === 'system')
    .map((it) => it.content)
    .join('\n')

  const nonSystemMessages = messages.filter((it) => it.role !== 'system')

  return { systemContent, nonSystemMessages }
}

function toTool (tool: LLMToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }
}

function toMessage (message: ChatMessage): ChatCompletionMessageParam {
  const { role, content, toolCallId, toolCalls } = message
  if (role === 'tool') {
    return { role, content, tool_call_id: toolCallId ?? '' }
  }
  if (role === 'assistant' && toolCalls !== undefined && toolCalls.length > 0) {
    return {
      role,
      content,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments
        }
      }))
    }
  }
  return { role, content }
}

function toTokens (usage?: CompletionUsage): TokenUsage {
  if (usage === undefined) {
    return { inputTokens: 0, outputTokens: 0 }
  }
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0
  }
}
