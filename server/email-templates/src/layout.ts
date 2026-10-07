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

import { renderBlock, type EmailBlock } from './blocks'
import { escapeHtml, safeUrl, trusted, type SafeHtml } from './html'
import { assets, colors, contentWidth, font } from './theme'

/**
 * @public
 */
export interface EmailAction {
  label: string
  href: string
  primary?: boolean
}

/**
 * Everything a notification email shows, already translated.
 * @public
 */
export interface EmailLayout {
  /** Front url, used for hosted images. */
  frontUrl: string
  /** Product name, used as the logo alt text and in the footer. */
  appName: string
  lang?: string
  /** Inbox preview line, hidden in the body. */
  preheader?: string
  /** Plain title: the document title and the heading when `heading` is not set. */
  title: string
  /** Heading with highlighted parts (names, links); replaces the plain title in the body. */
  heading?: SafeHtml
  /** Small line above the heading, e.g. the workspace name. */
  context?: string
  blocks: EmailBlock[]
  actions?: EmailAction[]
  /** Blocks under the buttons, e.g. a fallback link. */
  afterActions?: EmailBlock[]
  /** Why the receiver gets this email. */
  reason?: string
  /** Footer links, e.g. notification settings. */
  footerLinks?: Array<{ label: string, href: string }>
  /** Copyright line under the card. */
  copyright?: string
}

const table = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'

/**
 * Product name shown in emails: the first non-empty candidate (branding title, PRODUCT_NAME), else TraceX.
 * Every email uses it, so the name is the same in all of them.
 * @public
 */
export function emailAppName (...candidates: Array<string | undefined | null>): string {
  for (const name of candidates) {
    if (name !== undefined && name !== null && name.trim() !== '') return name.trim()
  }
  return 'TraceX'
}

/**
 * Absolute url of a hosted email asset.
 * @public
 */
export function assetUrl (frontUrl: string, path: string): string {
  // Trim trailing slashes with a loop: an anchored /\/+$/ regex is quadratic on long runs of '/'.
  let end = frontUrl.length
  while (end > 0 && frontUrl.charCodeAt(end - 1) === 47) end--
  return frontUrl.slice(0, end) + path
}

function header (layout: EmailLayout): string {
  const logo = assets.logo
  return `<tr><td class="tx-pad" style="background-color:${colors.header};border-radius:16px 16px 0 0;padding:18px 40px">
<table ${table}><tr>
<td valign="middle"><img src="${safeUrl(assetUrl(layout.frontUrl, logo.path))}" width="${logo.width}" height="${logo.height}" alt="${escapeHtml(layout.appName)}" style="display:block;border:0;outline:none;width:${logo.width}px;height:${logo.height}px;color:#FFFFFF;font-family:${font};font-size:18px;font-weight:800;line-height:${logo.height}px"></td>
</tr></table>
</td></tr>`
}

function button (action: EmailAction): string {
  const href = safeUrl(action.href)
  const style =
    action.primary === true
      ? `background-color:${colors.header};border:1px solid ${colors.header};color:#FFFFFF`
      : `background-color:#FFFFFF;border:1px solid ${colors.buttonBorder};color:${colors.text}`
  return `<td style="padding:0 12px 12px 0"><a href="${href}" style="display:inline-block;${style};border-radius:10px;padding:13px 24px;font-family:${font};font-size:15px;font-weight:600;line-height:18px;text-decoration:none">${escapeHtml(action.label)}</a></td>`
}

function actions (layout: EmailLayout): string {
  const list = layout.actions ?? []
  if (list.length === 0) return ''
  return `<tr><td class="tx-pad" style="padding:32px 40px 0 40px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${list
    .map(button)
    .join('')}</tr></table></td></tr>`
}

