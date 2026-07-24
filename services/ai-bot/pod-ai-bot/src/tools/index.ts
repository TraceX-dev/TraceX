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
  getAssistantMemoryTool,
  getSharedContextTool,
  getUserMemoryTool,
  updateAssistantMemoryTool,
  updateSharedContextTool,
  updateUserMemoryTool,
  clearAssistantMemoryTool,
  clearHistoryTool,
  clearUserMemoryTool
} from './memory'
import { readObjectContentTool, readReferencedObjectContentTool } from './document'
import { saveFileTool, getDataBeforeImportTool } from './pdf'
import { type AIBotTool } from './types'

import { ContextMode } from '../providers'

export * from './types'

const dynamicTools: AIBotTool[] = []

export function registerLlmTools (tools: AIBotTool[]): void {
  dynamicTools.push(...tools)
}

const registeredTools: AIBotTool[] = [
  // Assistant Memory
  getAssistantMemoryTool,
  updateAssistantMemoryTool,
  clearAssistantMemoryTool,

  // User Memory
  getUserMemoryTool,
  updateUserMemoryTool,
  clearUserMemoryTool,

  // Shared Context
  getSharedContextTool,
  updateSharedContextTool,

  // History
  clearHistoryTool,

  // PDF
  saveFileTool,
  getDataBeforeImportTool,

  // Context Object
  readObjectContentTool,
  readReferencedObjectContentTool
]

export function getRegisteredTools (): AIBotTool[] {
  return [...registeredTools, ...dynamicTools]
}

export function getTools (contextMode: ContextMode): AIBotTool[] {
  const tools = getRegisteredTools()
  return tools.filter((t) => {
    const toolContextMode = t.metadata?.contextMode
    return toolContextMode === contextMode || toolContextMode === 'any'
  })
}
