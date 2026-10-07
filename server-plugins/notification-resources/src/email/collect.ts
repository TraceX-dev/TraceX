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
import { formatName } from '@hcengineering/contact'
import { concatLink, type Class, type Doc, type Markup, type Ref } from '@hcengineering/core'
import notification, {
  type InboxNotification,
  type MentionInboxNotification,
  type NotificationType,
  type ReactionInboxNotification
} from '@hcengineering/notification'
import { getMetadata, translate } from '@hcengineering/platform'
import { emailAppName } from '@hcengineering/email-templates'
import { getAccountBySocialId, getPerson } from '@hcengineering/server-contact'
import serverCore, { type TriggerControl } from '@hcengineering/server-core'
import serverNotification from '@hcengineering/server-notification'
import { stripTags } from '@hcengineering/text-core'
import { workbenchId } from '@hcengineering/workbench'

import { messageToMarkup } from '../utils'
import { formatEmailTime, type EmailKind, type EmailNotificationData, type EmailObject } from './content'

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

function isEnglish (lang?: string): boolean {
  return lang === undefined || lang === '' || lang.toLowerCase().startsWith('en')
}

/**
 * Product name for every notification email and its plain-text part.
 * @public
 */
export function getNotificationAppName (control: TriggerControl): string {
  return emailAppName(control.branding?.title, getMetadata(serverNotification.metadata.ProductName))
}

/**
 * Class label in the email language. Platform labels are translated to English only on the server,
 * so in other languages only labels people typed themselves (e.g. master tag names) are kept.
 */
async function classLabel (
  control: TriggerControl,
  _class: Ref<Class<Doc>>,
  lang?: string
): Promise<string | undefined> {
  try {
    const label = control.hierarchy.getClass(_class).label
    if (label === undefined) return undefined
    if (!isEnglish(lang) && !label.startsWith('embedded:')) return undefined
    const value = await translate(label, {}, lang)
    return value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

function frontUrl (control: TriggerControl): string {
  return control.branding?.front ?? getMetadata(serverCore.metadata.FrontUrl) ?? ''
}

async function authorName (control: TriggerControl, message: ActivityMessage): Promise<string | undefined> {
  const author = message.createdBy ?? message.modifiedBy
  if (author === undefined) return undefined
  try {
    const person = await getPerson(control, author)
    return person !== undefined ? formatName(person.name, control.branding?.lastNameFirst) : undefined
  } catch {
    return undefined
  }
}

function kindOf (
  control: TriggerControl,
  type: NotificationType,
  n: InboxNotification | undefined,
  message: ActivityMessage | undefined
): EmailKind {
  if (n !== undefined) {
    if (isDerived(control, n._class, notification.class.MentionInboxNotification)) return 'mention'
    if (isDerived(control, n._class, notification.class.ReactionInboxNotification)) return 'reaction'
  }
  // Set on the notification type in the model, e.g. assignments and approval requests.
  if (type.emailKind !== undefined) return type.emailKind
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

/**
 * Message markup as one line of plain text, cut at `limit` with an ellipsis.
 * Uses the platform's stripTags, so the email needs no markup converter of its own.
 */
function plainText (markup: Markup, limit: number): string {
  return stripTags(markup, limit).replace(/\s+/g, ' ').trim()
}

async function messageText (control: TriggerControl, message: ActivityMessage): Promise<string> {
  const markup = await messageToMarkup(control, message)
  return markup !== undefined ? plainText(markup, EMAIL_QUOTE_LENGTH) : ''
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
  const kind = kindOf(control, params.type, n, message)

  const object: EmailObject = {
    title: params.objectTitle,
    classLabel: await classLabel(control, doc._class, lang),
    href: params.objectLink
  }

  const data: EmailNotificationData = {
    kind,
    lang,
    frontUrl: front,
    appName: getNotificationAppName(control),
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
  if (kind === 'mention' || kind === 'reply' || kind === 'message' || kind === 'request' || kind === 'common') {
    markup = message !== undefined ? await messageToMarkup(control, message) : undefined
    if (markup === undefined && n !== undefined && kind === 'mention') {
      markup = (n as MentionInboxNotification).messageHtml
    }
  }
  if (markup !== undefined && markup !== '') {
    const value = plainText(markup, EMAIL_MESSAGE_LENGTH)
    if (value !== '') {
      data.messageText = value
      data.messageTruncated = stripTags(markup).trim().length > EMAIL_MESSAGE_LENGTH
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
      const own = await isOwnMessage(control, parent, n)
      data.quote = {
        own,
        author: own ? undefined : await authorName(control, parent),
        text: await messageText(control, parent)
      }
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

  return data
}
