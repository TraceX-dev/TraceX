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

import converter, { type CopyAsMarkdownTableProps, type TableData } from '@hcengineering/converter'
import { type Doc } from '@hcengineering/core'
import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'

import { downloadBlob } from './download'
import { serializeCsv, serializeJson, tableExportContentType, type TableExportFormat } from './serializers'

export type { TableExportFormat } from './serializers'

/** @public */
export type TableExportScope = 'selected' | 'page'

/** @public */
export interface TableExportRequest {
  docs: Doc[]
  props: CopyAsMarkdownTableProps
  format: TableExportFormat
  fileName: string
}

/**
 * Build the table the same way "Copy as Markdown Table" does.
 *
 * Both go through the `BuildTableData` resource, so the export cannot drift from what the table
 * shows: there is only one place where columns are resolved and cells are formatted.
 * @public
 */
export async function buildTable (docs: Doc[], props: CopyAsMarkdownTableProps): Promise<TableData> {
  const build = await getResource(converter.function.BuildTableData)
  // Plain text: keep the referenced document's title, drop the markdown link markup that the
  // clipboard flavour adds — a csv cell must not contain `[Title](http://...)`.
  return await build(docs, props, getClient(), async (_doc, title) => title)
}

async function renderMarkdown (docs: Doc[], props: CopyAsMarkdownTableProps): Promise<string> {
  const build = await getResource(converter.function.BuildMarkdownTableFromDocs)
  return await build(docs, props, getClient())
}

/**
 * Serialize the given documents and hand the file to the browser.
 *
 * Everything happens in the tab: both scopes work on documents that are already loaded, so there is
 * no query, no paging and nothing to wait for.
 * @public
 */
export async function exportTable (request: TableExportRequest): Promise<void> {
  const { docs, props, format, fileName } = request
  if (docs.length === 0) {
    return
  }

  let content: string
  if (format === 'md') {
    // Markdown already has a renderer — the one behind copy to clipboard.
    content = await renderMarkdown(docs, props)
  } else {
    const data = await buildTable(docs, props)
    content =
      format === 'csv'
        ? serializeCsv(data)
        : serializeJson(data, { class: props.cardClass, exportedAt: new Date().toISOString() })
  }

  if (content.length === 0) {
    return
  }

  downloadBlob(new Blob([content], { type: tableExportContentType[format] }), `${fileName}.${format}`)
}
