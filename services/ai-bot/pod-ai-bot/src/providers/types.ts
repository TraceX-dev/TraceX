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

import { type MeasureContext } from '@hcengineering/core'

export type ContextMode = 'direct' | 'thread'

export type TokenUsage = number

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: ChatMessageToolCall[]
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
  parameters: Record<string, any>
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

  countTokens: (messages: ChatMessage[]) => number
}
