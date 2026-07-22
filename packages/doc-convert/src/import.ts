//
// Copyright © 2025 Hardcore Engineering Inc.
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

import { type MarkupNode } from '@hcengineering/text-core'
import { htmlToMarkup } from '@hcengineering/text-html'
import mammoth from 'mammoth'

/** @public */
export interface DocxToMarkupResult {
  /** Converted document content as a Huly Markup node tree. */
  markup: MarkupNode
  /** Intermediate HTML produced by mammoth (useful for debugging/diagnostics). */
  html: string
  /** Non-fatal messages emitted by mammoth (unsupported styles, etc.). */
  messages: string[]
}

/**
 * Convert a .docx document into Huly Markup.
 *
 * Pure transformation: no storage, network or workspace access.
 * Images arrive as inline data: URIs in the resulting markup — extraction into
 * attachments is a host concern (see pod-export / import flow), not this package.
 *
 * @public
 */
export async function docxToMarkup (buffer: Buffer): Promise<DocxToMarkupResult> {
  const result = await mammoth.convertToHtml({ buffer })
  const html = result.value
  const markup = htmlToMarkup(html)
  return {
    markup,
    html,
    messages: result.messages.map((m) => m.message)
  }
}
