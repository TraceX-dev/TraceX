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

import { type MeasureContext } from '@hcengineering/core'

import { type LLMProvider, type ChatMessage } from '../providers/types'
import { type RegisteredTool } from './types'

interface LlmToolOptions {
  name: string
  description: string
  systemPrompt?: string
  provider: LLMProvider
  ctx: MeasureContext
}

export function createLlmTool (options: LlmToolOptions): RegisteredTool {
  const { name, description, systemPrompt, provider, ctx } = options

  return {
    definition: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The query to send'
          }
        },
        required: ['query']
      }
    },
    createExecutor: () => async (args: { query: string }) => {
      const messages: ChatMessage[] = [
        ...(systemPrompt != null ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user' as const, content: args.query }
      ]

      const result = await provider.chatCompletion(ctx, messages)
      const response = result.text ?? 'No response'

      return { text: response, usage: result.usage }
    },
    contextMode: 'any',
    isLlmTool: true
  }
}
