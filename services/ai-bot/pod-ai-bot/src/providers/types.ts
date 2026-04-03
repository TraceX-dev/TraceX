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

export type ContextMode = 'direct' | 'thread'

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  toolCalls?: ToolCall[]
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface CompletionRequest {
  messages: Message[]
  tools?: ToolDefinition[]
  model: string
  systemPrompt?: string
}

export interface CompletionResponse {
  content: string | null
  toolCalls: ToolCall[]
  usage: { inputTokens: number, outputTokens: number }
  finishReason: 'stop' | 'tool_calls' | 'length'
}

export interface LLMProvider {
  chatCompletion: (request: CompletionRequest) => Promise<CompletionResponse>
}
