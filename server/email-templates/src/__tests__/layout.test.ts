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

import { emphasis, emphasisLink, escapeHtml, initials, join, safeUrl, text } from '../html'
import { assetUrl, emailAppName, renderEmail, type EmailLayout } from '../layout'

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

  it('escapes highlighted parts', () => {
    expect(emphasis('<x>')).toContain('&lt;x&gt;')
    expect(emphasisLink('javascript:alert(1)', 'a')).toContain('href="#"')
  })
})

describe('renderEmail', () => {
  it('renders a light-only document with logo and footer', () => {
    const html = renderEmail(minimal())
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<meta name="color-scheme" content="light">')
    expect(html).not.toContain('prefers-color-scheme')
    expect(html).toContain(`src="${front}/tracex/email-logo.png"`)
    expect(html).toContain('alt="TraceX"')
    expect(html).toContain('width="135" height="20"')
    expect(html).toContain('© TraceX — All rights reserved')
  })

  it('picks the first non-empty product name', () => {
    expect(emailAppName('Acme', 'Other')).toBe('Acme')
    expect(emailAppName(undefined, ' ', 'Product')).toBe('Product')
    expect(emailAppName(undefined, null)).toBe('TraceX')
  })

  it('trims any number of trailing slashes quickly', () => {
    expect(assetUrl(`${front}///`, '/x.png')).toBe(`${front}/x.png`)
    expect(assetUrl('', '/x.png')).toBe('/x.png')
    const started = Date.now()
    assetUrl('/'.repeat(100000) + 'x', '/x.png')
    expect(Date.now() - started).toBeLessThan(100)
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
        reason: evil,
        headerNote: evil,
        footerLinks: [{ label: evil, href: 'javascript:alert(1)' }],
        actions: [{ label: evil, href: 'javascript:alert(1)', primary: true }],
        blocks: [
          { type: 'quote', label: evil, body: text(evil) },
          {
            type: 'message',
            sender: evil,
            time: evil,
            body: text(evil)
          },
          { type: 'object', title: evil, subtitle: evil, href: 'javascript:alert(1)' }
        ]
      })
    )
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('javascript:')
  })

  it('renders a code and a note', () => {
    const html = renderEmail(
      minimal({
        blocks: [
          { type: 'code', code: '12<34' },
          { type: 'note', body: text('Copy <this>') }
        ]
      })
    )
    expect(html).toContain('letter-spacing:10px')
    expect(html).toContain('12&lt;34')
    expect(html).toContain('Copy &lt;this&gt;')
  })

  it('renders a rich heading and a header note', () => {
    const html = renderEmail(
      minimal({
        title: 'Jane mentioned you in Doc',
        heading: join([emphasis('Jane'), text(' mentioned you in '), emphasisLink(`${front}/doc`, 'Doc')]),
        headerNote: 'Demo workspace'
      })
    )
    expect(html).toContain('<title>Jane mentioned you in Doc</title>')
    expect(html).toContain('font-size:18px;line-height:1.45;font-weight:400')
    expect(html).toContain(`<a href="${front}/doc"`)
    expect(html).toContain('>Demo workspace</td>')
  })

  it('omits empty optional parts', () => {
    const html = renderEmail(minimal())
    expect(html).not.toContain('Reply in')
    expect(html).not.toContain('border-top:1px solid #ECECF0;padding:24px 0 0 0')
    expect(html).not.toContain('display:none;max-height:0')
  })
})
