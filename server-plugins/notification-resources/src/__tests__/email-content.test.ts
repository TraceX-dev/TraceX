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
  buildEmailLayout,
  defaultEmailStrings,
  fillHtml,
  fillString,
  formatEmailTime,
  type EmailNotificationData
} from '../email/content'
import { escapeHtml, renderEmail, text } from '@hcengineering/email-templates'

import { emailStrings, getEmailStrings } from '../email/strings'
import { emailDataFixtures } from './fixtures'

describe('email content', () => {
  const base: EmailNotificationData = {
    kind: 'message',
    frontUrl: 'https://front',
    appName: 'TraceX',
    workspace: 'demo-workspace',
    settingsUrl: 'https://front/workbench/ws/setting/notifications',
    senderName: 'John Doe',
    time: 'Oct 4, 23:00 UTC',
    object: { title: 'CAPA-1 Audit', classLabel: 'CAPA', href: 'https://front/card' },
    messageHref: 'https://front/card?message=m1',
    messageText: 'Hello'
  }

  it('fills placeholders', () => {
    expect(fillString('{a} and {b}', { a: 'x' })).toBe('x and')
    expect(fillHtml('<{a}> and {b}', { a: text('<x>') })).toBe('&lt;&lt;x&gt;&gt; and')
  })

  it('formats time in UTC', () => {
    expect(formatEmailTime(Date.UTC(2026, 9, 4, 23, 0), 'en')).toBe('Oct 4, 23:00 UTC')
    expect(formatEmailTime(0, 'not a locale')).toContain('UTC')
  })

  it('builds a message email', () => {
    const layout = buildEmailLayout(base)
    expect(layout.title).toBe('New message in CAPA-1 Audit')
    // One button, straight to the message.
    expect(layout.actions).toEqual([{ label: 'Reply in TraceX', href: 'https://front/card?message=m1', primary: true }])
    expect(layout.preheader).toBe('Hello')
    expect(layout.footerLinks?.[0].href).toBe(base.settingsUrl)
    expect(layout.copyright).toBe('© TraceX — All rights reserved')
  })

  it('highlights the sender and links the object in the heading', () => {
    const layout = buildEmailLayout({ ...base, kind: 'mention', object: { ...base.object, title: 'Doc <1>' } })
    expect(layout.title).toBe('John Doe mentioned you in Doc <1>')
    expect(layout.heading).toContain('<strong style="font-weight:600;color:#18181B">John Doe</strong>')
    expect(layout.heading).toContain('<a href="https://front/card"')
    expect(layout.heading).toContain('>Doc &lt;1&gt;</a>')
    expect(layout.headerNote).toBe('demo-workspace')
    // Free-text titles from the notification stay plain.
    const common = buildEmailLayout({ ...base, kind: 'common', title: 'Approve <b>', messageText: undefined })
    expect(common.heading).toBe('Approve &lt;b&gt;')
  })

  it('shows the message as escaped plain text', () => {
    const layout = buildEmailLayout({ ...base, messageText: 'a <b> @Jane' })
    expect(layout.blocks[0]).toMatchObject({ type: 'message', body: 'a &lt;b&gt; @Jane' })
  })

  it('builds a reply to own message', () => {
    const layout = buildEmailLayout({ ...base, kind: 'reply', quote: { own: true, text: 'Question?' } })
    expect(layout.title).toBe('John Doe replied to your message in CAPA-1 Audit')
    expect(layout.blocks.map((it) => it.type)).toEqual(['quote', 'message'])
    expect(layout.blocks[0]).toMatchObject({ label: 'Your message' })
  })

  it('builds a reply to someone else', () => {
    const layout = buildEmailLayout({ ...base, kind: 'reply', quote: { own: false, author: 'Alex', text: 'Q' } })
    expect(layout.title).toBe('John Doe replied in CAPA-1 Audit')
    expect(layout.blocks[0]).toMatchObject({ label: 'Alex wrote' })
  })

  it('frames mentions', () => {
    const layout = buildEmailLayout({
      ...base,
      kind: 'mention'
    })
    expect(layout.title).toBe('John Doe mentioned you in CAPA-1 Audit')
    expect(layout.blocks[0]).toMatchObject({ type: 'message', framed: true })
    expect(layout.reason).toBe(defaultEmailStrings.reasonMention)
  })

  it('adds a read-more line for truncated messages', () => {
    const layout = buildEmailLayout({ ...base, messageTruncated: true })
    expect(layout.blocks.map((it) => it.type)).toEqual(['message', 'paragraph'])
  })

  it('builds update and common emails without a reply button', () => {
    const update = buildEmailLayout({ ...base, kind: 'update', body: 'Status: Open → Done', messageText: undefined })
    expect(update.title).toBe('CAPA-1 Audit was updated')
    expect(update.actions).toEqual([{ label: 'Open in TraceX', href: base.messageHref, primary: true }])
    expect(update.reason).toBe("You're receiving this because you're subscribed to updates of “CAPA-1 Audit”.")
    // The title already names the object: no tile repeating it.
    expect(update.blocks.map((it) => it.type)).toEqual(['paragraph'])

    const common = buildEmailLayout({
      ...base,
      kind: 'common',
      title: 'Approve SOP-12',
      body: 'Please approve',
      messageText: undefined
    })
    expect(common.title).toBe('Approve SOP-12')
    // The title does not name the object, so a tile does.
    expect(common.blocks.map((it) => it.type)).toEqual(['paragraph', 'object'])
    const named = buildEmailLayout({ ...base, kind: 'common', title: 'Review CAPA-1 Audit', messageText: undefined })
    expect(named.blocks).toEqual([])
  })

  it('builds assignment emails with and without a sender', () => {
    const layout = buildEmailLayout({ ...base, kind: 'assignment' })
    expect(layout.title).toBe('John Doe assigned you CAPA-1 Audit')
    expect(layout.blocks).toEqual([])
    expect(layout.reason).toBe("You're receiving this because you were assigned.")
    expect(buildEmailLayout({ ...base, kind: 'assignment', senderName: '' }).title).toBe(
      'CAPA-1 Audit was assigned to you'
    )
  })

  it('builds co-author emails', () => {
    const layout = buildEmailLayout({ ...base, kind: 'coAuthor' })
    expect(layout.title).toBe('John Doe added you as a co-author of CAPA-1 Audit')
    expect(layout.reason).toBe("You're receiving this because you were added as a co-author.")
    expect(buildEmailLayout({ ...base, kind: 'coAuthor', senderName: '' }).title).toBe(
      'You were added as a co-author of CAPA-1 Audit'
    )
  })

  it('gives reactions their own reason', () => {
    const layout = buildEmailLayout({ ...base, kind: 'reaction', emoji: '👍', quote: { own: true, text: 'Q' } })
    expect(layout.reason).toBe("You're receiving this because someone reacted to your message.")
  })

  it('builds request emails', () => {
    const titled = buildEmailLayout({
      ...base,
      kind: 'request',
      title: 'Approve SOP-12',
      body: 'Please approve',
      messageText: undefined
    })
    expect(titled.title).toBe('Approve SOP-12')
    expect(titled.blocks.map((it) => it.type)).toEqual(['paragraph'])
    const untitled = buildEmailLayout({ ...base, kind: 'request', messageText: undefined })
    expect(untitled.title).toBe('Action required: CAPA-1 Audit')
  })

  it('translates the wording', () => {
    expect(getEmailStrings('ru').quoteOwn).toBe('Ваше сообщение')
    expect(getEmailStrings('pt-BR')).toBe(emailStrings['pt-br'])
    expect(getEmailStrings('de-AT')).toBe(emailStrings.de)
    expect(getEmailStrings('xx')).toBe(defaultEmailStrings)
    expect(getEmailStrings(undefined)).toBe(defaultEmailStrings)
    const layout = buildEmailLayout({ ...base, kind: 'reply', quote: { own: true, text: 'Q' } }, getEmailStrings('ru'))
    expect(layout.title).toBe('John Doe ответил(а) на ваше сообщение в CAPA-1 Audit')
    expect(layout.actions?.[0].label).toBe('Ответить в TraceX')
    expect(layout.copyright).toBe('© TraceX — Все права защищены')
  })

  it('has every string in every language', () => {
    const placeholders = (value: string): string =>
      [...value.matchAll(/\{(\w+)\}/g)]
        .map((m) => m[1])
        .sort()
        .join(',')
    for (const strings of Object.values(emailStrings)) {
      expect(Object.keys(strings).sort()).toEqual(Object.keys(defaultEmailStrings).sort())
      for (const [key, value] of Object.entries(strings)) {
        expect(placeholders(value)).toBe(placeholders((defaultEmailStrings as any)[key]))
      }
    }
  })

  it('renders every kind to valid documents', () => {
    for (const kind of [
      'mention',
      'reply',
      'message',
      'reaction',
      'update',
      'assignment',
      'coAuthor',
      'request',
      'common'
    ] as const) {
      const html = renderEmail(buildEmailLayout({ ...base, kind, emoji: '👍', quote: { own: true, text: 'q' } }))
      expect(html.match(/<table/g)?.length).toBe(html.match(/<\/table>/g)?.length)
      expect(html).toContain('CAPA')
    }
  })

  it('renders every fixture in every language', () => {
    for (const lang of Object.keys(emailStrings)) {
      for (const data of Object.values(emailDataFixtures())) {
        const layout = buildEmailLayout({ ...data, lang }, getEmailStrings(lang))
        const html = renderEmail(layout)
        expect(html).toContain(escapeHtml(layout.title))
        expect(html).not.toMatch(/\{\w+\}/)
        expect(html.match(/<table/g)?.length).toBe(html.match(/<\/table>/g)?.length)
        expect(html.match(/<tr>/g)?.length).toBe(html.match(/<\/tr>/g)?.length)
      }
    }
  })
})
