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

// All names, workspaces and texts below are fictional placeholders.

import type { MarkupNode } from '@hcengineering/text-core'

import type { EmailNotificationData, EmailObject } from './content'
import {
  assets,
  assetUrl,
  join,
  mention,
  strong,
  text,
  trusted,
  type EmailLayout
} from '@hcengineering/email-templates'
import { markupToEmailHtml, type EmailMarkup } from './markup'

/**
 * Front url of the samples: a reserved example domain.
 * @public
 */
export const fixtureFrontUrl = 'https://tracex.example'

const workspace = 'demo-workspace'
const sender = 'John Doe'
const receiver = 'Jane Doe'
const other = 'Alex Sample'

/**
 * Sample emails of every kind, for previews and tests.
 * @public
 */
export function emailFixtures (frontUrl = fixtureFrontUrl): Record<string, EmailLayout> {
  const card = `${frontUrl}/workbench/${workspace}/card/demo-card-1`
  const settings = `${frontUrl}/workbench/${workspace}/setting/notifications`
  const icon = assetUrl(frontUrl, assets.cardIcon.path)
  const base = { frontUrl, appName: 'TraceX', footerLinks: [{ label: 'Notification settings', href: settings }] }

  return {
    reply: {
      ...base,
      preheader: 'Sounds good. Let me double-check the due date first.',
      eventLabel: 'New reply',
      context: { chip: 'Sample card', workspace },
      title: `${sender} replied to your message`,
      blocks: [
        {
          type: 'quote',
          label: 'Your message',
          body: text(
            'Could you please calculate the due date from the start date plus the delay of the selected category, and show whether the item is on time, at risk or overdue?'
          )
        },
        {
          type: 'message',
          sender,
          time: 'Jan 15, 10:30 UTC',
          body: join([
            text('Sounds good.'),
            trusted('<br><br>'),
            text('Let me double-check the due date of this one, it might be '),
            strong('overdue'),
            text(':')
          ]),
          objects: [
            {
              type: 'object',
              title: 'DEMO-001 Sample card title',
              subtitle: 'Sample card',
              href: card,
              iconUrl: icon
            }
          ]
        }
      ],
      actions: [
        { label: 'Reply in TraceX', href: card, primary: true },
        { label: 'Open card', href: card }
      ],
      reason: "You're receiving this because you're a participant in this thread."
    },
    mention: {
      ...base,
      preheader: `@${receiver} could you check whether this one is at risk?`,
      eventLabel: 'You were mentioned',
      context: { chip: 'Sample card', workspace },
      title: `${sender} mentioned you`,
      blocks: [
        {
          type: 'message',
          framed: true,
          sender,
          time: 'Jan 15, 10:30 UTC',
          body: join([
            mention(receiver),
            text(' could you check whether this one is at risk? The status should change one day before the due date.')
          ])
        }
      ],
      actions: [
        { label: 'Reply in TraceX', href: card, primary: true },
        { label: 'Open card', href: card }
      ],
      reason: "You're receiving this because you were mentioned."
    },
    message: {
      ...base,
      preheader: 'I attached the updated draft, please take a look before Friday.',
      eventLabel: 'New message',
      context: { chip: 'Sample card', workspace },
      title: 'New message in DEMO-002 Sample request',
      blocks: [
        {
          type: 'message',
          sender: other,
          time: 'Jan 15, 09:12 UTC',
          body: text('I attached the updated draft, please take a look before Friday.\nThe changes are in section 2.')
        }
      ],
      actions: [
        { label: 'Reply in TraceX', href: card, primary: true },
        { label: 'Open card', href: card }
      ],
      reason: "You're receiving this because you're a collaborator on this card."
    },
    assignment: {
      ...base,
      preheader: `${sender} assigned you DEMO-003`,
      eventLabel: 'Assigned to you',
      context: { chip: 'Task', workspace },
      title: `${sender} assigned you a card`,
      blocks: [
        { type: 'object', title: 'DEMO-003 Sample task', subtitle: 'Task · Due Jan 31', href: card, iconUrl: icon }
      ],
      actions: [{ label: 'Open in TraceX', href: card, primary: true }],
      reason: "You're receiving this because you were assigned."
    },
    approval: {
      ...base,
      preheader: 'Approval requested: DOC-001 Sample document, rev. 2',
      eventLabel: 'Approval requested',
      context: { chip: 'Document', workspace },
      title: 'Your approval is requested',
      blocks: [
        {
          type: 'paragraph',
          body: join([strong(other), text(' asks you to review and approve the document before it becomes effective.')])
        },
        {
          type: 'object',
          title: 'DOC-001 Sample document',
          subtitle: 'Revision 2 · In review',
          href: card,
          iconUrl: icon
        }
      ],
      actions: [{ label: 'Review in TraceX', href: card, primary: true }],
      reason: "You're receiving this because you're an approver of this document."
    },
    update: {
      ...base,
      preheader: 'Status: On time → At risk',
      eventLabel: 'Card updated',
      context: { chip: 'Sample card', workspace },
      title: 'DEMO-001 Sample card title was updated',
      blocks: [
        {
          type: 'fields',
          rows: [
            { label: 'Status', from: text('On time'), to: text('At risk') },
            { label: 'Due date', from: text('Jan 20'), to: text('Jan 18') },
            { label: 'Owner', to: text(receiver) }
          ]
        }
      ],
      actions: [{ label: 'Open in TraceX', href: card, primary: true }],
      reason: "You're receiving this because you're a collaborator on this card."
    },
    system: {
      ...base,
      eventLabel: 'Integration',
      title: 'Integration with Sample Mail was disabled',
      blocks: [
        {
          type: 'paragraph',
          body: text('We could not refresh access to your mailbox. Reconnect the integration to keep syncing messages.')
        }
      ],
      actions: [{ label: 'Open settings', href: settings, primary: true }]
    }
  }
}

