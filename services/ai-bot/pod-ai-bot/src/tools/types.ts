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

import { AccountUuid, Class, Doc, Ref, Space, type WorkspaceIds } from '@hcengineering/core'
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
  wsIds: WorkspaceIds
  objectId?: Ref<Doc>
  objectClass?: Ref<Class<Doc>>
  objectSpace?: Ref<Space>
  tokenUsage?: ToolTokenUsageCollector
}

export type ToolContext = AIBotToolContext
