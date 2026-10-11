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

import { getEmailAppName, renderAccountEmail, type AccountEmail } from '../emails'

const en: { string: Record<string, string> } = require('../../lang/en.json')

jest.mock('@hcengineering/platform', () => {
  const actual = jest.requireActual('@hcengineering/platform')
  return {
    ...actual,
    ...actual.default,
    getMetadata: jest.fn(),
    // English strings with simple {param} substitution.
    translate: jest.fn(async (id: string, params: Record<string, any>) => {
      const key = id.split(':').pop() ?? id
      const template = en.string[key] ?? id
      return template.replace(/\{(\w+)\}/g, (_: string, name: string) => String(params[name] ?? `{${name}}`))
    })
  }
})

const branding = { front: 'https://tracex.example', title: 'TraceX', language: 'en' }

describe('account emails', () => {
  it('uses the branding title, then falls back to TraceX', () => {
    expect(getEmailAppName({ title: 'Acme' })).toBe('Acme')
    expect(getEmailAppName(null)).toBe('TraceX')
  })

  it('renders the sign-in code', async () => {
    const html = await renderAccountEmail('otp', { code: '123456' }, branding)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('src="https://tracex.example/tracex/email-logo.png"')
    expect(html).toContain('Your sign-in code')
    expect(html).toContain('Your verification code for TraceX.')
    expect(html).toContain('>123456<')
    expect(html).toContain('This code expires shortly.')
    expect(html).toContain('© TraceX — All rights reserved')
    expect(html).not.toContain('Button not working?')
  })

  it('renders a button with a fallback link', async () => {
    const link = 'https://tracex.example/login/recovery?id=a&b=c'
    const html = await renderAccountEmail('recovery', { link }, branding)
    expect(html).toContain('Reset your password')
    expect(html).toContain('>Reset password</a>')
    expect(html).toContain('href="https://tracex.example/login/recovery?id=a&amp;b=c"')
    expect(html).toContain('Button not working?')
    // The fallback link comes after the button.
    expect(html.indexOf('Button not working?')).toBeGreaterThan(html.indexOf('>Reset password</a>'))
  })

  it('escapes workspace names', async () => {
    const html = await renderAccountEmail(
      'invite',
      { link: 'https://tracex.example/join', ws: '<b>ws</b>', expHours: 48 },
      branding
    )
    expect(html).toContain('You&#39;ve been invited to &lt;b&gt;ws&lt;/b&gt;')
    expect(html).not.toContain('<b>ws</b>')
    expect(html).toContain('expires in 48 hours')
  })

  it('renders every account email', async () => {
    const kinds: AccountEmail[] = ['otp', 'confirmation', 'invite', 'resendInvite', 'recovery', 'passwordSetup']
    for (const kind of kinds) {
      const html = await renderAccountEmail(
        kind,
        { code: '1', link: 'https://tracex.example/x', ws: 'demo', expHours: 1, name: 'TraceX' },
        branding
      )
      expect(html).not.toMatch(/\{\w+\}/)
      expect(html.match(/<table/g)?.length).toBe(html.match(/<\/table>/g)?.length)
    }
  })
})
