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
import { WorkspaceClient } from '../workspace/workspaceClient'
import { Tool } from './types'

// Assistant memory tools

export const getAssistantMemoryTool: Tool<string> = [
  {
    type: 'function',
    function: {
      name: 'get_assistant_memory',
      parameters: {
        type: 'object',
        properties: {}
      },
      description:
        'Retrieve current memory about yourself (the assistant). Check your name, behavior style, and how you should address the user.'
    }
  },
  getAssistantMemory,
  'direct'
]

export const updateAssistantMemoryTool: Tool<object> = [
  {
    type: 'function',
    function: {
      name: 'update_assistant_memory',
      parse: JSON.parse,
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
      },
      description:
        'Update information about yourself (the assistant). Use this when user tells you how to behave, what name to use, how to address them, or defines your role/personality.'
    }
  },
  updateAssistantMemory,
  'direct'
]

export const clearAssistantMemoryTool: Tool<string> = [
  {
    type: 'function',
    function: {
      name: 'clear_assistant_memory',
      parameters: {
        type: 'object',
        properties: {}
      },
      description:
        'Clear all memory about yourself (the assistant). Use only if user explicitly asks to reset your persona.'
    }
  },
  clearAssistantMemory,
  'direct'
]

// User memory tools

export const getUserMemoryTool: Tool<string> = [
  {
    type: 'function',
    function: {
      name: 'get_user_memory',
      parameters: {
        type: 'object',
        properties: {}
      },
      description: 'Retrieve current memory about the user. Check what information is stored about them.'
    }
  },
  getUserMemory,
  'direct'
]

export const updateUserMemoryTool: Tool<object> = [
  {
    type: 'function',
    function: {
      name: 'update_user_memory',
      parse: JSON.parse,
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
      },
      description:
        'Update information about the user. Use this when user shares personal information, preferences, or context about themselves.'
    }
  },
  updateUserMemory,
  'direct'
]

export const clearUserMemoryTool: Tool<string> = [
  {
    type: 'function',
    function: {
      name: 'clear_user_memory',
      parameters: {
        type: 'object',
        properties: {}
      },
      description: 'Clear all memory about the user. Use only if user explicitly asks to forget everything about them.'
    }
  },
  clearUserMemory,
  'direct'
]

// Shared context tools

export const getSharedContextTool: Tool<string> = [
  {
    type: 'function',
    function: {
      name: 'get_shared_context',
      parameters: {
        type: 'object',
        properties: {}
      },
      description: 'Retrieve current shared context. Check language preference, timezone, or other general settings.'
    }
  },
  getSharedContext,
  'any'
]

export const updateSharedContextTool: Tool<object> = [
  {
    type: 'function',
    function: {
      name: 'update_shared_context',
      parse: JSON.parse,
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
      },
      description:
        'Update shared context that can be used in both direct and group chats. Use for preferences that apply to group chats (like how to address user in public), language, timezone, or public settings.'
    }
  },
  updateSharedContext,
  'direct'
]

export const clearHistoryTool: Tool<string> = [
  {
    type: 'function',
    function: {
      name: 'clear_history',
      parameters: {
        type: 'object',
        properties: {}
      },
      description:
        'Clear conversation history. Use when user asks to clear/forget the conversation history or start fresh. This removes all previous messages but keeps assistant and user memory.'
    }
  },
  clearHistory,
  'direct'
]

// Tools implementation

async function getAssistantMemory (
  workspaceClient: WorkspaceClient,
  user: AccountUuid | undefined,
  args: Record<string, any>
): Promise<string> {
  if (user === undefined) return 'No user context available'

  const history = await workspaceClient.getHistory(user)
  if (history.assistantMemory === '') {
    return 'No assistant memory stored yet.'
  }
  return `Current assistant memory:\n${history.assistantMemory}`
}

async function updateAssistantMemory (
  workspaceClient: WorkspaceClient,
  user: AccountUuid | undefined,
  args: Record<string, any>
): Promise<string> {
  // console.log('Update assistant memory', args)
  await workspaceClient.updateAssistantMemory(user, args)
  return 'Assistant memory updated.'
}

async function clearAssistantMemory (
  workspaceClient: WorkspaceClient,
  user: AccountUuid | undefined,
  args: Record<string, any>
): Promise<string> {
  if (user === undefined) return 'No user context available'
  await workspaceClient.updateAssistantMemory(user, { memory: '' })
  return 'Assistant memory cleared.'
}

async function getUserMemory (
  workspaceClient: WorkspaceClient,
  user: AccountUuid | undefined,
  args: Record<string, any>
): Promise<string> {
  if (user === undefined) return 'No user context available'

  const history = await workspaceClient.getHistory(user)
  if (history.userMemory === '') {
    return 'No user memory stored yet.'
  }
  return `Current user memory:\n${history.userMemory}`
}

async function updateUserMemory (
  workspaceClient: WorkspaceClient,
  user: AccountUuid | undefined,
  args: Record<string, any>
): Promise<string> {
  if (user === undefined) return 'No user context available'
  await workspaceClient.updateUserMemory(user, args)
  return 'User memory updated'
}

async function clearUserMemory (
  workspaceClient: WorkspaceClient,
  user: AccountUuid | undefined,
  args: Record<string, any>
): Promise<string> {
  if (user === undefined) return 'No user context available'
  await workspaceClient.updateUserMemory(user, { memory: '' })
  return 'User memory cleared.'
}

async function getSharedContext (
  workspaceClient: WorkspaceClient,
  user: AccountUuid | undefined,
  args: Record<string, any>
): Promise<string> {
  if (user === undefined) return 'No user context available'

  const history = await workspaceClient.getHistory(user)
  if (history.sharedContext === '') {
    return 'No shared context stored yet.'
  }
  return `Current shared context memory:\n${history.sharedContext}`
}

async function updateSharedContext (
  workspaceClient: WorkspaceClient,
  user: AccountUuid | undefined,
  args: Record<string, any>
): Promise<string> {
  if (user === undefined) return 'No shared context available'
  await workspaceClient.updateSharedContext(user, args)
  return 'Shared context memory updated'
}

async function clearHistory (
  workspaceClient: WorkspaceClient,
  user: AccountUuid | undefined,
  args: Record<string, any>
): Promise<string> {
  if (user === undefined) return 'No shared context available'
  await workspaceClient.clearHistory(user, args)
  return 'Conversation history has been cleared. Starting fresh conversation.'
}
