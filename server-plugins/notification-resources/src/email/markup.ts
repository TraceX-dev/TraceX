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

import type { Class, Doc, Markup, Ref } from '@hcengineering/core'
import {
  markupToJSON,
  MarkupMarkType,
  MarkupNodeType,
  type MarkupMark,
  type MarkupNode
} from '@hcengineering/text-core'

import { escapeHtml, mention, safeUrl, trusted, type SafeHtml } from './html'
import { colors } from './theme'

/**
 * Object referenced from a message (not a person).
 * @public
 */
export interface EmailReference {
  id: Ref<Doc>
  objectClass: Ref<Class<Doc>>
  label: string
}

/**
 * @public
 */
export interface MarkupToEmailOptions {
  /** Person references are rendered as @mention pills, the rest as links. */
  isPerson: (objectClass: Ref<Class<Doc>>) => boolean
  /** Link for a referenced object; without it the reference is plain text. */
  referenceHref?: (id: Ref<Doc>, objectClass: Ref<Class<Doc>>) => string | undefined
  /** Approximate limit of visible characters; the rest is cut with an ellipsis. */
  maxLength?: number
}

/**
 * @public
 */
export interface EmailMarkup {
  html: SafeHtml
  /** Plain text, for previews. */
  text: string
  references: EmailReference[]
  truncated: boolean
}

class Writer {
  html = ''
  text = ''
  length = 0
  truncated = false
  references: EmailReference[] = []
  /** Inside a list item paragraphs get no margins. */
  inItem = 0

  constructor (readonly options: MarkupToEmailOptions) {}

  get full (): boolean {
    return this.truncated
  }

  /** Adds visible text, cutting it at the limit. */
  addText (value: string, wrap: (escaped: string) => string = (it) => it): void {
    if (this.truncated || value === '') return
    const max = this.options.maxLength
    let part = value
    if (max !== undefined && this.length + part.length > max) {
      const room = Math.max(0, max - this.length)
      const cut = part.slice(0, room)
      const space = cut.lastIndexOf(' ')
      part = (space > room * 0.6 ? cut.slice(0, space) : cut).trimEnd() + '…'
      this.truncated = true
    }
    this.length += part.length
    this.text += part
    this.html += wrap(escapeHtml(part))
  }

  raw (value: string): void {
    this.html += value
  }

  separator (): void {
    if (this.text !== '' && !this.text.endsWith(' ')) this.text += ' '
  }
}

function wrapMarks (escaped: string, marks: MarkupMark[] | undefined): string {
  let res = escaped
  for (const mark of marks ?? []) {
    switch (mark.type) {
      case MarkupMarkType.bold:
        res = `<strong style="font-weight:700">${res}</strong>`
        break
      case MarkupMarkType.em:
        res = `<em>${res}</em>`
        break
      case MarkupMarkType.underline:
        res = `<u>${res}</u>`
        break
      case MarkupMarkType.strike:
        res = `<s>${res}</s>`
        break
      case MarkupMarkType.code:
        res = `<code style="font-family:Menlo,Consolas,'Courier New',monospace;font-size:14px;background-color:${colors.chipBg};border-radius:4px;padding:1px 4px">${res}</code>`
        break
      case MarkupMarkType.link: {
        const href = safeUrl(typeof mark.attrs?.href === 'string' ? mark.attrs.href : '')
        res = href === '#' ? res : `<a href="${href}" style="color:${colors.text};text-decoration:underline">${res}</a>`
        break
      }
      default:
        break
    }
  }
  return res
}

