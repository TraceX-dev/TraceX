//
// Copyright © 2024-2025 Hardcore Engineering Inc.
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

import Anthropic from '@anthropic-ai/sdk'
import { MeasureContext } from '@hcengineering/core'
import { getEncoding, Tiktoken } from 'js-tiktoken'

import {
  type LLMProvider,
  type ChatCompletionResult,
  type ChatCompletionOptions,
  type ChatMessage,
  type LLMToolDefinition,
  type TokenUsage
} from './types'

export class AnthropicProvider implements LLMProvider {
  private readonly client: Anthropic
  private readonly model: string
  private readonly encoding: Tiktoken

  constructor (apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey })
    this.model = model
    this.encoding = getEncoding('cl100k_base')
  }

  countTokens (messages: ChatMessage[]): number {
    const tokensPerMessage = 3
    let result = 0

    for (const message of messages) {
      result += tokensPerMessage
      result += this.encoding.encode(message.role).length
      result += this.encoding.encode(message.content).length
    }

    result += 3
    return result
  }

  async chatCompletion (
    ctx: MeasureContext,
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const { systemContent, nonSystemMessages } = splitMessages(messages)

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: systemContent,
      messages: nonSystemMessages.map(toMessage)
    })

    let text: string = ''
    const toolCalls: Array<{ id: string, name: string, arguments: string }> = []

    for (const block of response.content) {
      if (block.type === 'text') {
        text = block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input)
        })
      }
    }

    const usage = toTokens(response.usage)

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage
    }
  }

  async chatCompletionWithTools (
    ctx: MeasureContext,
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const { systemContent, nonSystemMessages } = splitMessages(messages)

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      system: systemContent,
      messages: nonSystemMessages.map(toMessage),
      tools: tools.map(toTool)
    })

    let text: string = ''
    const toolCalls: Array<{ id: string, name: string, arguments: string }> = []

    for (const block of response.content) {
      if (block.type === 'text') {
        text = block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input)
        })
      }
    }

    const usage = toTokens(response.usage)

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage
    }
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

function toTool (tool: LLMToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema
  }
}

function toMessage (message: ChatMessage): Anthropic.MessageParam {
  const { role, content, toolCallId, toolCalls } = message

  if (role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolCallId ?? '',
          content
        }
      ]
    }
  } else if (role === 'assistant') {
    const blocks: Anthropic.ContentBlockParam[] = []
    if (content !== null && content !== '') {
      blocks.push({ type: 'text', text: content })
    }
    if (toolCalls != null) {
      for (const tc of toolCalls) {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: JSON.parse(tc.arguments)
        })
      }
    }
    return { role: 'assistant', content: blocks }
  } else {
    return {
      role: role as 'user' | 'assistant',
      content
    }
  }
}

function toTokens (usage?: Anthropic.Usage): TokenUsage {
  if (usage === undefined) {
    return { inputTokens: 0, outputTokens: 0 }
  }
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
}
