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

import { type PlatformContext, createTool, toolOk } from '@hcengineering/ai-core'
import notification, { type DocNotifyContext, type InboxNotification } from '@hcengineering/notification'
import { Type, type Static } from 'typebox'

import { meInboxReadAllToolId } from './tool-ids'

const InboxReadAllInputSchema = Type.Object(
  {},
  {
    description: 'No parameters.'
  }
)

const InboxReadAllOutputSchema = Type.Object(
  {
    readCount: Type.Number({
      description: 'Number of inbox messages marked as read.'
    })
  },
  {
    description: 'Inbox read-all result.'
  }
)

type InboxReadAllInput = Static<typeof InboxReadAllInputSchema>

export const meInboxReadAllTool = createTool({
  name: meInboxReadAllToolId,
  description: 'Mark all inbox messages for the current authenticated account as read.',
  inputSchema: InboxReadAllInputSchema,
  outputSchema: InboxReadAllOutputSchema,
  execute: async (_args: InboxReadAllInput, toolCtx: PlatformContext) => {
    const ops = toolCtx.client.apply(undefined, 'readAllNotifications', true)
    const account = toolCtx.token.account
    const now = Date.now()
    let readCount = 0

    try {
      const inboxNotifications = await ops.findAll(
        notification.class.InboxNotification,
        {
          user: account,
          isViewed: false,
          archived: false
        },
        {
          projection: { _id: 1, _class: 1, space: 1 }
        }
      )

      const contexts = await ops.findAll(
        notification.class.DocNotifyContext,
        {
          user: account
        },
        {
          projection: { _id: 1, _class: 1, space: 1 }
        }
      )

      for (const inboxNotification of inboxNotifications as InboxNotification[]) {
        await ops.updateDoc(inboxNotification._class, inboxNotification.space, inboxNotification._id, {
          isViewed: true
        })
      }

      for (const context of contexts as DocNotifyContext[]) {
        await ops.updateDoc(context._class, context.space, context._id, { lastViewedTimestamp: now })
      }

      readCount = inboxNotifications.length
    } finally {
      await ops.commit()
    }

    return toolOk({ readCount })
  }
})