function str (value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function children (w: Writer, node: MarkupNode): void {
  for (const child of node.content ?? []) {
    if (w.full) return
    write(w, child)
  }
}

/** Vertical gap before a block, none for the very first one. */
function gap (w: Writer): string {
  return w.html === '' || w.inItem > 0 ? 'margin:0' : 'margin:12px 0 0 0'
}

function block (w: Writer, node: MarkupNode, open: string, close: string): void {
  if (w.full) return
  w.separator()
  w.raw(open.replace('{gap}', gap(w)))
  children(w, node)
  w.raw(close)
}

function reference (w: Writer, node: MarkupNode): void {
  const id = str(node.attrs?.id) as Ref<Doc>
  const objectClass = str(node.attrs?.objectclass) as Ref<Class<Doc>>
  const label = str(node.attrs?.label !== undefined && node.attrs?.label !== null ? node.attrs.label : node.text)
  if (w.options.isPerson(objectClass)) {
    if (w.full) return
    w.text += `@${label}`
    w.length += label.length + 1
    w.raw(mention(label))
    return
  }
  if (id !== '' && w.references.every((it) => it.id !== id)) {
    w.references.push({ id, objectClass, label })
  }
  const href = id !== '' ? w.options.referenceHref?.(id, objectClass) : undefined
  w.addText(label, (escaped) =>
    href !== undefined
      ? `<a href="${safeUrl(href)}" style="color:${colors.text};font-weight:600;text-decoration:underline">${escaped}</a>`
      : `<strong style="font-weight:600">${escaped}</strong>`
  )
}

function write (w: Writer, node: MarkupNode): void {
  switch (node.type) {
    case MarkupNodeType.doc:
      children(w, node)
      return
    case MarkupNodeType.text:
      w.addText(node.text ?? '', (escaped) => wrapMarks(escaped, node.marks))
      return
    case MarkupNodeType.hard_break:
      if (!w.full) {
        w.raw('<br>')
        w.separator()
      }
      return
    case MarkupNodeType.paragraph:
      block(w, node, w.inItem > 0 ? '<div>' : `<p style="{gap}">`, w.inItem > 0 ? '</div>' : '</p>')
      return
    case MarkupNodeType.heading:
      block(w, node, `<p style="{gap};font-weight:700;color:${colors.text}">`, '</p>')
      return
    case MarkupNodeType.blockquote:
      block(
        w,
        node,
        `<div style="{gap};border-left:3px solid ${colors.quoteBar};padding:0 0 0 12px;color:${colors.secondary}">`,
        '</div>'
      )
      return
    case MarkupNodeType.code_block:
      block(
        w,
        node,
        `<pre style="{gap};font-family:Menlo,Consolas,'Courier New',monospace;font-size:13px;line-height:1.5;background-color:${colors.quoteBg};border-radius:8px;padding:10px 12px;white-space:pre-wrap;word-wrap:break-word">`,
        '</pre>'
      )
      return
    case MarkupNodeType.bullet_list:
    case MarkupNodeType.taskList:
    case MarkupNodeType.todoList:
      block(w, node, `<ul style="{gap};padding:0 0 0 22px">`, '</ul>')
      return
    case MarkupNodeType.ordered_list:
      block(w, node, `<ol style="{gap};padding:0 0 0 22px">`, '</ol>')
      return
    case MarkupNodeType.list_item:
      w.inItem++
      block(w, node, '<li style="margin:4px 0 0 0">', '</li>')
      w.inItem--
      return
    case MarkupNodeType.taskItem:
    case MarkupNodeType.todoItem: {
      const checked = node.attrs?.checked === true || node.attrs?.checked === 'true'
      w.inItem++
      block(w, node, `<li style="margin:4px 0 0 0;list-style:none">${checked ? '&#9745;' : '&#9744;'}&nbsp;`, '</li>')
      w.inItem--
      return
    }
    case MarkupNodeType.horizontal_rule:
      if (!w.full) w.raw(`<hr style="border:0;border-top:1px solid ${colors.divider};margin:12px 0">`)
      return
    case MarkupNodeType.reference:
      reference(w, node)
      return
    case MarkupNodeType.emoji: {
      const emoji = str(node.attrs?.emoji)
      const kind = str(node.attrs?.kind)
      w.addText(kind === '' || kind === 'unicode' ? emoji : `:${emoji}:`)
      return
    }
    case MarkupNodeType.image:
    case MarkupNodeType.file:
      w.separator()
      w.addText(
        `[${str(node.attrs?.alt ?? node.attrs?.title) !== '' ? str(node.attrs?.alt ?? node.attrs?.title) : node.type}]`,
        (escaped) => `<span style="color:${colors.muted}">${escaped}</span>`
      )
      return
    case MarkupNodeType.table_row:
      block(w, node, '<div>', '</div>')
      return
    case MarkupNodeType.table_cell:
    case MarkupNodeType.table_header:
      children(w, node)
      w.addText(' ')
      return
    case MarkupNodeType.comment:
    case MarkupNodeType.embed:
    case MarkupNodeType.mermaid:
      return
    default:
      // Unknown and container nodes (table, subLink, markdown): keep only their text.
      if (node.text !== undefined) w.addText(node.text)
      children(w, node)
  }
}

/**
 * Converts message markup to email-safe HTML with inline styles.
 * Only known nodes and marks are rendered; text is always escaped.
 * @public
 */
export function markupToEmailHtml (markup: Markup | MarkupNode, options: MarkupToEmailOptions): EmailMarkup {
  const node = typeof markup === 'string' ? markupToJSON(markup) : markup
  const w = new Writer(options)
  write(w, node)
  return { html: trusted(w.html), text: w.text.trim(), references: w.references, truncated: w.truncated }
}
