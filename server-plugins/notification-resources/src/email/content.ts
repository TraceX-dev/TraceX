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

import {
  assets,
  assetUrl,
  text,
  type EmailAction,
  type EmailBlock,
  type EmailLayout,
  type ObjectLinkBlock,
  type SafeHtml
} from '@hcengineering/email-templates'

/**
 * What happened, decides the email layout.
 * @public
 */
export type EmailKind =
  'mention' | 'reply' | 'message' | 'reaction' | 'update' | 'assignment' | 'coAuthor' | 'request' | 'common'

/**
 * Object tile data.
 * @public
 */
export interface EmailObject {
  title: string
  /** Class label, e.g. a master tag name; omitted when it is not in the email language. */
  classLabel?: string
  href: string
}

/**
 * Everything collected about one notification, ready for rendering.
 * @public
 */
export interface EmailNotificationData {
  kind: EmailKind
  lang?: string
  frontUrl: string
  appName: string
  settingsUrl: string
  senderName: string
  /** Formatted time of the message. */
  time?: string
  /** The object the notification is about. */
  object: EmailObject
  /** Link to the message itself (falls back to the object link). */
  messageHref?: string
  /** Message body, already sanitized. */
  messageHtml?: SafeHtml
  messageText?: string
  messageTruncated?: boolean
  /** Objects referenced in the message. */
  references?: EmailObject[]
  /** Parent message for replies, reacted message for reactions. */
  quote?: { own: boolean, author?: string, text: string }
  /** Reaction emoji. */
  emoji?: string
  /** Notification title / body texts from the inbox notification. */
  title?: string
  body?: string
  /** The object was created rather than updated. */
  created?: boolean
}

/**
 * Email wording; `{name}` placeholders are filled from the data.
 * English is the default, translations come from IntlStrings.
 * @public
 */
export interface EmailStrings {
  titleMention: string
  titleReply: string
  titleReplyOwn: string
  titleMessage: string
  titleReaction: string
  titleUpdate: string
  titleCreate: string
  titleAssignment: string
  titleAssignmentNoSender: string
  titleCoAuthor: string
  titleCoAuthorNoSender: string
  titleRequest: string
  quoteOwn: string
  quoteOther: string
  quoteAnonymous: string
  actionReply: string
  actionOpen: string
  readMore: string
  reasonMention: string
  reasonConversation: string
  reasonObject: string
  reasonAssignment: string
  reasonCoAuthor: string
  reasonReaction: string
  reasonRequest: string
  reasonDefault: string
  notificationSettings: string
  copyright: string
}

/**
 * @public
 */
export const defaultEmailStrings: EmailStrings = {
  titleMention: '{sender} mentioned you in {object}',
  titleReply: '{sender} replied in {object}',
  titleReplyOwn: '{sender} replied to your message in {object}',
  titleMessage: 'New message in {object}',
  titleReaction: '{sender} reacted {emoji} to your message in {object}',
  titleUpdate: '{object} was updated',
  titleCreate: '{object} was created',
  titleAssignment: '{sender} assigned you {object}',
  titleAssignmentNoSender: '{object} was assigned to you',
  titleCoAuthor: '{sender} added you as a co-author of {object}',
  titleCoAuthorNoSender: 'You were added as a co-author of {object}',
  titleRequest: 'Action required: {object}',
  quoteOwn: 'Your message',
  quoteOther: '{author} wrote',
  quoteAnonymous: 'Original message',
  actionReply: 'Reply in {app}',
  actionOpen: 'Open in {app}',
  readMore: 'Read the full message in {app}',
  reasonMention: "You're receiving this because you were mentioned.",
  reasonConversation: "You're receiving this because you're subscribed to this conversation.",
  reasonObject: "You're receiving this because you're subscribed to updates of “{object}”.",
  reasonAssignment: "You're receiving this because you were assigned.",
  reasonCoAuthor: "You're receiving this because you were added as a co-author.",
  reasonReaction: "You're receiving this because someone reacted to your message.",
  reasonRequest: "You're receiving this because your action is requested.",
  reasonDefault: "You're receiving this because of your notification settings.",
  notificationSettings: 'Notification settings',
  copyright: '© {app} — All rights reserved'
}

/**
 * Fills `{key}` placeholders; unknown keys are left empty.
 * @public
 */
export function fillString (template: string, params: Record<string, string | undefined>): string {
  return template
    .replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * "Oct 4, 23:00 UTC". The receiver's time zone is unknown, so UTC is shown explicitly.
 * @public
 */
export function formatEmailTime (timestamp: number, lang = 'en', timeZone = 'UTC'): string {
  let locale = lang
  try {
    Intl.DateTimeFormat.supportedLocalesOf(lang)
  } catch {
    locale = 'en'
  }
  const date = new Date(timestamp)
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone }).format(date)
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(
    date
  )
  return `${day}, ${time}${timeZone === 'UTC' ? ' UTC' : ''}`
}

const PREHEADER_LENGTH = 140

function preheader (value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length > PREHEADER_LENGTH ? line.slice(0, PREHEADER_LENGTH - 1).trimEnd() + '…' : line
}

