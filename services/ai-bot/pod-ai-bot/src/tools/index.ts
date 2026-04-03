//
// Copyright © 2026 Hardcore Engineering Inc.
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

import { AccountUuid } from '@hcengineering/core'
import { BaseFunctionsArgs, RunnableToolFunctionWithoutParse, RunnableToolFunctionWithParse, RunnableTools } from 'openai/lib/RunnableFunction'

import { WorkspaceClient } from '../workspace/workspaceClient'
import { ContextMode } from '../providers/types'

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
import { saveFileTool, getDataBeforeImportTool } from './pdf'
import { type Tool } from './types'

const tools: Array<Tool<any>> = []

function registerTool<T extends object | string> (tool: Tool<T>): void {
  tools.push(tool)
}

// Memory

registerTool(getAssistantMemoryTool)
registerTool(updateAssistantMemoryTool)
registerTool(clearAssistantMemoryTool)
registerTool(getUserMemoryTool)
registerTool(updateUserMemoryTool)
registerTool(clearUserMemoryTool)
registerTool(getSharedContextTool)
registerTool(updateSharedContextTool)
registerTool(updateAssistantMemoryTool)
registerTool(clearHistoryTool)

// PDF

registerTool(saveFileTool)
registerTool(getDataBeforeImportTool)

export function getTools (
  workspaceClient: WorkspaceClient,
  contextMode: ContextMode,
  user: AccountUuid | undefined
): RunnableTools<BaseFunctionsArgs> {
  const result: (RunnableToolFunctionWithoutParse | RunnableToolFunctionWithParse<any>)[] = []
  for (const tool of tools) {
    if (tool[2] === contextMode || tool[2] === 'any') {
      const res: RunnableToolFunctionWithoutParse | RunnableToolFunctionWithParse<any> = {
        ...tool[0],
        function: {
          ...tool[0].function,
          function: (args: any) => tool[1](workspaceClient, user, args)
        }
      }
      result.push(res)
    }
  }
  return result
}
