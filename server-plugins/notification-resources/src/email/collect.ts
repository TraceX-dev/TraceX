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

import activity, { type ActivityMessage, type DocUpdateMessage } from '@hcengineering/activity'
import chunter from '@hcengineering/chunter'
import contact from '@hcengineering/contact'
import { concatLink, type Class, type Doc, type Markup, type Ref } from '@hcengineering/core'
import notification, {
  type InboxNotification,
  type MentionInboxNotification,
  type NotificationType,
  type ReactionInboxNotification,
  notificationId
} from '@hcengineering/notification'
import { getMetadata, translate } from '@hcengineering/platform'
import { getAccountBySocialId } from '@hcengineering/server-contact'
import serverCore, { type TriggerControl } from '@hcengineering/server-core'
import { markupToText } from '@hcengineering/text-core'
import { encodeObjectURI } from '@hcengineering/view'
import { workbenchId } from '@hcengineering/workbench'

import { messageToMarkup } from '../utils'
import { formatEmailTime, type EmailKind, type EmailNotificationData, type EmailObject } from './content'
import { markupToEmailHtml } from './markup'

/** Visible characters of a message body in an email. */
export const EMAIL_MESSAGE_LENGTH = 1500
/** Visible characters of a quoted message. */
export const EMAIL_QUOTE_LENGTH = 280

/**
 * @public
 */
export interface CollectEmailParams {
  doc: Doc
  type: NotificationType
  senderName: string
  /** Object title from its TextPresenter. */
  objectTitle: string
  /** Translated inbox notification texts. */
  content: { title: string, body: string }
  /** Link to the object. */
  objectLink: string
  /** Link to the message, when there is one. */
  messageLink?: string
  notification?: InboxNotification
  message?: ActivityMessage
}

function isDerived (control: TriggerControl, _class: Ref<Class<Doc>>, from: Ref<Class<Doc>>): boolean {
  try {
    return control.hierarchy.isDerived(_class, from)
  } catch {
    return false
  }
}

async function classLabel (
  control: TriggerControl,
  _class: Ref<Class<Doc>>,
  lang?: string
): Promise<string | undefined> {
  try {
    const label = control.hierarchy.getClass(_class).label
    if (label === undefined) return undefined
    const value = await translate(label, {}, lang)
    return value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

function frontUrl (control: TriggerControl): string {
  return control.branding?.front ?? getMetadata(serverCore.metadata.FrontUrl) ?? ''
}

function objectHref (control: TriggerControl, id: Ref<Doc>, _class: Ref<Class<Doc>>): string {
  const path = [workbenchId, control.workspace.url, notificationId, encodeObjectURI(id, _class)]
    .map((it) => encodeURIComponent(it))
    .join('/')
  return concatLink(frontUrl(control), path)
}

function kindOf (
  control: TriggerControl,
  n: InboxNotification | undefined,
  message: ActivityMessage | undefined
): EmailKind {
  if (n !== undefined) {
    if (isDerived(control, n._class, notification.class.MentionInboxNotification)) return 'mention'
    if (isDerived(control, n._class, notification.class.ReactionInboxNotification)) return 'reaction'
  }
  if (message !== undefined) {
    if (isDerived(control, message._class, chunter.class.ThreadMessage)) return 'reply'
    if (isDerived(control, message._class, chunter.class.ChatMessage)) return 'message'
    if (isDerived(control, message._class, activity.class.DocUpdateMessage)) return 'update'
  }
  return 'common'
}

async function isOwnMessage (
  control: TriggerControl,
  message: ActivityMessage,
  n?: InboxNotification
): Promise<boolean> {
  if (n === undefined) return false
  const author = message.createdBy ?? message.modifiedBy
  if (author === undefined) return false
  try {
    return (await getAccountBySocialId(control, author)) === n.user
  } catch {
    return false
  }
}

async function messageText (control: TriggerControl, message: ActivityMessage): Promise<string> {
  const markup = await messageToMarkup(control, message)
  if (markup === undefined) return ''
  const value = markupToText(markup).replace(/\s+/g, ' ').trim()
  return value.length > EMAIL_QUOTE_LENGTH ? value.slice(0, EMAIL_QUOTE_LENGTH - 1).trimEnd() + '…' : value
}

/**
 * Collects everything an email needs about one notification.
 * @public
 */
export async function collectEmailData (
  control: TriggerControl,
  params: CollectEmailParams
): Promise<EmailNotificationData> {
  const { doc, message, content } = params
  const n = params.notification
  const lang = control.branding?.language
  const front = frontUrl(control)
  const kind = kindOf(control, n, message)

  const object: EmailObject = {
    title: params.objectTitle,
    classLabel: await classLabel(control, doc._class, lang),
    href: params.objectLink
  }

  const data: EmailNotificationData = {
    kind,
    lang,
    frontUrl: front,
    appName: control.branding?.title ?? 'TraceX',
    workspace: control.workspace.url,
    settingsUrl: concatLink(front, `${workbenchId}/${control.workspace.url}/setting/notifications`),
    senderName: params.senderName,
    object,
    messageHref: params.messageLink,
    title: content.title,
    body: content.body
  }

  const createdOn = message?.createdOn ?? message?.modifiedOn ?? n?.createdOn
  if (createdOn !== undefined) data.time = formatEmailTime(createdOn, lang)

  // Message body: the message itself, or the mention snippet stored in the notification.
  let markup: Markup | undefined
  if (kind === 'mention' || kind === 'reply' || kind === 'message' || kind === 'common') {
    markup = message !== undefined ? await messageToMarkup(control, message) : undefined
    if (markup === undefined && n !== undefined && kind === 'mention') {
      markup = (n as MentionInboxNotification).messageHtml
    }
  }
  if (markup !== undefined && markup !== '') {
    const result = markupToEmailHtml(markup, {
      isPerson: (_class) => isDerived(control, _class, contact.class.Person),
      referenceHref: (id, _class) => objectHref(control, id, _class),
      maxLength: EMAIL_MESSAGE_LENGTH
    })
    if (result.text !== '') {
      data.messageHtml = result.html
      data.messageText = result.text
      data.messageTruncated = result.truncated
      data.references = await Promise.all(
        result.references
          .filter((it) => it.id !== doc._id)
          .slice(0, 5)
          .map(async (it) => ({
            title: it.label,
            classLabel: await classLabel(control, it.objectClass, lang),
            href: objectHref(control, it.id, it.objectClass)
          }))
      )
    }
  }

  if (kind === 'reply' && message !== undefined) {
    const parent = (
      await control.findAll(
        control.ctx,
        activity.class.ActivityMessage,
        { _id: message.attachedTo as Ref<ActivityMessage> },
        { limit: 1 }
      )
    )[0]
    if (parent !== undefined) {
      data.quote = { own: await isOwnMessage(control, parent, n), text: await messageText(control, parent) }
    }
  }

  if (kind === 'reaction') {
    data.emoji = (n as ReactionInboxNotification).emoji
    if (message !== undefined) {
      data.quote = { own: await isOwnMessage(control, message, n), text: await messageText(control, message) }
    }
  }

  if (kind === 'update' && message !== undefined) {
    data.created = (message as DocUpdateMessage).action === 'create'
  }

  if (kind === 'common') {
    const label = params.type.label
    data.typeLabel = label !== undefined ? await translate(label, {}, lang) : undefined
  }

  return data
}