function objectTile (data: EmailNotificationData, object: EmailObject): ObjectLinkBlock {
  return {
    type: 'object',
    title: object.title,
    subtitle: object.classLabel,
    href: object.href,
    iconUrl: assetUrl(data.frontUrl, assets.cardIcon.path)
  }
}

function quoteBlock (data: EmailNotificationData, strings: EmailStrings): EmailBlock | undefined {
  const quote = data.quote
  if (quote === undefined || quote.text === '') return undefined
  const label = quote.own
    ? strings.quoteOwn
    : quote.author !== undefined && quote.author !== ''
      ? fillString(strings.quoteOther, { author: quote.author })
      : strings.quoteAnonymous
  return { type: 'quote', label, body: text(quote.text) }
}

function messageBlocks (data: EmailNotificationData, strings: EmailStrings, framed: boolean): EmailBlock[] {
  if (data.messageHtml === undefined || data.messageHtml === '') return []
  const references = (data.references ?? []).map((it) => objectTile(data, it))
  const blocks: EmailBlock[] = [
    {
      type: 'message',
      sender: data.senderName,
      time: data.time,
      body: data.messageHtml,
      framed,
      objects: references
    }
  ]
  if (data.messageTruncated === true) {
    blocks.push({
      type: 'paragraph',
      body: text(fillString(strings.readMore, { app: data.appName }))
    })
  }
  return blocks
}

function bodyParagraph (value: string | undefined): EmailBlock[] {
  if (value === undefined || value.trim() === '') return []
  return [{ type: 'paragraph', body: text(value.trim()) }]
}

/**
 * Builds the email layout for collected notification data. Pure: no IO.
 * @public
 */
export function buildEmailLayout (
  data: EmailNotificationData,
  strings: EmailStrings = defaultEmailStrings
): EmailLayout {
  const params: Record<string, string | undefined> = {
    sender: data.senderName,
    object: data.object.title,
    app: data.appName,
    emoji: data.emoji
  }
  const isConversation = data.kind === 'mention' || data.kind === 'reply' || data.kind === 'message'

  // One idea per element: the title names the event and the object, so there is no header label,
  // no object chip and no tile repeating the object; one button; a one-line footer.
  let title: string
  let blocks: EmailBlock[]
  let reason: string

  switch (data.kind) {
    case 'mention':
      title = fillString(strings.titleMention, params)
      blocks = messageBlocks(data, strings, true)
      reason = strings.reasonMention
      break
    case 'reply':
      title = fillString(data.quote?.own === true ? strings.titleReplyOwn : strings.titleReply, params)
      blocks = [quoteBlock(data, strings), ...messageBlocks(data, strings, false)].filter(
        (it): it is EmailBlock => it !== undefined
      )
      reason = strings.reasonConversation
      break
    case 'message':
      title = fillString(strings.titleMessage, params)
      blocks = messageBlocks(data, strings, false)
      reason = strings.reasonConversation
      break
    case 'reaction':
      title = fillString(strings.titleReaction, params)
      blocks = [quoteBlock(data, strings)].filter((it): it is EmailBlock => it !== undefined)
      reason = strings.reasonReaction
      break
    case 'update':
      title = fillString(data.created === true ? strings.titleCreate : strings.titleUpdate, params)
      blocks = bodyParagraph(data.body)
      reason = fillString(strings.reasonObject, params)
      break
    case 'assignment':
      title = fillString(data.senderName !== '' ? strings.titleAssignment : strings.titleAssignmentNoSender, params)
      blocks = []
      reason = strings.reasonAssignment
      break
    case 'coAuthor':
      title = fillString(data.senderName !== '' ? strings.titleCoAuthor : strings.titleCoAuthorNoSender, params)
      blocks = []
      reason = strings.reasonCoAuthor
      break
    case 'request':
      title = data.title !== undefined && data.title !== '' ? data.title : fillString(strings.titleRequest, params)
      blocks = [...bodyParagraph(data.body), ...messageBlocks(data, strings, false)]
      reason = strings.reasonRequest
      break
    case 'common':
      title = data.title !== undefined && data.title !== '' ? data.title : data.object.title
      blocks = [
        ...bodyParagraph(data.body),
        ...messageBlocks(data, strings, false),
        // Name the object only when the title does not.
        ...(title.includes(data.object.title) ? [] : [objectTile(data, data.object)])
      ]
      reason = strings.reasonDefault
      break
  }

  const action: EmailAction = {
    label: fillString(isConversation ? strings.actionReply : strings.actionOpen, params),
    href: data.messageHref ?? data.object.href,
    primary: true
  }

  return {
    frontUrl: data.frontUrl,
    appName: data.appName,
    lang: data.lang,
    preheader: preheader(data.messageText ?? data.body ?? data.quote?.text),
    title,
    blocks,
    actions: [action],
    reason,
    footerLinks: [{ label: strings.notificationSettings, href: data.settingsUrl }],
    copyright: fillString(strings.copyright, params)
  }
}
