//
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

import { fromJsonSchema, type McpServer } from '@modelcontextprotocol/server'

import type { TraceXAuthInfo } from '../../auth'
import { jsonStructuredText, jsonText } from '../../mcp'
import type { WorkspaceManager } from '../../workspace'

/** Register account-level workspace discovery without requiring a selected workspace. */
export function registerMeWorkspacesTool (
  server: McpServer,
  workspaceManager: WorkspaceManager,
  auth: TraceXAuthInfo
): void {
  server.registerTool(
    'my.workspaces',
    {
      description:
        'List accessible TraceX workspaces with stable IDs, names and URL names. Use an exact returned ID in every workspace tool call.',
      inputSchema: fromJsonSchema<Record<string, unknown>>({
        type: 'object',
        properties: {},
        additionalProperties: false
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true }
    },
    async () => {
      try {
        return jsonStructuredText({
          installation: String(auth.resource),
          workspaces: await workspaceManager.getWorkspaces(auth.extra.accountToken)
        })
      } catch {
        return jsonText(
          {
            error: {
              code: 'workspaces_unavailable',
              message: 'Could not load accessible workspaces. Reconnect if your TraceX session has expired.'
            }
          },
          true
        )
      }
    }
  )
}
