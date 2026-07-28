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

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g
const HTML_TAG_RE = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^>]*)?\/?>/g
const HTML_ANCHOR_RE = /<a\b[^>]*?\bhref="([^"]*)"[^>]*?>([\s\S]*?)<\/a>/gi
const HTML_IMG_RE = /<img\b[^>]*?>/gi
const HTML_BR_RE = /<br\b[^>]*?>/gi

const CODE_FENCE_RE = /^(?:```|~~~)/
const THEMATIC_BREAK_RE = /^(?:-{3,}|\*{3,}|_{3,})$/
const BULLET_MARKER_RE = /^[*+-][ \t]+/
const HEADING_RE = /^#{1,6}[ \t]+/
const BLOCKQUOTE_RE = /^>[ \t]?/

const IMG_TOKEN_PREFIX = '@@huly-inline-img:'
const IMG_TOKEN_SUFFIX = '@@'
const IMG_TOKEN_RE = /@@huly-inline-img:(\d+)@@/g

/**
 * Line break understood inside a markdown pipe-table cell.
 * A literal newline would terminate the row; `<br>` is parsed back into a hardBreak node.
 * @public
 */
export const CELL_LINE_BREAK = '<br>'

/**
 * Bullet used for list items flattened into a single cell.
 * @public
 */
export const CELL_BULLET = '• '

function stripTags (value: string): string {
  return value.replace(HTML_COMMENT_RE, ' ').replace(HTML_TAG_RE, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Flatten a multi-line markdown document into a single line that is safe to embed
 * inside a markdown pipe-table cell, while keeping the rich-text bits a cell can render.
 *
 * Kept: inline emphasis, links, images (both `![alt](src)` and `<img>`), line breaks
 * (as `<br>`) and list items (as `• ` bullets).
 *
 * Dropped: every other HTML tag. This matters most for nested tables — `markupToMarkdown`
 * serializes a table node as raw `<table>` HTML, and letting that reach an outer cell
 * produces markup that violates the ProseMirror table schema on paste.
 *
 * @public
 */
export function markdownToInlineCell (markdown: string): string {
  if (markdown == null || markdown === '') {
    return ''
  }

  const preserved: string[] = []

  let value = markdown
    .replace(HTML_ANCHOR_RE, (_match, href: string, inner: string) => {
      const text = stripTags(inner)
      if (text === '' || text === href) {
        return href
      }
      return `[${text}](${href})`
    })
    .replace(HTML_COMMENT_RE, ' ')

  // Images survive as-is; the markdown parser turns both forms back into an image node.
  value = value.replace(HTML_IMG_RE, (match) => {
    preserved.push(match)
    return `${IMG_TOKEN_PREFIX}${preserved.length - 1}${IMG_TOKEN_SUFFIX}`
  })

  // Normalize explicit breaks to newlines so they go through the same line handling below.
  value = value.replace(HTML_BR_RE, '\n')

  // Anything still tagged (nested tables above all) must not reach the cell.
  value = value.replace(HTML_TAG_RE, ' ')

  const lines: string[] = []
  for (const rawLine of value.split(/\r?\n/)) {
    let line = rawLine.replace(/[\t ]+/g, ' ').trim()
    if (line === '' || CODE_FENCE_RE.test(line) || THEMATIC_BREAK_RE.test(line)) {
      continue
    }
    // A trailing backslash is markdown's hard break; the join below expresses it instead.
    line = line.replace(/\\+$/, '').trim()
    line = line.replace(BLOCKQUOTE_RE, '').replace(HEADING_RE, '')
    if (BULLET_MARKER_RE.test(line)) {
      line = CELL_BULLET + line.replace(BULLET_MARKER_RE, '')
    }
    if (line === '') {
      continue
    }
    lines.push(line)
  }

  return lines.join(CELL_LINE_BREAK).replace(IMG_TOKEN_RE, (_match, index: string) => preserved[Number(index)] ?? '')
}
