//
// Copyright © 2026 TraceX.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import {
  cardTools,
  callCardTool,
  objectTools,
  callObjectTool,
  type ToolDefinition as McpToolDefinition,
  type ToolResult as McpToolResult,
  type WorkspaceConnection
} from '@hcengineering/mcp-tools'
import type { Token } from '@hcengineering/server-token'
import type { RegisteredTool, ToolContext, ToolExecutorResult, ToolParametersSchema } from './types'

type McpToolCaller = (
  connection: WorkspaceConnection,
  name: string,
  args: Record<string, unknown>
) => Promise<McpToolResult>

interface McpToolGroup {
  tools: McpToolDefinition[]
  callTool: McpToolCaller
}

export const mcpTools: RegisteredTool[] = [
  ...createMcpRegisteredTools({
    tools: cardTools,
    callTool: callCardTool
  }),
  ...createMcpRegisteredTools({
    tools: objectTools,
    callTool: callObjectTool
  })
]

function createMcpRegisteredTools (group: McpToolGroup): RegisteredTool[] {
  return group.tools.map((tool) => ({
    definition: {
      name: toRegularToolName(tool.name),
      description: `${tool.description} MCP tool: ${tool.name}.`,
      parameters: tool.inputSchema as ToolParametersSchema
    },
    contextMode: 'any',
    createExecutor: (toolCtx) => async (args) => await executeMcpTool(toolCtx, group.callTool, tool.name, args)
  }))
}

async function executeMcpTool (
  toolCtx: ToolContext,
  callTool: McpToolCaller,
  name: string,
  args: Record<string, unknown>
): Promise<ToolExecutorResult> {
  const client = await toolCtx.workspaceOps.getClient()
  const token: Token = {
    workspace: toolCtx.workspace,
    account: toolCtx.user
  }

  const connection: WorkspaceConnection = {
    token,
    rawToken: '',
    client,
    collaborator: toolCtx.collaborator,
    workspace: toolCtx.workspace,
    close: async () => {}
  }

  return toToolExecutorResult(await callTool(connection, name, args))
}

function toToolExecutorResult (result: McpToolResult): ToolExecutorResult {
  const text = result.content.map((item) => item.text).join('\n')
  return result.isError === true ? { error: text } : { text }
}

function toRegularToolName (name: string): string {
  return name.replaceAll('.', '_')
}
