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

import type { DocumentExportOptions } from '@hcengineering/export'
import { ApiError } from '@hcengineering/server-core'
import { markupToJSON, jsonToMarkup, MarkupNodeType } from '@hcengineering/text'
import type { MarkupNode } from '@hcengineering/text'

/** Validate the optional export settings at the HTTP boundary. */
export function parseDocumentExportOptions (params: Record<string, unknown>): DocumentExportOptions {
  const orientation = params.orientation ?? 'portrait'
  if (orientation !== 'portrait' && orientation !== 'landscape') throw new ApiError(400, 'Invalid page orientation')
  const rawIncludeTitle = params.includeTitle
  if (
    rawIncludeTitle !== undefined &&
    rawIncludeTitle !== true &&
    rawIncludeTitle !== false &&
    rawIncludeTitle !== 'true' &&
    rawIncludeTitle !== 'false'
  ) {
    throw new ApiError(400, 'Invalid includeTitle value')
  }
  return { orientation, includeTitle: rawIncludeTitle === true || rawIncludeTitle === 'true' }
}

/** Add a document heading without modifying its stored collaborative content. */
export function withDocumentTitle (markup: string, title: string): string {
  const root = markupToJSON(markup)
  const heading: MarkupNode = {
    type: MarkupNodeType.heading,
    attrs: { level: 1 },
    content: [{ type: MarkupNodeType.text, text: title }]
  }
  const result: MarkupNode = { ...root, content: [heading, ...(root.content ?? [])] }
  return jsonToMarkup(result)
}

/** Build the download header for a generated document. */
export function documentExportDisposition (fileName: string): string {
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
  const fallback = fileName.replace(/[^\x20-\x7E]|["\\]/g, '_')
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