function footer (layout: EmailLayout): string {
  const reason = layout.reason !== undefined && layout.reason !== '' ? escapeHtml(layout.reason) : ''
  const links = (layout.footerLinks ?? [])
    .map(
      (it) =>
        `<a href="${safeUrl(it.href)}" style="color:${colors.chipText};text-decoration:underline">${escapeHtml(it.label)}</a>`
    )
    .join(' &middot; ')
  const content = [reason, links].filter((it) => it !== '').join(' ')
  if (content === '') return '<tr><td style="padding:0 0 36px 0;font-size:0;line-height:0">&nbsp;</td></tr>'
  return `<tr><td class="tx-pad" style="padding:16px 40px 36px 40px">
<table ${table}><tr><td style="border-top:1px solid ${colors.divider};padding:24px 0 0 0;font-family:${font};font-size:13px;line-height:1.6;color:${colors.faint}">${content}</td></tr></table>
</td></tr>`
}

function context (layout: EmailLayout): string {
  if (layout.context === undefined || layout.context === '') return ''
  return `<div style="margin:0 0 8px 0;font-family:${font};font-size:13px;line-height:1.4;font-weight:500;color:${colors.muted}">${escapeHtml(layout.context)}</div>`
}

function heading (layout: EmailLayout): string {
  // A rich heading reads as a sentence with highlighted names; a plain title stays a title.
  if (layout.heading !== undefined) {
    return `<h1 style="margin:0;font-family:${font};font-size:18px;line-height:1.45;font-weight:400;color:${colors.body}">${layout.heading}</h1>`
  }
  return `<h1 style="margin:0;font-family:${font};font-size:20px;line-height:1.35;font-weight:600;letter-spacing:-0.2px;color:${colors.text}">${escapeHtml(layout.title)}</h1>`
}

/**
 * Full HTML document of a notification email, light theme.
 * @public
 */
export function renderEmail (layout: EmailLayout): SafeHtml {
  const lang = escapeHtml(layout.lang ?? 'en')
  const preheader =
    layout.preheader !== undefined && layout.preheader !== ''
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${escapeHtml(layout.preheader)}</div>`
      : ''
  const blocks = layout.blocks
    .map(
      (block, i) =>
        `<tr><td class="tx-pad" style="padding:${i === 0 ? 24 : 14}px 40px 0 40px">${renderBlock(block)}</td></tr>`
    )
    .join('\n')
  const hasActions = (layout.actions ?? []).length > 0
  const afterActions = (layout.afterActions ?? [])
    .map((block) => `<tr><td class="tx-pad" style="padding:20px 40px 0 40px">${renderBlock(block)}</td></tr>`)
    .join('\n')
  const copyright = layout.copyright ?? `© ${layout.appName} — All rights reserved`

  return trusted(`<!DOCTYPE html>
<html lang="${lang}"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(layout.title)}</title>
<style>:root{color-scheme:light;supported-color-schemes:light}a:hover{opacity:.9}@media (max-width:620px){.tx-pad{padding-left:24px!important;padding-right:24px!important}}</style>
</head>
<body style="margin:0;padding:0;background-color:${colors.page};font-family:${font};-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%">
${preheader}
<table ${table} style="background-color:${colors.page}"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="${contentWidth}" cellpadding="0" cellspacing="0" border="0" style="max-width:${contentWidth}px;width:100%">
${header(layout)}
<tr><td style="background-color:${colors.card};border:1px solid ${colors.border};border-top:none;border-radius:0 0 16px 16px">
<table ${table}>
<tr><td class="tx-pad" style="padding:32px 40px 0 40px">${context(layout)}${heading(layout)}</td></tr>
${blocks}
${hasActions ? actions(layout) : ''}
${afterActions}
${footer(layout)}
</table>
</td></tr>
<tr><td align="center" style="padding:24px 0 0 0;font-family:${font};font-size:12px;line-height:1.5;color:${colors.faint}">${escapeHtml(copyright)}</td></tr>
</table>
</td></tr></table>
</body></html>`)
}
