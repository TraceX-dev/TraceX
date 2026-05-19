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
  WorkspaceUuid,
  type WorkspaceIds
} from '@hcengineering/core'
import { StorageAdapter } from '@hcengineering/server-core'
import { ContextMode, type TokenUsage } from '../providers/types'
import { MemoryStorage } from '../storage'
import { CollaboratorClient } from '@hcengineering/collaborator-client'

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, any>
}

export interface ToolExecutorResult {
  text: string
  usage?: TokenUsage
}

export type ToolExecutor = (args: any) => Promise<ToolExecutorResult>

export interface WorkspaceOps {
  storage: StorageAdapter
  ctx: MeasureContext
  wsIds: WorkspaceIds
  getClient: () => Promise<TxOperations>
}

export interface ToolContext {
  memoryStorage: MemoryStorage
  collaborator: CollaboratorClient
  user: AccountUuid | undefined
  workspace: WorkspaceUuid
  workspaceOps?: WorkspaceOps
  objectId?: Ref<Doc>
  objectClass?: Ref<Class<Doc>>
  objectSpace?: Ref<Space>
}

export interface RegisteredTool {
  definition: ToolDefinition
  createExecutor: (toolCtx: ToolContext) => ToolExecutor
  contextMode: ContextMode | 'any'
}
