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

// Sample notification data for tests and the preview script (scripts/email-preview.js).
// All names, workspaces and texts below are fictional placeholders.

import { text } from '@hcengineering/email-templates'
import type { MarkupNode } from '@hcengineering/text-core'

import type { EmailNotificationData, EmailObject } from '../email/content'
import { markupToEmailHtml, type EmailMarkup } from '../email/markup'

/**
 * Front url of the samples: a reserved example domain.
 */
export const fixtureFrontUrl = 'https://tracex.example'

const workspace = 'demo-workspace'
const sender = 'John Doe'
const receiver = 'Jane Doe'
const other = 'Alex Sample'

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
    'data-assignment': {
      ...base,
      kind: 'assignment',
      object: { title: 'DEMO-003 Sample task', classLabel: 'Task', href: cardHref },
      messageHref: cardHref
    },
    'data-request': {
      ...base,
      kind: 'request',
      title: 'Approve the change of DOC-001 Sample document',
      body: `${other} asks you to approve the document before it becomes effective.`,
      object: { title: 'DOC-001 Sample document', classLabel: 'Document', href: cardHref },
      messageHref: cardHref
    },
    'data-common': {
      ...base,
      kind: 'common',
      title: 'Approve the change of DOC-001 Sample document',
      body: `${other} asks you to approve the document before it becomes effective.`,
      object: { title: 'DOC-001 Sample document', classLabel: 'Document', href: cardHref },
      messageHref: cardHref
    }
  }
}
