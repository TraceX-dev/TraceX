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

import { PersonMessage } from '@hcengineering/ai-bot'
import contact from '@hcengineering/contact'
import { MeasureContext, WorkspaceUuid } from '@hcengineering/core'

import {
  type LLMProvider,
  type ChatMessage,
  type ChatCompletionOptions,
  type ContextMode,
  type LLMToolDefinition,
  type TokenUsage
} from '../providers/types'
import { PROMPTS } from '../providers/prompts'
import { pushTokensData } from '../billing'
import { getTools, type ToolContext, type ToolExecutorResult } from '../tools'

export interface ChatResult {
  completion: string | undefined
  usage: TokenUsage
  tools: string[]
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 }

function addUsage (a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens
  }
}

function totalTokens (usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens
}

export interface LLMService {
  translateHtml: (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    html: string,
    lang: string
  ) => Promise<{ text?: string, usage?: TokenUsage }>

  summarizeMessages: (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    messages: PersonMessage[],
    lang: string
  ) => Promise<{ text?: string, usage?: TokenUsage }>

  chat: (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    messages: ChatMessage[],
    contextMode: ContextMode,
    assistantMemory: string,
    userMemory: string,
    sharedContext: string,
    toolCtx: ToolContext,
    options?: ChatCompletionOptions
  ) => Promise<ChatResult | undefined>

  countTokens: (messages: ChatMessage) => number
}

export interface LLMServiceConfig {
  maxToolRounds: number
}

export class DefaultLLMService implements LLMService {
  constructor (
    private readonly provider: LLMProvider,
    private readonly config: LLMServiceConfig
  ) {}

  countTokens (message: ChatMessage): number {
    return this.provider.countTokens(message)
  }

