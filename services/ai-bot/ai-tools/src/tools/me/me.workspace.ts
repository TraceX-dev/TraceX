//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { type PlatformContext, createTool, toolFail, toolOk } from '@hcengineering/ai-core'
import { getAccountClient } from '@hcengineering/server-client'
import { Type } from 'typebox'

import { meWorkspaceToolId } from './tool-ids'

const WorkspaceInputSchema = Type.Object(
  {},
  {
    description: 'No parameters.'
  }
)

const WorkspaceOutputSchema = Type.Object(
  {
    id: Type.String({
      description: 'Unique workspace identifier.'
    }),
    name: Type.String({
      description: 'Human readable workspace name.'
    }),
    url: Type.String({
      description: 'Unique workspace URL name.'
    })
  },
  {
    description: 'Current workspace details.'
  }
)

export const meWorkspaceTool = createTool({
  name: meWorkspaceToolId,
  description: 'Get information about the current authenticated workspace.',
  inputSchema: WorkspaceInputSchema,
  outputSchema: WorkspaceOutputSchema,
  execute: async (_args, toolCtx: PlatformContext) => {
    const workspaceId = toolCtx.token.workspace

    try {
      const accountClient = getAccountClient(toolCtx.rawToken)
      const workspace = await accountClient.getWorkspaceInfo(false)

      if (workspace === undefined) {
        return toolFail('Current workspace was not found', 'workspace_not_found', {
          details: {
            workspaceId
          }
        })
      }

      return toolOk({
        id: workspace.uuid,
        name: workspace.name,
        url: workspace.url
      })
    } catch (err) {
      return toolFail('Could not load current workspace information', 'workspace_info_failed', {
        details: {
          workspaceId,
          error: err instanceof Error ? err.message : String(err)
        }
      })
    }
  }
})
