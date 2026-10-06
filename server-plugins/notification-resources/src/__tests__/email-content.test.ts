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

import type { Class, Doc, Ref } from '@hcengineering/core'
import { MarkupMarkType, MarkupNodeType, type MarkupNode } from '@hcengineering/text-core'

import {
  buildEmailLayout,
  defaultEmailStrings,
  fillString,
  formatEmailTime,
  type EmailNotificationData
} from '../email/content'
import { escapeHtml, renderEmail, text } from '@hcengineering/email-templates'

import { emailStrings, getEmailStrings } from '../email/strings'
import { markupToEmailHtml, type MarkupToEmailOptions } from '../email/markup'
import { emailDataFixtures } from './fixtures'

const personClass = 'contact:class:Person' as Ref<Class<Doc>>
const cardClass = 'card:class:Card' as Ref<Class<Doc>>

const options: MarkupToEmailOptions = {
  isPerson: (_class) => _class === personClass,
  referenceHref: (id) => `https://front/obj/${id}`
}

function txt (value: string, marks?: Array<{ type: MarkupMarkType, attrs?: Record<string, any> }>): MarkupNode {
  return { type: MarkupNodeType.text, text: value, marks }
}

function doc (...content: MarkupNode[]): MarkupNode {
  return { type: MarkupNodeType.doc, content }
}

function p (...content: MarkupNode[]): MarkupNode {
  return { type: MarkupNodeType.paragraph, content }
}

function ref (id: string, objectclass: Ref<Class<Doc>>, label: string): MarkupNode {
  return { type: MarkupNodeType.reference, attrs: { id, objectclass, label } }
}