/**
 * Sample notification data of every kind, rendered through markup and content builders.
 * @public
 */
export function emailDataFixtures (frontUrl = fixtureFrontUrl): Record<string, EmailNotificationData> {
  const cardHref = `${frontUrl}/workbench/${workspace}/notification/demo-card-1`
  const otherHref = (id: string): string => `${frontUrl}/workbench/${workspace}/notification/${id}`
  const options = {
    isPerson: (_class: string) => _class === 'contact:class:Person',
    referenceHref: (id: string) => otherHref(id),
    maxLength: 1500
  }
  const node = (type: string, content?: any[], attrs?: Record<string, any>): any => ({ type, content, attrs })
  const t = (value: string, marks?: any[]): any => ({ type: 'text', text: value, marks })
  const reply = markupToEmailHtml(
    node('doc', [
      node('paragraph', [t('Sounds good.')]),
      node('paragraph', [
        t('Let me double-check the due date of this one, it might be '),
        t('overdue', [{ type: 'bold' }]),
        t(': '),
        node('reference', undefined, {
          id: 'demo-card-2',
          objectclass: 'card:class:Card',
          label: 'DEMO-002 Sample request'
        })
      ]),
      node('bulletList', [
        node('listItem', [node('paragraph', [t('due date: Jan 18')])]),
        node('listItem', [node('paragraph', [t('status should be '), t('At risk', [{ type: 'italic' }])])])
      ])
    ]) as MarkupNode,
    options
  )
  const mentionMarkup = markupToEmailHtml(
    node('doc', [
      node('paragraph', [
        node('reference', undefined, { id: 'person-1', objectclass: 'contact:class:Person', label: receiver }),
        t(' could you check whether this one is at risk? The status should change one day before the due date.')
      ])
    ]) as MarkupNode,
    options
  )
  const references = (r: EmailMarkup): EmailObject[] =>
    r.references.map((it) => ({ title: it.label, classLabel: 'Sample card', href: otherHref(it.id) }))

  const base: EmailNotificationData = {
    kind: 'message',
    frontUrl,
    appName: 'TraceX',
    workspace,
    settingsUrl: `${frontUrl}/workbench/${workspace}/setting/notifications`,
    senderName: sender,
    time: 'Jan 15, 10:30 UTC',
    object: { title: 'DEMO-001 Sample card title', classLabel: 'Sample card', href: cardHref },
    messageHref: `${cardHref}?message=demo-message-1`
  }

  return {
    'data-reply': {
      ...base,
      kind: 'reply',
      quote: {
        own: true,
        text: 'Could you please calculate the due date from the start date plus the delay of the selected category?'
      },
      messageHtml: reply.html,
      messageText: reply.text,
      references: references(reply)
    },
    'data-mention': {
      ...base,
      kind: 'mention',
      messageHtml: mentionMarkup.html,
      messageText: mentionMarkup.text
    },
    'data-message': {
      ...base,
      senderName: other,
      object: { ...base.object, title: 'DEMO-002 Sample request' },
      messageHtml: text('I attached the updated draft, please take a look before Friday.'),
      messageText: 'I attached the updated draft, please take a look before Friday.'
    },
    'data-reaction': {
      ...base,
      kind: 'reaction',
      emoji: '👍',
      quote: { own: true, text: 'I attached the updated draft, please take a look before Friday.' }
    },
    'data-update': {
      ...base,
      kind: 'update',
      body: 'Status: Open → In progress',
      messageHref: cardHref
    },
    'data-common': {
      ...base,
      kind: 'common',
      typeLabel: 'Approval request',
      title: 'Approve the change of DOC-001 Sample document',
      body: `${other} asks you to approve the document before it becomes effective.`,
      object: { title: 'DOC-001 Sample document', classLabel: 'Document', href: cardHref },
      messageHref: cardHref
    }
  }
}
