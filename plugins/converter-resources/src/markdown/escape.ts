//
// Copyright © 2026 Hardcore Engineering Inc.
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

/**
 * True when the string is a single inline markdown link with an absolute http(s) or ref:// URL,
 * as produced by createMarkdownLink — must not be passed through escapeMarkdownLinkText or brackets break the link.
 */
export function looksLikeHttpOrRefMarkdownLink (s: string): boolean {
  const t = s.trim()
  if (!t.startsWith('[') || !t.endsWith(')')) return false
  const mid = t.indexOf('](')
  if (mid <= 0) return false
  const urlPart = t.slice(mid + 2, -1)
  return /^(https?:\/\/|ref:\/\/)/i.test(urlPart)
}

/**
 * Prepare a value for a markdown pipe-table cell.
 *
 * Cell values legitimately carry inline markdown produced upstream: document links from
 * `createMarkdownLink`, and — for markup (rich text) attributes — emphasis, links and
 * images from `markdownToInlineCell`. Escaping brackets here turned `![alt](src)` into
 * literal text, which is why images from markup fields never rendered after paste.
 *
 * A pipe-table cell only needs the row separator escaped and line breaks expressed as
 * `<br>`; the rest is left for the markdown parser. Content that must not be interpreted
 * (raw HTML of nested tables, block structure) is already stripped by `markdownToInlineCell`.
 */
export function escapeMarkdownTableCellContent (value: string): string {
  const s = value == null ? '' : String(value)
  return (
    s
      // `\?\|` also normalizes an already escaped pipe instead of double escaping it.
      .replace(/\\?\|/g, '\\|')
      .replace(/\r?\n/g, '<br>')
  )
}

/**
 * Escape markdown link text (brackets, pipes, backslashes, newlines)
 */
export function escapeMarkdownLinkText (text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
}

/**
 * Escape markdown link URL (backslashes and closing parentheses)
 */
export function escapeMarkdownLinkUrl (url: string): string {
  return (
    url
      .replace(/\\/g, '\\\\')
      .replace(/\)/g, '\\)')
      // Pipes break markdown tables unless escaped, and are safe to escape in URLs.
      .replace(/\|/g, '\\|')
  )
}
