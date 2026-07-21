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

import { createTool, toolOk } from '@hcengineering/ai-core'
import { Type } from 'typebox'
import { ToolContext } from './types'

const UpdateAssistantMemoryParametersSchema = Type.Object({
  memory: Type.String({
    description:
      'Complete updated memory about yourself (the assistant): your name, behavior style, how to address the user, your role, etc.'
  })
})

const UpdateUserMemoryParametersSchema = Type.Object({
  memory: Type.String({
    description: 'Complete updated memory about the user: their preferences, context, personal info, interests, etc.'
  })
})

const UpdateSharedContextParametersSchema = Type.Object({
  context: Type.String({
    description: 'Complete updated shared context: language preference, timezone, general non-personal settings, etc.'
  })
})

export const getAssistantMemoryTool = createTool({
  name: 'get_assistant_memory',
  description: 'Retrieve current memory about yourself (the assistant). Check your name, behavior style, and how you should address the user.',
  inputSchema: Type.Object({}),
  execute: async (args, toolCtx: ToolContext) => {
    const history = await toolCtx.memoryStorage.getHistory(toolCtx.user)
    const text = history.assistantMemory !== ''
      ? `Current assistant memory:\n${history.assistantMemory}`
      : 'No assistant memory stored yet.'
    return toolOk(text)
  },
  metadata: {
    contextMode: 'direct'
  }
})

export const updateAssistantMemoryTool = createTool({
  name: 'update_assistant_memory',
  description: 'Update information about yourself (the assistant). Use this when user tells you how to behave, what name to use, how to address them, or defines your role/personality.',
  inputSchema: UpdateAssistantMemoryParametersSchema,
  execute: async (args, toolCtx: ToolContext) => {
    await toolCtx.memoryStorage.updateAssistantMemory(toolCtx.user, args)
    return toolOk('Assistant memory updated.')
  },
  metadata: {
    contextMode: 'direct'
  }
})

export const clearAssistantMemoryTool = createTool({
  name: 'clear_assistant_memory',
  description:
    'Clear all memory about yourself (the assistant). Use only if user explicitly asks to reset your persona.',
  inputSchema: Type.Object({}),
  execute: async (args, toolCtx: ToolContext) => {
    await toolCtx.memoryStorage.updateAssistantMemory(toolCtx.user, { memory: '' })
    return toolOk('Assistant memory cleared.')
  },
  metadata: {
    contextMode: 'direct'
  }
})

export const getUserMemoryTool = createTool({
  name: 'get_user_memory',
  description: 'Retrieve current memory about the user. Check what information is stored about them.',
  inputSchema: Type.Object({}),
  execute: async (args, toolCtx: ToolContext) => {
    const history = await toolCtx.memoryStorage.getHistory(toolCtx.user)
    const text = history.userMemory !== ''
      ? `Current user memory:\n${history.userMemory}`
      : 'No user memory stored yet.'
    return toolOk(text)
  },
  metadata: {
    contextMode: 'direct'
  }
})

export const updateUserMemoryTool = createTool({
  name: 'update_user_memory',
  description:
    'Update information about the user. Use this when user shares personal information, preferences, or context about themselves.',
  inputSchema: UpdateUserMemoryParametersSchema,
  execute: async (args, toolCtx: ToolContext) => {
    await toolCtx.memoryStorage.updateUserMemory(toolCtx.user, args)
    return toolOk('User memory updated')
  },
  metadata: {
    contextMode: 'direct'
  }
})

export const clearUserMemoryTool = createTool({
  name: 'clear_user_memory',
  description: 'Clear all memory about the user. Use only if user explicitly asks to forget everything about them.',
  inputSchema: Type.Object({}),
  execute: async (args, toolCtx: ToolContext) => {
    await toolCtx.memoryStorage.updateUserMemory(toolCtx.user, { memory: '' })
    return toolOk('User memory cleared.')
  },
  metadata: {
    contextMode: 'direct'
  }
})

export const getSharedContextTool = createTool({
  name: 'get_shared_context',
  description: 'Retrieve current shared context. Check language preference, timezone, or other general settings.',
  inputSchema: Type.Object({}),
  execute: async (args, toolCtx: ToolContext) => {
    const history = await toolCtx.memoryStorage.getHistory(toolCtx.user)
    const text = history.sharedContext !== ''
      ? `Current shared context memory:\n${history.sharedContext}`
      : 'No shared context memory stored yet.'
    return toolOk(text)
  },
  metadata: {
    contextMode: 'any'
  }
})

export const updateSharedContextTool = createTool({
  name: 'update_shared_context',
  description:
    'Update shared context that can be used in both direct and group chats. Use for preferences that apply to group chats (like how to address user in public), language, timezone, or public settings.',
  inputSchema: UpdateSharedContextParametersSchema,
  execute: async (args, toolCtx: ToolContext) => {
    await toolCtx.memoryStorage.updateSharedContext(toolCtx.user, args)
    return toolOk('Shared context memory updated')
  },
  metadata: {
    contextMode: 'direct'
  }
})

export const clearHistoryTool = createTool({
  name: 'clear_history',
  description:
    'Clear conversation history. Use when user asks to clear/forget the conversation history or start fresh. This removes all previous messages but keeps assistant and user memory.',
  inputSchema: Type.Object({}),
  execute: async (args, toolCtx: ToolContext) => {
    await toolCtx.memoryStorage.clearHistory(toolCtx.user)
    return toolOk('Conversation history has been cleared. Starting fresh conversation.')
  },
  metadata: {
    contextMode: 'direct'
  }
})
