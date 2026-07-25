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
import contact, { type Employee, getFirstName, getLastName } from '@hcengineering/contact'
import { Type } from 'typebox'

import { meAccountToolId } from './tool-ids'

const AccountInputSchema = Type.Object(
  {},
  {
    description: 'No parameters.'
  }
)

const AccountOutputSchema = Type.Object(
  {
    id: Type.String({
      description: 'Workspace person / employee identifier.'
    }),
    firstName: Type.String({
      description: 'First name of the current account.'
    }),
    lastName: Type.String({
      description: 'Last name of the current account.'
    }),
    role: Type.Optional(
      Type.Enum(['USER', 'GUEST'], {
        description: 'Employee role, user or guest.'
      })
    ),
    position: Type.Optional(
      Type.String({
        description: 'Employee position.'
      })
    ),
    timezone: Type.Optional(
      Type.String({
        description: 'Current account timezone.'
      })
    )
  },
  {
    description: 'Current account details.'
  }
)

export const meAccountTool = createTool({
  name: meAccountToolId,
  description: 'Get information about the current authenticated account.',
  inputSchema: AccountInputSchema,
  outputSchema: AccountOutputSchema,
  execute: async (_args, toolCtx: PlatformContext) => {
    const { client } = toolCtx

    const accountId = toolCtx.token.account
    const workspaceId = toolCtx.token.workspace
    const employee = await client.findOne<Employee>(contact.mixin.Employee, { personUuid: accountId })

    if (employee === undefined) {
      return toolFail('Current account was not found', 'account_not_found', {
        details: {
          accountId,
          workspaceId
        }
      })
    }

    return toolOk({
      id: employee._id,
      firstName: getFirstName(employee.name),
      lastName: getLastName(employee.name),
      role: employee.role,
      position: employee.position ?? undefined,
      timezone: employee.timezone
    })
  }
})