describe('markupToEmailHtml', () => {
  it('renders paragraphs and marks with escaping', () => {
    const res = markupToEmailHtml(
      doc(p(txt('a <b> '), txt('bold', [{ type: MarkupMarkType.bold }])), p(txt('second'))),
      options
    )
    expect(res.html).toBe(
      '<p style="margin:0">a &lt;b&gt; <strong style="font-weight:700">bold</strong></p><p style="margin:12px 0 0 0">second</p>'
    )
    expect(res.text).toBe('a <b> bold second')
    expect(res.truncated).toBe(false)
  })

  it('accepts serialized markup and plain text', () => {
    expect(markupToEmailHtml(JSON.stringify(doc(p(txt('json')))), options).text).toBe('json')
    expect(markupToEmailHtml('plain <i>', options).html).toContain('plain &lt;i&gt;')
  })

  it('keeps only safe links', () => {
    const res = markupToEmailHtml(
      doc(
        p(
          txt('ok', [{ type: MarkupMarkType.link, attrs: { href: 'https://x.y/?a=1&b=2' } }]),
          txt(' bad', [{ type: MarkupMarkType.link, attrs: { href: 'javascript:alert(1)' } }])
        )
      ),
      options
    )
    expect(res.html).toContain('href="https://x.y/?a=1&amp;b=2"')
    expect(res.html).not.toContain('javascript')
    expect(res.html).toContain(' bad')
  })

  it('renders person references as mentions and collects other references', () => {
    const res = markupToEmailHtml(
      doc(
        p(
          ref('p1', personClass, 'Jane Doe'),
          txt(' see '),
          ref('c1', cardClass, 'Card <1>'),
          ref('c1', cardClass, 'Card <1>')
        )
      ),
      options
    )
    expect(res.html).toContain('@Jane Doe')
    expect(res.html).toContain('background-color:#FFF0E6')
    expect(res.html).toContain('<a href="https://front/obj/c1"')
    expect(res.html).toContain('Card &lt;1&gt;')
    expect(res.references).toEqual([{ id: 'c1', objectClass: cardClass, label: 'Card <1>' }])
    expect(res.text).toBe('@Jane Doe see Card <1>Card <1>')
  })

  it('renders lists, todo items, hard breaks and emoji', () => {
    const res = markupToEmailHtml(
      doc(
        {
          type: MarkupNodeType.bullet_list,
          content: [{ type: MarkupNodeType.list_item, content: [p(txt('one'))] }]
        },
        {
          type: MarkupNodeType.todoList,
          content: [{ type: MarkupNodeType.todoItem, attrs: { checked: true }, content: [p(txt('done'))] }]
        },
        p(txt('a'), { type: MarkupNodeType.hard_break }, txt('b'), {
          type: MarkupNodeType.emoji,
          attrs: { emoji: '👍', kind: 'unicode' }
        })
      ),
      options
    )
    expect(res.html).toContain(
      '<ul style="margin:0;padding:0 0 0 22px"><li style="margin:4px 0 0 0"><div>one</div></li></ul>'
    )
    expect(res.html).toContain('&#9745;&nbsp;<div>done</div>')
    expect(res.html).toContain('a<br>b👍')
  })

  it('drops embeds and unknown attributes, keeps text of unknown nodes', () => {
    const res = markupToEmailHtml(
      doc(
        { type: MarkupNodeType.embed, attrs: { src: 'https://evil' } },
        { type: 'somethingNew' as MarkupNodeType, content: [txt('inner')] }
      ),
      options
    )
    expect(res.html).not.toContain('evil')
    expect(res.text).toBe('inner')
  })

  it('counts mentions towards the length limit', () => {
    const mentions = Array.from({ length: 200 }, (_, i) => ref(`p${i}`, personClass, `Person ${i}`))
    const res = markupToEmailHtml(doc(p(...mentions)), { ...options, maxLength: 30 })
    expect(res.truncated).toBe(true)
    expect(res.text.length).toBeLessThanOrEqual(31)
    expect(res.html.match(/background-color:#FFF0E6/g)?.length).toBe(3)
    expect(res.text.endsWith('…')).toBe(true)
  })

  it('truncates long messages on a word boundary', () => {
    const res = markupToEmailHtml(doc(p(txt('alpha beta gamma delta')), p(txt('never'))), { ...options, maxLength: 13 })
    expect(res.truncated).toBe(true)
    expect(res.text).toBe('alpha beta…')
    expect(res.html).not.toContain('never')
  })
})

describe('email content', () => {
  const base: EmailNotificationData = {
    kind: 'message',
    frontUrl: 'https://front',
    appName: 'TraceX',
    settingsUrl: 'https://front/workbench/ws/setting/notifications',
    senderName: 'John Doe',
    time: 'Oct 4, 23:00 UTC',
    object: { title: 'CAPA-1 Audit', classLabel: 'CAPA', href: 'https://front/card' },
    messageHref: 'https://front/card?message=m1',
    messageHtml: text('Hello'),
    messageText: 'Hello'
  }

  it('fills placeholders', () => {
    expect(fillString('{a} and {b}', { a: 'x' })).toBe('x and')
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

  it('frames mentions and adds reference tiles', () => {
    const layout = buildEmailLayout({
      ...base,
      kind: 'mention',
      references: [{ title: 'Other', classLabel: 'Card', href: 'https://front/o' }]
    })
    expect(layout.title).toBe('John Doe mentioned you in CAPA-1 Audit')
    expect(layout.blocks[0]).toMatchObject({ type: 'message', framed: true })
    expect((layout.blocks[0] as any).objects).toHaveLength(1)
    expect(layout.reason).toBe(defaultEmailStrings.reasonMention)
  })

  it('adds a read-more line for truncated messages', () => {
    const layout = buildEmailLayout({ ...base, messageTruncated: true })
    expect(layout.blocks.map((it) => it.type)).toEqual(['message', 'paragraph'])
  })

  it('builds update and common emails without a reply button', () => {
    const update = buildEmailLayout({ ...base, kind: 'update', body: 'Status: Open → Done', messageHtml: undefined })
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
      messageHtml: undefined
    })
    expect(common.title).toBe('Approve SOP-12')
    // The title does not name the object, so a tile does.
    expect(common.blocks.map((it) => it.type)).toEqual(['paragraph', 'object'])
    const named = buildEmailLayout({ ...base, kind: 'common', title: 'Review CAPA-1 Audit', messageHtml: undefined })
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
      messageHtml: undefined
    })
    expect(titled.title).toBe('Approve SOP-12')
    expect(titled.blocks.map((it) => it.type)).toEqual(['paragraph'])
    const untitled = buildEmailLayout({ ...base, kind: 'request', messageHtml: undefined })
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
