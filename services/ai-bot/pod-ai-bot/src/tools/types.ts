//
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

import {
  AccountUuid,
  Class,
  Doc,
  MeasureContext,
  Ref,
  Space,
  TxOperations,
  type WorkspaceIds
} from '@hcengineering/core'
import { StorageAdapter } from '@hcengineering/server-core'
import {
  type PlatformContext,
  type Tool,
  type ToolInputSchema,
  type ToolMetadata as CoreToolMetadata,
  type ToolOutputSchema
} from '@hcengineering/ai-core'
import { ContextMode, type TokenUsage } from '../providers/types'
import { MemoryStorage } from '../storage'

export type AIBotTool = Tool<ToolInputSchema, ToolOutputSchema, AIBotToolContext, CoreToolMetadata>

export interface AIBotToolMetadata {
  contextMode: ContextMode | 'any'
}

export type ToolMetadata = AIBotToolMetadata

export interface ToolTokenUsageCollector {
  addTokenUsage: (usage: TokenUsage, details: { tool: string }) => void
}

export interface AIBotToolContext extends PlatformContext {
  memoryStorage: MemoryStorage
  user: AccountUuid
  workspaceOps: WorkspaceOps
  objectId?: Ref<Doc>
  objectClass?: Ref<Class<Doc>>
  objectSpace?: Ref<Space>
  tokenUsage?: ToolTokenUsageCollector
}

export type ToolContext = AIBotToolContext

// export type ToolInputSchema = TObject
// export type ToolOutputSchema = TObject | TString

// export interface ToolDefinition<TOutputSchema extends ToolOutputSchema | undefined = ToolOutputSchema | undefined> {
//   // Tool name for LLM
//   name: string
//   // Tool description for LLM
//   description: string
//   // Tool input arguments schema
//   inputSchema: ToolInputSchema
//   // Tool successful output schema. Omit for string/text output.
//   outputSchema?: TOutputSchema
// }

// export type ToolExecutorOutput<TOutputSchema extends ToolOutputSchema | undefined = ToolOutputSchema | undefined> =
//   TOutputSchema extends ToolOutputSchema ? Static<TOutputSchema> : string

// export type ToolExecutorError = string
// export interface ToolExecutionError {
//   code: string
//   message: string
//   details?: unknown
//   retryable?: boolean
// }

// export type ToolExecutorResult<TOutputSchema extends ToolOutputSchema | undefined = ToolOutputSchema | undefined> =
//   | {
//     ok: true
//     output: ToolExecutorOutput<TOutputSchema>
//     usage?: TokenUsage
//   }
//   | {
//     ok: false
//     error: ToolExecutionError
//     usage?: TokenUsage
//   }

// export type ToolExecutor<TOutputSchema extends ToolOutputSchema | undefined = ToolOutputSchema | undefined> = (
//   args: any
// ) => Promise<ToolExecutorResult<TOutputSchema>>

// export function toolOk<TOutputSchema extends ToolOutputSchema | undefined = undefined> (
//   output: ToolExecutorOutput<TOutputSchema>,
//   usage?: TokenUsage
// ): ToolExecutorResult<TOutputSchema> {
//   return {
//     ok: true,
//     output,
//     ...(usage !== undefined ? { usage } : {})
//   }
// }

// export function toolFail<TOutputSchema extends ToolOutputSchema | undefined = ToolOutputSchema | undefined> (
//   message: string,
//   code: string = 'tool_error',
//   options?: { details?: unknown, retryable?: boolean, usage?: TokenUsage }
// ): ToolExecutorResult<TOutputSchema> {
//   return {
//     ok: false,
//     error: {
//       code,
//       message,
//       ...(options?.details !== undefined ? { details: options.details } : {}),
//       ...(options?.retryable !== undefined ? { retryable: options.retryable } : {})
//     },
//     ...(options?.usage !== undefined ? { usage: options.usage } : {})
//   }
// }

export interface WorkspaceOps {
  storage: StorageAdapter
  ctx: MeasureContext
  wsIds: WorkspaceIds
  getClient: () => Promise<TxOperations>
}

// export interface RegisteredTool<TOutputSchema extends ToolOutputSchema | undefined = ToolOutputSchema | undefined> {
//   definition: ToolDefinition<TOutputSchema>
//   createExecutor: (toolCtx: ToolContext) => ToolExecutor<TOutputSchema>
//   contextMode: ContextMode | 'any'
// }
