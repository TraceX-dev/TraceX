//
// Copyright © 2026 TraceX.
// Copyright © 2026 TraceX SAS.
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

import { type PlatformContext } from '@hcengineering/ai-core'
import { tools } from '@hcengineering/ai-tools'
import { type MeasureContext } from '@hcengineering/core'
import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  requireBearerAuth
} from '@modelcontextprotocol/express'
import { toNodeHandler } from '@modelcontextprotocol/node'
import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type AuthInfo,
  type CallToolResult
} from '@modelcontextprotocol/server'
import cors from 'cors'
import express, { type Express } from 'express'
import { type Server } from 'http'

import { type McpConfig } from './config'
import { createMcpTokenVerifier, type TraceXAuthInfo } from './auth'
import { jsonStructuredText, jsonText } from './mcp'
import { registerMeWorkspacesTool } from './tools/me/workspaces'
import { meWorkspacesToolId } from './tools/me/tool-ids'
import { packageAuthoringGuideToolId } from './tools/package/tool-ids'
import type { WorkspaceConnection, WorkspaceManager } from './workspace'
import { registerPackageAuthoringTools } from './package-authoring'
import { createPackageAuthorizer, type PackageAuthorizer } from './package-authoring-access'

const SERVER_NAME = 'tracex-mcp'
const SERVER_VERSION = '0.1.0'
const SERVER_INSTRUCTIONS = `Use only authorized TraceX workspaces. Never request or expose tokens. Discover IDs and fields through read-only tools and follow their schemas. Mutate only with user intent, reload existing objects, respect readonly/history errors and report the target workspace.

Call ${meWorkspacesToolId} to discover workspaces authorized by this connection. A connection may be restricted to one workspace. Every other tool requires the exact workspace ID returned by ${meWorkspacesToolId}. There is no implicit current or last-used workspace. When the intended workspace is ambiguous, ask the user before proceeding. Do not guess from duplicate workspace or object names. State the target workspace when reporting changes.
For packages, read ${packageAuthoringGuideToolId}, then only relevant sections and installed contracts. Own technical choices; do not ask managers to select triggers, storage keys or process architecture. Record reasonable assumptions in the draft review. Ask concise business questions only for material contradictions, outcome-changing missing rules or unconfirmed required capabilities. Search reusable packages before new logic; never invent APIs or runtime behavior. To add a Marketplace process to a card package draft, follow Reusing a Marketplace process and use package_add_dependency with the verified release lock and parent bindings. Do not copy, rewrite or add a wrapper process. Validate and save the requested draft with its dependencies; UI installation applies the complete tree later. MCP never installs, executes or publishes. The guide distinguishes draft edits from new package versions.

Prefer narrow queries, practical limits and structuredContent. Reuse retrieved guidance and contracts during the task instead of repeatedly loading whole documents or unchanged YAML. Correct invalid arguments from tool diagnostics.`

type ToolDefinition = (typeof tools)[number]
type ToolExecutionResult = Awaited<ReturnType<ToolDefinition['execute']>>

