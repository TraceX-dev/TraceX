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

import { type Class, type Doc, type Ref, type Space, type MeasureContext } from '@hcengineering/core'
import { type ToolParametersSchema } from '../tools'

export type ContextMode = 'direct' | 'thread'

export interface Context<T extends Doc> {
  mode: ContextMode
  objectId: Ref<T>
  objectClass: Ref<Class<T>>
  objectSpace: Ref<Space>
  objectIsSpace: boolean
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: ChatMessageToolCall[]
  attachments?: ChatMessageAttachment[]
}

export interface ChatMessageReference {
  objectId: string
  objectClass: string
  objectLabel: string
}

export interface ChatMessageAttachment {
  uuid: string
  name: string
  type: string // MIME type
  data: string // base64 encoded data
}

export interface ChatMessageToolCall {
  id: string
  name: string
  arguments: string
}

export interface ChatCompletionResult {
  text?: string
  usage?: TokenUsage
  created?: number
  toolCalls?: ChatMessageToolCall[]
}

export interface ChatCompletionOptions {
  user?: string
  maxTokens?: number
}

export interface LLMToolDefinition {
  name: string
  description: string
  parameters: ToolParametersSchema
}

export interface LLMProvider {
  chatCompletion: (
    ctx: MeasureContext,
    messages: ChatMessage[],
    options?: ChatCompletionOptions
  ) => Promise<ChatCompletionResult>

  chatCompletionWithTools: (
    ctx: MeasureContext,
    messages: ChatMessage[],
    tools: LLMToolDefinition[],
    options?: ChatCompletionOptions
  ) => Promise<ChatCompletionResult>

  countTokens: (message: ChatMessage) => number
}
