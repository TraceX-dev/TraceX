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

import { TABLE_METADATA_MARKER, TABLE_METADATA_TOKEN } from '@hcengineering/view'

/**
 * The copier (view-resources) and the paste handler (text-editor-resources) agree on this token
 * only because both now import it. They previously held separate literals, and a copied table
 * pasted back as plain text with nothing logged.
 */
describe('table metadata token', () => {
  function writeClipboardText (markdown: string, metadata: Record<string, unknown>): string {
    // Mirrors copyMarkdown in view-resources.
    return markdown + '\n' + `${TABLE_METADATA_MARKER}${JSON.stringify(metadata)} -->`
  }

  function readMetadata (text: string): unknown {
    // Mirrors extractMetadataFromHtmlComments in text-editor-resources.
    const commentRegex = new RegExp(`<!--\\s*${TABLE_METADATA_TOKEN}(.+?)\\s*-->`, 's')
    const match = text.match(commentRegex)
    return match?.[1] !== undefined ? JSON.parse(match[1]) : null
  }

  const markdown = '| A | B |\n| --- | --- |\n| 1 | 2 |\n'
  const metadata = { version: '1.0', cardClass: 'card:class:Card', documentIds: ['doc1'] }

  it('round-trips metadata from copy to paste', () => {
    expect(readMetadata(writeClipboardText(markdown, metadata))).toEqual(metadata)
  })

  it('leaves the table itself intact ahead of the comment', () => {
    const clipboard = writeClipboardText(markdown, metadata)
    expect(clipboard.startsWith(markdown)).toBe(true)
    // A blank line separates the table from the comment, or markdown-it swallows it into the table.
    expect(clipboard).toContain('| 1 | 2 |\n\n<!--')
  })

  it('returns nothing for the token the copier used while the two had drifted', () => {
    const stale = markdown + '\n' + `<!-- platform-table-metadata:${JSON.stringify(metadata)} -->`
    expect(readMetadata(stale)).toBeNull()
  })
})
