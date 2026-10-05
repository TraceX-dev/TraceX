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

import { emailFixtures } from '../email/fixtures'
import { escapeHtml, initials, mention, safeUrl, text } from '../email/html'
import { renderEmail, type EmailLayout } from '../email/layout'

const front = 'https://tracex.example'

function minimal (patch: Partial<EmailLayout> = {}): EmailLayout {
  return { frontUrl: front, appName: 'TraceX', title: 'Title', blocks: [], ...patch }
}

describe('email html helpers', () => {
  it('escapes html special characters', () => {
    expect(escapeHtml(`<b a="1">'&'</b>`)).toBe('&lt;b a=&quot;1&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;')
    expect(escapeHtml(undefined)).toBe('')
  })

  it('keeps line breaks in text', () => {
    expect(text('a<b\nc')).toBe('a&lt;b<br>c')
  })

  it('allows only http(s) and mailto urls', () => {
    expect(safeUrl('https://a.b/c?x=1&y=2')).toBe('https://a.b/c?x=1&amp;y=2')
    expect(safeUrl('mailto:a@b.c')).toBe('mailto:a@b.c')
    expect(safeUrl('javascript:alert(1)')).toBe('#')
    expect(safeUrl(' data:text/html,x')).toBe('#')
    expect(safeUrl(undefined)).toBe('#')
  })

  it('builds initials', () => {
    expect(initials('John Doe')).toBe('JD')
    expect(initials('  jane  ')).toBe('J')
    expect(initials('Тест Пример Образец')).toBe('ТП')
    expect(initials('')).toBe('?')
  })

  it('escapes mention names', () => {
    expect(mention('<x>')).toContain('@&lt;x&gt;')
  })
})

describe('renderEmail', () => {
  it('renders a light-only document with logo and footer', () => {
    const html = renderEmail(minimal({ eventLabel: 'New reply' }))
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<meta name="color-scheme" content="light">')
    expect(html).not.toContain('prefers-color-scheme')
    expect(html).toContain(`src="${front}/tracex/email-logo.png"`)
    expect(html).toContain('alt="TraceX"')
    expect(html).toContain('New reply')
    expect(html).toContain('© TraceX — All rights reserved')
  })

  it('does not double the slash in asset urls', () => {
    expect(renderEmail(minimal({ frontUrl: `${front}/` }))).toContain(`src="${front}/tracex/email-logo.png"`)
  })

  it('escapes every user supplied string', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const html = renderEmail(
      minimal({
        title: evil,
        preheader: evil,
        eventLabel: evil,
        context: { chip: evil, workspace: evil },
        reason: evil,
        footerLinks: [{ label: evil, href: 'javascript:alert(1)' }],
        actions: [{ label: evil, href: 'javascript:alert(1)', primary: true }],
        blocks: [
          { type: 'quote', label: evil, body: text(evil) },
          {
            type: 'message',
            sender: evil,
            time: evil,
            body: text(evil),
            objects: [{ type: 'object', title: evil, href: 'javascript:alert(1)' }]
          },
          { type: 'object', title: evil, subtitle: evil, href: 'javascript:alert(1)' },
          { type: 'fields', rows: [{ label: evil, from: text(evil), to: text(evil) }] }
        ]
      })
    )
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('javascript:')
  })

  it('omits empty optional parts', () => {
    const html = renderEmail(minimal())
    expect(html).not.toContain('Reply in')
    expect(html).not.toContain('border-top:1px solid #ECECF0;padding:24px 0 0 0')
    expect(html).not.toContain('display:none;max-height:0')
  })

  it('renders every fixture', () => {
    const fixtures = emailFixtures(front)
    expect(Object.keys(fixtures)).toEqual(['reply', 'mention', 'message', 'assignment', 'approval', 'update', 'system'])
    for (const [kind, layout] of Object.entries(fixtures)) {
      const html = renderEmail(layout)
      expect(html).toContain(escapeHtml(layout.title))
      expect(html.match(/<table/g)?.length).toBe(html.match(/<\/table>/g)?.length)
      expect(html.match(/<tr>/g)?.length).toBe(html.match(/<\/tr>/g)?.length)
      expect(kind.length).toBeGreaterThan(0)
    }
  })
})