export function createServer (config: McpConfig, workspaceManager: WorkspaceManager, ctx: MeasureContext): Express {
  const resourceServerUrl = new URL(config.OAuthResourceURL)
  const app = createMcpExpressApp({ host: '0.0.0.0', allowedHosts: [resourceServerUrl.hostname] })

  app.use(cors())
  app.use(express.json({ limit: '5mb' }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: config.ServiceID, server: SERVER_NAME })
  })

  const authorizePackages = createPackageAuthorizer(config)
  const handler = createMcpHandler(
    ({ authInfo }) =>
      createMcpServer(getTraceXAuthInfo(authInfo), workspaceManager, ctx, authorizePackages, config.MarketplaceURL),
    { responseMode: 'json' }
  )
  const nodeHandler = toNodeHandler(handler)
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata: {
        issuer: config.OAuthIssuerURL,
        authorization_endpoint: `${config.OAuthIssuerURL}/authorize`,
        token_endpoint: `${config.OAuthIssuerURL}/token`,
        registration_endpoint: `${config.OAuthIssuerURL}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['tracex']
      },
      resourceServerUrl,
      resourceName: 'TraceX MCP',
      scopesSupported: ['tracex'],
      dangerouslyAllowInsecureIssuerUrl: config.OAuthAllowHttp
    })
  )

  app.all(
    resourceServerUrl.pathname,
    requireBearerAuth({
      verifier: createMcpTokenVerifier(config),
      requiredScopes: ['tracex'],
      expectedResource: resourceServerUrl,
      resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceServerUrl).toString()
    }),
    (req, res) => {
      void nodeHandler(req, res, req.body).catch((err) => {
        ctx.error('MCP request failed', errorLog(err))
        if (!res.headersSent) {
          res.status(500).json({ error: 'Internal server error' })
        }
      })
    }
  )

  return app
}

export function listen (app: Express, port: number, ctx: MeasureContext, host?: string): Server {
  const cb = (): void => {
    ctx.info('TraceX MCP service started', { host: host ?? '*', port })
  }
  return host !== undefined ? app.listen(port, host, cb) : app.listen(port, cb)
}

export function createMcpServer (
  auth: TraceXAuthInfo,
  workspaceManager: WorkspaceManager,
  ctx: MeasureContext,
  authorizePackages: PackageAuthorizer = async () => false,
  marketplaceUrl?: string
): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION
    },
    {
      instructions: SERVER_INSTRUCTIONS
    }
  )

  registerMeWorkspacesTool(server, workspaceManager, auth, ctx)
  registerPackageAuthoringTools(server, auth, workspaceManager, authorizePackages, ctx, marketplaceUrl)

  for (const tool of tools) {
    const inputSchema = {
      ...tool.inputSchema,
      properties: {
        ...tool.inputSchema.properties,
        workspace: {
          type: 'string',
          description: `Exact workspace ID returned by ${meWorkspacesToolId}. Required for every call; never infer an implicit current workspace.`
        }
      },
      required: [...(tool.inputSchema.required ?? []), 'workspace']
    }
    server.registerTool(
      tool.name,
      {
        ...(tool.title !== undefined ? { title: tool.title } : {}),
        description: tool.description,
        inputSchema: fromJsonSchema<Record<string, unknown>>(inputSchema),
        ...(tool.outputSchema !== undefined ? { outputSchema: fromJsonSchema(tool.outputSchema) } : {}),
        ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {})
      },
      async (args) => {
        const { workspace, ...input } = args
        try {
          return await ctx.with('mcp-tool', { tool: tool.name }, async (ctx) => {
            if (typeof workspace !== 'string' || workspace === '') {
              return jsonText(
                {
                  error: {
                    code: 'workspace_required',
                    message: `Choose an explicit workspace ID from ${meWorkspacesToolId}.`
                  }
                },
                true
              )
            }
            const connection = await ctx.with(
              'connect',
              {},
              async () =>
                await workspaceManager.getConnection(auth.extra.accountToken, workspace, auth.extra.workspaceId)
            )
            const result = toToolResult(
              tool,
              await ctx.with(
                'execute',
                {},
                async (ctx) => await tool.execute(input, createToolContext(ctx, connection))
              )
            )
            return {
              ...result,
              content: [
                {
                  type: 'text' as const,
                  text: `TraceX workspace: ${connection.workspaceName} (${connection.workspaceUrl}; ${workspace})`
                },
                ...result.content
              ]
            }
          })
        } catch (error: unknown) {
          ctx.error('MCP workspace operation failed', { tool: tool.name, workspace, ...errorLog(error) })
          return jsonText(
            {
              error: {
                code: 'workspace_operation_failed',
                message: `The operation failed. Verify the workspace with ${meWorkspacesToolId} and reload the object before retrying. If the TraceX session has expired, reconnect.`,
                workspace
              }
            },
            true
          )
        }
      }
    )
  }

  return server
}

function createToolContext (ctx: MeasureContext, connection: WorkspaceConnection): PlatformContext {
  return {
    ctx,
    token: connection.token,
    rawToken: connection.rawToken,
    workspace: connection.workspace,
    workspaceIds: connection.workspaceIds,
    client: connection.client,
    hierarchy: connection.client.getHierarchy(),
    model: connection.client.getModel(),
    storage: connection.storage,
    collaborator: connection.collaborator
  }
}

export function toToolResult (tool: ToolDefinition, result: ToolExecutionResult): CallToolResult {
  if (!result.ok) {
    const error = tool.name.startsWith('collab_')
      ? {
          outcome: result.error.code === 'input_format_error' ? 'not_applied' : 'unknown',
          ...result.error,
          retryable: false
        }
      : result.error
    return jsonText({ error }, true)
  }
  return tool.outputSchema !== undefined ? jsonStructuredText(result.output) : jsonText(result.output)
}

function getTraceXAuthInfo (authInfo: AuthInfo | undefined): TraceXAuthInfo {
  if (
    typeof authInfo?.extra?.accountToken !== 'string' ||
    typeof authInfo.extra.connectionId !== 'string' ||
    authInfo.extra.workspaceId === undefined
  ) {
    throw new Error('Missing authenticated TraceX MCP request')
  }
  return authInfo as TraceXAuthInfo
}

function errorLog (err: unknown): { error: string, stack?: string } {
  return err instanceof Error ? { error: err.message, stack: err.stack } : { error: String(err) }
}
