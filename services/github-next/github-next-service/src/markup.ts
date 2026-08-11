//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { markupToJSON } from '@hcengineering/text'
import { markupToMarkdown } from '@hcengineering/text-markdown'

export interface MarkdownConversionOptions {
  refUrl: string
  imageUrl: string
}

export function isSerializedMarkup (content: string): boolean {
  try {
    const parsed = JSON.parse(content.trim()) as { type?: unknown, content?: unknown }
    return parsed.type === 'doc' && Array.isArray(parsed.content)
  } catch {
    return false
  }
}

/**
 * Converts a ProseMirror document accidentally passed through a Markdown mapping.
 * Regular Markdown is returned as-is to avoid altering user-authored content.
 */
export function convertSerializedMarkupToMarkdown (content: string, options: MarkdownConversionOptions): string {
  const trimmed = content.trim()

  if (!isSerializedMarkup(trimmed)) {
    return content
  }

  return markupToMarkdown(markupToJSON(trimmed), options)
}
