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

import { colors } from './theme'

/**
 * HTML that is safe to put into an email as is.
 * Produce it only through the helpers below, never by casting user input.
 * @public
 */
export type SafeHtml = string & { readonly __safeHtml: true }

const escapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

/**
 * @public
 */
export function escapeHtml (value: string | number | undefined | null): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => escapes[ch])
}

/**
 * Keeps only http(s) and mailto links, anything else becomes '#'.
 * @public
 */
export function safeUrl (url: string | undefined | null): string {
  const value = (url ?? '').trim()
  if (/^(https?:\/\/|mailto:)/i.test(value)) return escapeHtml(value)
  return '#'
}

/**
 * Marks already trusted markup (our own templates) as safe.
 * @public
 */
export function trusted (value: string): SafeHtml {
  return value as SafeHtml
}

/**
 * Escaped plain text, line breaks kept.
 * @public
 */
export function text (value: string | undefined | null): SafeHtml {
  return trusted(escapeHtml(value).replace(/\r?\n/g, '<br>'))
}

/**
 * @public
 */
export function join (parts: SafeHtml[], separator: SafeHtml = trusted('')): SafeHtml {
  return trusted(parts.join(separator))
}

/**
 * @public
 */
export function link (href: string, label: string): SafeHtml {
  return trusted(
    `<a href="${safeUrl(href)}" style="color:${colors.text};text-decoration:underline">${escapeHtml(label)}</a>`
  )
}

/**
 * Highlighted @mention.
 * @public
 */
export function mention (name: string): SafeHtml {
  return trusted(
    `<span style="padding:1px 6px;border-radius:6px;background-color:${colors.mentionBg};color:${colors.mentionText};font-weight:600;white-space:nowrap">@${escapeHtml(name)}</span>`
  )
}

/**
 * Initials for an avatar: first letters of the first two words.
 * @public
 */
export function initials (name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((it) => it.length > 0)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((it) => Array.from(it)[0].toUpperCase())
    .join('')
}
