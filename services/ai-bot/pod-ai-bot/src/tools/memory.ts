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

import { RegisteredTool, ToolContext } from './types'

export const getAssistantMemoryTool: RegisteredTool = {
  definition: {
    name: 'get_assistant_memory',
    description:
      'Retrieve current memory about yourself (the assistant). Check your name, behavior style, and how you should address the user.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  createExecutor: (toolCtx: ToolContext) => async () => {
    if (toolCtx.user === undefined) return { text: 'No user context available' }
    const history = await toolCtx.memoryStorage.getHistory(toolCtx.user)
    if (history.assistantMemory === '') {
      return { text: 'No assistant memory stored yet.' }
    }
    return { text: `Current assistant memory:\n${history.assistantMemory}` }
  },
  contextMode: 'direct'
}

export const updateAssistantMemoryTool: RegisteredTool = {
  definition: {
    name: 'update_assistant_memory',
    description:
      'Update information about yourself (the assistant). Use this when user tells you how to behave, what name to use, how to address them, or defines your role/personality.',
    parameters: {
      type: 'object',
      properties: {
        memory: {
          type: 'string',
          description:
            'Complete updated memory about yourself (the assistant): your name, behavior style, how to address the user, your role, etc.'
        }
      },
      required: ['memory']
    }
  },
  createExecutor: (toolCtx: ToolContext) => async (args: Record<string, any>) => {
    await toolCtx.memoryStorage.updateAssistantMemory(toolCtx.user, args)
    return { text: 'Assistant memory updated.' }
  },
  contextMode: 'direct'
}

export const clearAssistantMemoryTool: RegisteredTool = {
  definition: {
    name: 'clear_assistant_memory',
    description:
      'Clear all memory about yourself (the assistant). Use only if user explicitly asks to reset your persona.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  createExecutor: (toolCtx: ToolContext) => async () => {
    if (toolCtx.user === undefined) return { text: 'No user context available' }
    await toolCtx.memoryStorage.updateAssistantMemory(toolCtx.user, { memory: '' })
    return { text: 'Assistant memory cleared.' }
  },
  contextMode: 'direct'
}

export const getUserMemoryTool: RegisteredTool = {
  definition: {
    name: 'get_user_memory',
    description: 'Retrieve current memory about the user. Check what information is stored about them.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  createExecutor: (toolCtx: ToolContext) => async () => {
    if (toolCtx.user === undefined) return { text: 'No user context available' }
    const history = await toolCtx.memoryStorage.getHistory(toolCtx.user)
    if (history.userMemory === '') {
      return { text: 'No user memory stored yet.' }
    }
    return { text: `Current user memory:\n${history.userMemory}` }
  },
  contextMode: 'direct'
}

export const updateUserMemoryTool: RegisteredTool = {
  definition: {
    name: 'update_user_memory',
    description:
      'Update information about the user. Use this when user shares personal information, preferences, or context about themselves.',
    parameters: {
      type: 'object',
      properties: {
        memory: {
          type: 'string',
          description:
            'Complete updated memory about the user: their preferences, context, personal info, interests, etc.'
        }
      },
      required: ['memory']
    }
  },
  createExecutor: (toolCtx: ToolContext) => async (args: Record<string, any>) => {
    if (toolCtx.user === undefined) return { text: 'No user context available' }
    await toolCtx.memoryStorage.updateUserMemory(toolCtx.user, args)
    return { text: 'User memory updated' }
  },
  contextMode: 'direct'
}

export const clearUserMemoryTool: RegisteredTool = {
  definition: {
    name: 'clear_user_memory',
    description: 'Clear all memory about the user. Use only if user explicitly asks to forget everything about them.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  createExecutor: (toolCtx: ToolContext) => async () => {
    if (toolCtx.user === undefined) return { text: 'No user context available' }
    await toolCtx.memoryStorage.updateUserMemory(toolCtx.user, { memory: '' })
    return { text: 'User memory cleared.' }
  },
  contextMode: 'direct'
}

export const getSharedContextTool: RegisteredTool = {
  definition: {
    name: 'get_shared_context',
    description: 'Retrieve current shared context. Check language preference, timezone, or other general settings.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  createExecutor: (toolCtx: ToolContext) => async () => {
    if (toolCtx.user === undefined) return { text: 'No user context available' }
    const history = await toolCtx.memoryStorage.getHistory(toolCtx.user)
    if (history.sharedContext === '') {
      return { text: 'No shared context stored yet.' }
    }
    return { text: `Current shared context memory:\n${history.sharedContext}` }
  },
  contextMode: 'any'
}

export const updateSharedContextTool: RegisteredTool = {
  definition: {
    name: 'update_shared_context',
    description:
      'Update shared context that can be used in both direct and group chats. Use for preferences that apply to group chats (like how to address user in public), language, timezone, or public settings.',
    parameters: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description:
            'Complete updated shared context: language preference, timezone, general non-personal settings, etc.'
        }
      },
      required: ['context']
    }
  },
  createExecutor: (toolCtx: ToolContext) => async (args: Record<string, any>) => {
    if (toolCtx.user === undefined) return { text: 'No shared context available' }
    await toolCtx.memoryStorage.updateSharedContext(toolCtx.user, args)
    return { text: 'Shared context memory updated' }
  },
  contextMode: 'direct'
}

export const clearHistoryTool: RegisteredTool = {
  definition: {
    name: 'clear_history',
    description:
      'Clear conversation history. Use when user asks to clear/forget the conversation history or start fresh. This removes all previous messages but keeps assistant and user memory.',
    parameters: {
      type: 'object',
      properties: {}
    }
  },
  createExecutor: (toolCtx: ToolContext) => async () => {
    if (toolCtx.user === undefined) return { text: 'No shared context available' }
    await toolCtx.memoryStorage.clearHistory(toolCtx.user)
    return { text: 'Conversation history has been cleared. Starting fresh conversation.' }
  },
  contextMode: 'direct'
}
