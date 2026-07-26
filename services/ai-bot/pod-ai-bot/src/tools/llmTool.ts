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
  createTool,
  type Tool,
  type ToolExecutorOutput,
  type ToolMetadata,
  type ToolOutputSchema,
  toolFail,
  toolOk
} from '@hcengineering/ai-core'
import { Type } from 'typebox'

import { type LLMProvider, type ChatMessage } from '../providers/types'
import { type ToolContext } from './types'

const LlmToolInputSchema = Type.Object({
  query: Type.String({
    description: 'The query to send'
  })
})

const LlmToolOutputSchema = Type.String({})
interface LlmToolOptions<TOutputSchema extends ToolOutputSchema = typeof LlmToolOutputSchema> {
  name: string
  description: string
  systemPrompt?: string
  outputSchema?: TOutputSchema
  provider: LLMProvider
}

export function createLlmTool<TOutputSchema extends ToolOutputSchema = typeof LlmToolOutputSchema> (
  options: LlmToolOptions<TOutputSchema>
): Tool<typeof LlmToolInputSchema, TOutputSchema, ToolContext, ToolMetadata> {
  const { name, description, systemPrompt, outputSchema, provider } = options

  return createTool({
    name,
    description,
    inputSchema: LlmToolInputSchema,
    outputSchema,
    execute: async (args, toolCtx: ToolContext) => {
      const ctx = toolCtx.ctx

      const messages: ChatMessage[] = [
        ...(systemPrompt != null ? [{ role: 'system' as const, content: systemPrompt }] : []),
        { role: 'user' as const, content: args.query }
      ]

      const result = await provider.chatCompletion(ctx, messages)
      if (result.usage !== undefined) {
        toolCtx.tokenUsage?.addTokenUsage(result.usage, { tool: name })
      }

      const response = result.text ?? 'No response'
      const output = parseLlmToolOutput<TOutputSchema>(response, outputSchema)
      if (output === undefined) {
        return toolFail(
          'LLM tool response does not match the configured object output schema.',
          'invalid_tool_output',
          {
            details: { response }
          }
        )
      }

      return toolOk(output)
    },
    metadata: {
      contextMode: 'any'
    }
  })
}

function parseLlmToolOutput<TOutputSchema extends ToolOutputSchema> (
  response: string,
  outputSchema: TOutputSchema | undefined
): ToolExecutorOutput<TOutputSchema> | undefined {
  if (outputSchema?.type !== 'object') {
    return response as ToolExecutorOutput<TOutputSchema>
  }

  try {
    const parsed = JSON.parse(response)
    return isRecord(parsed) ? (parsed as ToolExecutorOutput<TOutputSchema>) : undefined
  } catch {
    return undefined
  }
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
