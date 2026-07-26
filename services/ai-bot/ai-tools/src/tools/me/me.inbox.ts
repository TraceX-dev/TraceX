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
import core, { type DocumentQuery, type WithLookup, SortingOrder } from '@hcengineering/core'
import notification, { type InboxNotification } from '@hcengineering/notification'
import { translate } from '@hcengineering/platform'
import { Type, type Static } from 'typebox'

import { buildClassSummary, ClassSummarySchema } from '../shared'
import { meInboxToolId } from './tool-ids'

const InboxInputSchema = Type.Object(
  {
    limit: Type.Optional(
      Type.Number({
        default: 50,
        maximum: 200,
        description: 'Maximum number of inbox messages to return. Defaults to 50, maximum 200.'
      })
    ),
    filter: Type.Optional(
      Type.Enum(['unread', 'all'], {
        description:
          'Inbox message filter. unread returns only not viewed messages; all returns all non-archived messages.'
      })
    )
  },
  {
    description: 'Parameters for reading the current account inbox.'
  }
)

const InboxMessageOutputSchema = Type.Object(
  {
    id: Type.String({
      description: 'Stable inbox notification identifier.'
    }),
    unread: Type.Boolean({
      description: 'Whether the inbox message is unread.'
    }),
    date: Type.Optional(
      Type.Number({
        description: 'Notificattion timestamp in milliseconds since Unix epoch.'
      })
    ),
    title: Type.Optional(
      Type.String({
        description: 'Localized notification title identifier, when present.'
      })
    ),
    body: Type.Optional(
      Type.String({
        description: 'Localized notification body identifier, when present.'
      })
    ),
    objectId: Type.String({
      description: 'Target object identifier.'
    }),
    objectClass: Type.With(ClassSummarySchema, {
      description: 'Target object class summary.'
    })
  },
  {
    description: 'Compact inbox message.'
  }
)

const InboxOutputSchema = Type.Object(
  {
    messages: Type.Array(InboxMessageOutputSchema, {
      description: 'Current account inbox messages.'
    })
  },
  {
    description: 'Current account inbox.'
  }
)

type InboxInput = Static<typeof InboxInputSchema>
type InboxOutput = Static<typeof InboxOutputSchema>
type InboxMessageOutput = Static<typeof InboxMessageOutputSchema>

export const meInboxTool = createTool({
  name: meInboxToolId,
  description: 'List inbox messages for the current authenticated account.',
  inputSchema: InboxInputSchema,
  outputSchema: InboxOutputSchema,
  execute: async (args: InboxInput, toolCtx: PlatformContext) => {
    const { client } = toolCtx
    const limit = args.limit ?? 50

    const query: DocumentQuery<InboxNotification> = {
      user: toolCtx.token.account,
      archived: false,
      ...(args.filter === 'unread' ? { isViewed: false } : {})
    }

    const messages = await client.findAll(notification.class.InboxNotification, query, {
      limit,
      sort: { createdOn: SortingOrder.Descending },
      lookup: {
        space: core.class.Space,
        docNotifyContext: notification.class.DocNotifyContext
      }
    })

    return toolOk({ messages: await buildInboxOutput(toolCtx, messages) })
  }
})

async function buildInboxOutput (
  toolCtx: PlatformContext,
  notifications: WithLookup<InboxNotification>[]
): Promise<InboxOutput['messages']> {
  return await Promise.all(
    notifications.map(async (inboxNotification): Promise<InboxMessageOutput> => {
      const docNotifyContext = inboxNotification.$lookup?.docNotifyContext
      const objectClass = docNotifyContext?.objectClass ?? inboxNotification.objectClass
      const intlParams = await buildIntlParams(inboxNotification)

      return {
        id: inboxNotification._id,
        unread: !inboxNotification.isViewed,
        date: inboxNotification.createdOn,
        title: inboxNotification.title !== undefined ? await translate(inboxNotification.title, intlParams) : '',
        body: inboxNotification.body !== undefined ? await translate(inboxNotification.body, intlParams) : '',
        objectId: inboxNotification.objectId,
        objectClass: await buildClassSummary(toolCtx.hierarchy, objectClass)
      }
    })
  )
}

async function buildIntlParams (inboxNotification: InboxNotification): Promise<Record<string, any>> {
  const intlParams = { ...(inboxNotification.intlParams ?? {}) }

  if (
    inboxNotification.intlParamsNotLocalized !== undefined &&
    Object.keys(inboxNotification.intlParamsNotLocalized).length > 0
  ) {
    for (const key in inboxNotification.intlParamsNotLocalized) {
      intlParams[key] = await translate(inboxNotification.intlParamsNotLocalized[key], intlParams)
    }
  }

  return intlParams
}
