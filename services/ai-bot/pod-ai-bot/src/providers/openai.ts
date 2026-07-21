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

import { MeasureContext } from '@hcengineering/core'
import { countResponseItemTokens } from '@hcengineering/openai'

import OpenAI from 'openai'
import {
  type EasyInputMessage,
  type FunctionTool,
  type Response,
  type ResponseCreateParamsNonStreaming,
  type ResponseFunctionToolCall,
  type ResponseInputContent,
  type ResponseInputItem,
  type ResponseUsage
} from 'openai/resources/responses/responses'
import { encodingForModel, getEncoding, Tiktoken, TiktokenModel } from 'js-tiktoken'

import {
  type LLMProvider,
  type ChatCompletionResult,
  type ChatCompletionOptions,
  type ChatMessage,
  type ChatMessageAttachment,
  type LLMToolDefinition,
  type TokenUsage
} from './types'

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI
  private readonly model: string
  private readonly encoding: Tiktoken

  constructor (apiKey: string, model: string, baseUrl?: string) {
    this.client =
      baseUrl !== undefined && baseUrl !== '' ? new OpenAI({ apiKey, baseURL: baseUrl }) : new OpenAI({ apiKey })
    this.model = model

    this.encoding = (() => {
      try {
        return encodingForModel(model as TiktokenModel)
      } catch {
        return getEncoding('cl100k_base')
      }
    })()
  }

  countTokens (message: ChatMessage): number {
    const openaiMessages = toResponseInputItems(message)
    return countResponseItemTokens(openaiMessages, this.encoding)
  }

  async chatCompletion (
    ctx: MeasureContext,
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const { systemContent, nonSystemMessages } = splitMessages(messages)

    const body: ResponseCreateParamsNonStreaming = {
      input: nonSystemMessages.flatMap(toResponseInputItems),
      model: this.model,
      user: options?.user,
      ...(systemContent !== '' ? { instructions: systemContent } : {}),
      ...(options?.maxTokens !== undefined ? { max_output_tokens: options.maxTokens } : {}),
      store: false,
      stream: false
    }

    const response = await ctx.with('responses.create', {}, () => this.client.responses.create(body))
    return toChatCompletionResult(response)
  }

  async chatCompletionWithTools (
    ctx: MeasureContext,
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
    options?: ChatCompletionOptions
  ): Promise<ChatCompletionResult> {
    const { systemContent, nonSystemMessages } = splitMessages(messages)

    const body: ResponseCreateParamsNonStreaming = {
      input: nonSystemMessages.flatMap(toResponseInputItems),
      model: this.model,
      tools: tools.map(toFunctionTool),
      user: options?.user,
      ...(systemContent !== '' ? { instructions: systemContent } : {}),
      ...(options?.maxTokens !== undefined ? { max_output_tokens: options.maxTokens } : {}),
      stream: false
    }

    const response = await ctx.with('responses.create', {}, () => this.client.responses.create(body))
    return toChatCompletionResult(response)
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

function toFunctionTool (tool: LLMToolDefinition): FunctionTool {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as unknown as { [key: string]: unknown },
    strict: null
  }
}

function toResponseInputItems (message: ChatMessage): ResponseInputItem[] {
  const { role, content, toolCallId, toolCalls } = message

  if (role === 'tool') {
    return [
      {
        type: 'function_call_output',
        call_id: toolCallId ?? '',
        output: content
      }
    ]
  }

  if (role === 'assistant' && toolCalls !== undefined && toolCalls.length > 0) {
    const result: ResponseInputItem[] = []
    if (content !== '') {
      result.push({
        type: 'message',
        role,
        content
      } satisfies EasyInputMessage)
    }

    for (const tc of toolCalls) {
      result.push({
        type: 'function_call',
        call_id: tc.id,
        name: tc.name,
        arguments: tc.arguments
      })
    }

    return result
  }

  const inputFiles: ResponseInputContent[] = []
  if (role === 'user' && message.attachments !== undefined && message.attachments.length > 0) {
    for (const attachment of message.attachments) {
      const attachmentContent = toAttachmentContent(attachment)
      if (attachmentContent != null) {
        inputFiles.push(attachmentContent)
      }
    }
  }

  return [
    {
      type: 'message',
      role: role as 'user' | 'assistant' | 'system',
      content: [{ type: 'input_text', text: content }, ...inputFiles]
    } satisfies EasyInputMessage
  ]
}

function toAttachmentContent (attachment: ChatMessageAttachment): ResponseInputContent | null {
  const type = normalizeMimeType(attachment.type)
  if (type === 'application/pdf') {
    return {
      type: 'input_file',
      filename: attachment.name,
      file_data: toFileData(type, attachment.data)
    }
  }

  if (isTextLike(type)) {
    return {
      type: 'input_text',
      text: `\n\nAttachment "${attachment.name}" (${type}):\n${Buffer.from(attachment.data, 'base64').toString('utf8')}`
    }
  }

  return null
}

function normalizeMimeType (type: string | undefined): string {
  return (type ?? '').split(';')[0].trim().toLowerCase()
}

function isTextLike (type: string): boolean {
  return (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/markdown' ||
    type === 'application/x-markdown'
  )
}

function toFileData (type: string, data: string): string {
  if (data.startsWith('data:')) {
    return data
  }

  return `data:${type};base64,${data}`
}

function toChatCompletionResult (response: Response): ChatCompletionResult {
  const toolCalls = response.output
    .filter((item): item is ResponseFunctionToolCall => item.type === 'function_call')
    .map((item) => ({
      id: item.call_id,
      name: item.name,
      arguments: item.arguments
    }))

  return {
    text: response.output_text !== '' ? response.output_text : undefined,
    usage: toTokenUsage(response.usage),
    created: response.created_at,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined
  }
}

function toTokenUsage (usage?: ResponseUsage): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0
  }
}
