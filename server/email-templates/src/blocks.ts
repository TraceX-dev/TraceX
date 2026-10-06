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

import { escapeHtml, initials, safeUrl, trusted, type SafeHtml } from './html'
import { colors, font } from './theme'

/**
 * Quoted earlier message, e.g. the one being replied to.
 * @public
 */
export interface QuoteBlock {
  type: 'quote'
  label: string
  body: SafeHtml
}

/**
 * A message with its author.
 * @public
 */
export interface MessageBlock {
  type: 'message'
  sender: string
  time?: string
  body: SafeHtml
  /** Draw a border around the message (mentions). */
  framed?: boolean
  /** Objects referenced by the message, shown under its text. */
  objects?: ObjectLinkBlock[]
}

/**
 * Link to an object (card, document, issue), shown as a small tile.
 * @public
 */
export interface ObjectLinkBlock {
  type: 'object'
  title: string
  subtitle?: string
  href: string
  /** Absolute icon url; omitted icon leaves only the text. */
  iconUrl?: string
}

/**
 * Plain paragraph of text.
 * @public
 */
export interface ParagraphBlock {
  type: 'paragraph'
  body: SafeHtml
}

/**
 * One-time code shown large, e.g. a sign-in code.
 * @public
 */
export interface CodeBlock {
  type: 'code'
  code: string
}

/**
 * Small muted text, e.g. a fallback link under a button.
 * @public
 */
export interface NoteBlock {
  type: 'note'
  body: SafeHtml
}

/**
 * @public
 */
export type EmailBlock = QuoteBlock | MessageBlock | ObjectLinkBlock | ParagraphBlock | CodeBlock | NoteBlock

const table = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'

function quote (block: QuoteBlock): string {
  return `<table ${table} style="background-color:${colors.quoteBg};border-radius:10px;border-collapse:separate"><tr><td style="padding:14px 16px">
<table ${table}><tr>
<td width="3" style="width:3px;background-color:${colors.quoteBar};border-radius:2px;font-size:0;line-height:0">&nbsp;</td>
<td style="padding:0 0 0 12px;font-family:${font}">
<div style="font-size:12px;font-weight:600;color:${colors.muted};line-height:1.4;margin:0 0 4px 0">${escapeHtml(block.label)}</div>
<div style="font-size:14px;line-height:1.5;color:${colors.secondary}">${block.body}</div>
</td></tr></table>
</td></tr></table>`
}

function avatar (name: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="40" height="40" align="center" valign="middle" style="width:40px;height:40px;border-radius:20px;background-color:${colors.avatar};color:#FFFFFF;font-family:${font};font-size:14px;font-weight:700;line-height:40px;text-align:center">${escapeHtml(initials(name))}</td></tr></table>`
}

function message (block: MessageBlock): string {
  const time =
    block.time !== undefined && block.time !== ''
      ? `&nbsp;&nbsp;<span style="font-size:13px;font-weight:400;color:${colors.muted}">${escapeHtml(block.time)}</span>`
      : ''
  const inner = `<table ${table}><tr>
<td width="40" valign="top" style="width:40px;padding:0 14px 0 0">${avatar(block.sender)}</td>
<td valign="top" style="font-family:${font}">
<div style="font-size:15px;font-weight:700;color:${colors.text};line-height:1.4;margin:0 0 6px 0">${escapeHtml(block.sender)}${time}</div>
<div style="font-size:16px;line-height:1.6;color:${colors.body};word-wrap:break-word;overflow-wrap:anywhere">${block.body}</div>${(
    block.objects ?? []
  )
    .map((it) => `<div style="margin:10px 0 0 0">${objectLink(it)}</div>`)
    .join('')}
</td></tr></table>`
  if (block.framed !== true) return inner
  return `<table ${table} style="border:1px solid ${colors.border};border-radius:12px;border-collapse:separate"><tr><td style="padding:20px">${inner}</td></tr></table>`
}

function objectLink (block: ObjectLinkBlock): string {
  const href = safeUrl(block.href)
  const icon =
    block.iconUrl !== undefined
      ? `<td width="18" valign="middle" style="width:18px;padding:0 10px 0 0"><img src="${safeUrl(block.iconUrl)}" width="18" height="18" alt="" style="display:block;border:0;width:18px;height:18px"></td>`
      : ''
  const subtitle =
    block.subtitle !== undefined && block.subtitle !== ''
      ? `<div style="font-size:12px;color:${colors.muted};line-height:1.4">${escapeHtml(block.subtitle)}</div>`
      : ''
  return `<table ${table} style="border:1px solid ${colors.border};border-radius:10px;border-collapse:separate"><tr><td style="padding:10px 14px">
<a href="${href}" style="text-decoration:none;color:${colors.text};display:block"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${icon}
<td valign="middle" style="font-family:${font}"><div style="font-size:14px;font-weight:600;color:${colors.text};line-height:1.4">${escapeHtml(block.title)}</div>${subtitle}</td>
</tr></table></a></td></tr></table>`
}

function paragraph (block: ParagraphBlock): string {
  return `<div style="font-family:${font};font-size:15px;line-height:1.65;color:${colors.secondary}">${block.body}</div>`
}

function code (block: CodeBlock): string {
  return `<table ${table} style="background-color:${colors.quoteBg};border:1px solid ${colors.border};border-radius:10px;border-collapse:separate"><tr><td align="center" style="padding:20px;text-align:center"><span style="font-family:'Courier New',Courier,monospace;font-size:36px;font-weight:700;letter-spacing:10px;color:${colors.text};line-height:1.2">${escapeHtml(block.code)}</span></td></tr></table>`
}

function note (block: NoteBlock): string {
  return `<div style="font-family:${font};font-size:13px;line-height:1.6;color:${colors.faint};word-wrap:break-word;overflow-wrap:anywhere">${block.body}</div>`
}

/**
 * @public
 */
export function renderBlock (block: EmailBlock): SafeHtml {
  switch (block.type) {
    case 'quote':
      return trusted(quote(block))
    case 'message':
      return trusted(message(block))
    case 'object':
      return trusted(objectLink(block))
    case 'paragraph':
      return trusted(paragraph(block))
    case 'code':
      return trusted(code(block))
    case 'note':
      return trusted(note(block))
  }
}