  async translateHtml (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    html: string,
    lang: string
  ): Promise<{ text?: string, usage?: TokenUsage }> {
    const result = await this.provider.chatCompletion(ctx, [
      { role: 'system', content: PROMPTS.TRANSLATE_HTML({ lang }) },
      { role: 'user', content: html }
    ])

    const usage = result.usage ?? ZERO_USAGE
    if (totalTokens(usage) > 0) {
      void pushTokensData(ctx, [
        {
          workspace,
          reason: 'manual-translate',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          date: new Date((result.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
        }
      ])
    }

    return { text: result.text, usage }
  }

  async summarizeMessages (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    messages: PersonMessage[],
    lang: string
  ): Promise<{ text?: string, usage?: TokenUsage }> {
    const personToName = new Map<string, string>()
    for (const m of messages) {
      if (!personToName.has(m.personRef)) {
        personToName.set(m.personRef, m.personName)
      }
    }

    const nameUsage = new Map<string, number>()
    for (const [personRef, name] of personToName) {
      const idx = nameUsage.get(name) ?? 0
      if (idx > 0) {
        personToName.set(personRef, name + ` no.${idx}`)
      }
      nameUsage.set(name, idx + 1)
    }

    const content = messages.map((p) => `---\n\n@${p.personName}\n${p.text}`).join('\n\n')

    const result = await this.provider.chatCompletion(ctx, [
      { role: 'system', content: PROMPTS.SUMMARIZE({ lang }) },
      { role: 'user', content }
    ])

    const usage = result.usage ?? ZERO_USAGE
    if (totalTokens(usage) > 0) {
      void pushTokensData(ctx, [
        {
          workspace,
          reason: 'summarize',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          date: new Date((result.created ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
        }
      ])
    }

    let summary = result.text
    if (summary !== undefined) {
      const classURI = encodeURIComponent(contact.class.Contact)
      for (const [personRef, name] of personToName) {
        const idURI = encodeURIComponent(personRef)
        const nameURI = encodeURIComponent(name)
        const refString = `[](ref://?_class=${classURI}&_id=${idURI}&label=${nameURI})`
        summary = summary.replaceAll(`**@${name}**`, refString)
      }
    }

    return { text: summary, usage }
  }

  async chat (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    messages: ChatMessage[],
    contextMode: ContextMode,
    assistantMemory: string,
    userMemory: string,
    sharedContext: string,
    toolCtx: ToolContext,
    options?: ChatCompletionOptions
  ): Promise<ChatResult | undefined> {
    const date = new Date()

    try {
      const allTools = getTools(contextMode)
      const tools = allTools.filter((t) => t.contextMode === contextMode || t.contextMode === 'any')

      const toolDefinitions: LLMToolDefinition[] = tools.map((t) => t.definition)

      const prompt =
        contextMode === 'direct'
          ? PROMPTS.DIRECT({ assistantMemory, userMemory, sharedContext })
          : PROMPTS.THREAD({ sharedContext })

      const executorMap = new Map<string, (args: any) => Promise<ToolExecutorResult>>()
      for (const t of tools) {
        executorMap.set(t.definition.name, t.createExecutor(toolCtx))
      }

      const conversationMessages: ChatMessage[] = [{ role: 'system', content: prompt }, ...messages]

      let accumulatedUsage: TokenUsage = { ...ZERO_USAGE }
      const invokedToolNames = new Set<string>()

      for (let round = 0; round < this.config.maxToolRounds; round++) {
        const result = await this.provider.chatCompletionWithTools(ctx, conversationMessages, toolDefinitions, options)

        accumulatedUsage = addUsage(accumulatedUsage, result.usage ?? ZERO_USAGE)

        if (result.toolCalls === undefined || result.toolCalls.length === 0) {
          let text = result.text

          const pos = (text ?? '').indexOf('</think>')
          if (pos > 0) {
            text = (text ?? '').substring(pos + 8)
          }

          if (totalTokens(accumulatedUsage) > 0) {
            void pushTokensData(ctx, [
              {
                workspace,
                reason: 'chat',
                inputTokens: accumulatedUsage.inputTokens,
                outputTokens: accumulatedUsage.outputTokens,
                date: date.toISOString()
              }
            ])
          }

          return {
            completion: text ?? undefined,
            usage: accumulatedUsage,
            tools: Array.from(invokedToolNames)
          }
        }

        // Append assistant message with tool calls
        conversationMessages.push({
          role: 'assistant',
          content: result.text ?? '',
          toolCalls: result.toolCalls
        })

        // Execute each tool and append results
        for (const toolCall of result.toolCalls) {
          invokedToolNames.add(toolCall.name)
          const executor = executorMap.get(toolCall.name)
          let toolResult: ToolExecutorResult

          if (executor !== undefined) {
            try {
              const args = JSON.parse(toolCall.arguments)
              toolResult = await executor(args)

              accumulatedUsage = addUsage(accumulatedUsage, toolResult.usage ?? ZERO_USAGE)
            } catch (e: any) {
              ctx.error('Tool execution failed', { workspace, tool: toolCall.name, error: e.message ?? String(e) })
              toolResult = { error: `Error executing tool: ${e.message ?? String(e)}` }
            }
          } else {
            ctx.warn('Unknown tool requested by LLM', { workspace, tool: toolCall.name })
            toolResult = { error: `Unknown tool: ${toolCall.name}` }
          }

          const toolResultText = 'error' in toolResult ? `Error: ${toolResult.error}` : toolResult.text

          conversationMessages.push({
            role: 'tool',
            content: toolResultText,
            toolCallId: toolCall.id
          })
        }
      }

      // Max rounds reached, do a final call without tools
      const finalResult = await this.provider.chatCompletion(ctx, conversationMessages, options)
      accumulatedUsage = addUsage(accumulatedUsage, finalResult.usage ?? ZERO_USAGE)

      if (totalTokens(accumulatedUsage) > 0) {
        void pushTokensData(ctx, [
          {
            workspace,
            reason: 'chat',
            inputTokens: accumulatedUsage.inputTokens,
            outputTokens: accumulatedUsage.outputTokens,
            date: date.toISOString()
          }
        ])
      }

      let text = finalResult.text
      const pos = (text ?? '').indexOf('</think>')
      if (pos > 0) {
        text = (text ?? '').substring(pos + 8)
      }

      return {
        completion: text ?? undefined,
        usage: accumulatedUsage,
        tools: Array.from(invokedToolNames)
      }
    } catch (e: any) {
      ctx.error('LLM chat failed with exception', { workspace, error: e.message ?? String(e), stack: e.stack })
    }

    return undefined
  }
}

export class LoggingLLMService implements LLMService {
  constructor (private readonly llm: LLMService) {}

  countTokens (message: ChatMessage): number {
    return this.llm.countTokens(message)
  }

  async translateHtml (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    html: string,
    lang: string
  ): Promise<{ text?: string, usage?: TokenUsage }> {
    const params = { workspace, lang }
    return await ctx.with('translateHtml', {}, (ctx) => this.llm.translateHtml(ctx, workspace, html, lang), params)
  }

  async summarizeMessages (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    messages: PersonMessage[],
    lang: string
  ): Promise<{ text?: string, usage?: TokenUsage }> {
    const params = { workspace, lang }
    return await ctx.with(
      'summarizeMessages',
      {},
      (ctx) => this.llm.summarizeMessages(ctx, workspace, messages, lang),
      params
    )
  }

  async chat (
    ctx: MeasureContext,
    workspace: WorkspaceUuid,
    messages: ChatMessage[],
    contextMode: ContextMode,
    assistantMemory: string,
    userMemory: string,
    sharedContext: string,
    toolCtx: ToolContext,
    options?: ChatCompletionOptions
  ): Promise<ChatResult | undefined> {
    const params = { workspace }
    return await ctx.with(
      'chat',
      {},
      (ctx) =>
        this.llm.chat(
          ctx,
          workspace,
          messages,
          contextMode,
          assistantMemory,
          userMemory,
          sharedContext,
          toolCtx,
          options
        ),
      params
    )
  }
}
