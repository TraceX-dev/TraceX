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
import { text } from '../email/html'
import { renderEmail } from '../email/layout'
import { markupToEmailHtml, type MarkupToEmailOptions } from '../email/markup'

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
    workspace: 'ws',
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
    expect(layout.eventLabel).toBe('New message')
    expect(layout.title).toBe('New message in CAPA-1 Audit')
    expect(layout.context).toEqual({ chip: 'CAPA', workspace: 'ws' })
    expect(layout.actions).toEqual([
      { label: 'Reply in TraceX', href: 'https://front/card?message=m1', primary: true },
      { label: 'Open CAPA', href: 'https://front/card' }
    ])
    expect(layout.preheader).toBe('Hello')
    expect(layout.footerLinks?.[0].href).toBe(base.settingsUrl)
    expect(layout.copyright).toBe('© TraceX — All rights reserved')
  })

  it('builds a reply to own message', () => {
    const layout = buildEmailLayout({ ...base, kind: 'reply', quote: { own: true, text: 'Question?' } })
    expect(layout.title).toBe('John Doe replied to your message')
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
    expect(layout.title).toBe('John Doe mentioned you')
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
    expect(update.reason).toBe("You're receiving this because you're subscribed to updates of this CAPA.")

    const common = buildEmailLayout({
      ...base,
      kind: 'common',
      typeLabel: 'Approval requested',
      title: 'Approve SOP-12',
      body: 'Please approve',
      messageHtml: undefined
    })
    expect(common.eventLabel).toBe('Approval requested')
    expect(common.title).toBe('Approve SOP-12')
    expect(common.blocks.map((it) => it.type)).toEqual(['paragraph', 'object'])

    const card = buildEmailLayout({ ...base, kind: 'update', object: { ...base.object, classLabel: 'Sample card' } })
    expect(card.reason).toBe("You're receiving this because you're subscribed to updates of this sample card.")
  })

  it('renders every kind to valid documents', () => {
    for (const kind of ['mention', 'reply', 'message', 'reaction', 'update', 'common'] as const) {
      const html = renderEmail(buildEmailLayout({ ...base, kind, emoji: '👍', quote: { own: true, text: 'q' } }))
      expect(html.match(/<table/g)?.length).toBe(html.match(/<\/table>/g)?.length)
      expect(html).toContain('CAPA')
    }
  })
})
