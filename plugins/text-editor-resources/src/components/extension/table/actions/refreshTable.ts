//
// Copyright © 2026 TraceX SAS.
// Copyright © 2025 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { type Editor } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { markdownToMarkup } from '@hcengineering/text-markdown'
import { showPopup } from '@hcengineering/ui'
import view, { type ResolvedTableSnapshot } from '@hcengineering/view'
import { attachTableSnapshot, editorTableSnapshot, summarizeTableEdits } from '../snapshot'
import { getTableMetadata } from '../tableMetadata'
import { findTable } from '../utils'
import { showTableError, showTableMessage } from './errors'
import TableRefreshConfirmation from './TableRefreshConfirmation.svelte'
import { extractTableMarkdown, fetchFreshTableSnapshot } from './tableUtils'

/**
 * Replace the previewed table if it is still unchanged. The table is found again by content, not by
 * the position it had when the preview opened; among identical tables the closest one is used.
 */
export function applyTableRefresh (
  editor: Editor,
  original: Node,
  originalPos: number,
  resolved: ResolvedTableSnapshot
): boolean {
  if (editor.isDestroyed) return false
  let target: number | undefined
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true
    if (node.eq(original) && (target === undefined || Math.abs(pos - originalPos) < Math.abs(target - originalPos))) {
      target = pos
    }
    return false
  })
  if (target === undefined) {
    showTableMessage(view.string.TableChangedDuringPreview)
    return false
  }
  let replacement: Node | undefined
  Node.fromJSON(editor.state.schema, markdownToMarkup(resolved.markdown)).forEach((node) => {
    if (node.type.name === 'table' && replacement === undefined) replacement = node
  })
  if (replacement === undefined) throw new Error('Source snapshot contains no table')
  const next = attachTableSnapshot(replacement, resolved.metadata)
  editor.view.dispatch(editor.state.tr.replaceWith(target, target + original.nodeSize, next))
  return true
}

/** Preview the exact replacement, including local edits and conflicts, before applying it. */
export async function refreshTable (editor: Editor): Promise<void> {
  const table = findTable(editor.state.selection)
  const metadata = table === undefined ? undefined : getTableMetadata(table.node)
  if (table === undefined || metadata === undefined) return
  try {
    const fresh = await fetchFreshTableSnapshot(metadata)
    const tracked = metadata.version === '2.0'
    const current = tracked ? editorTableSnapshot(table.node) : extractTableMarkdown(table.node)
    const summary =
      typeof current === 'string'
        ? { localChanges: false, conflicts: false }
        : summarizeTableEdits(current, fresh.snapshot, metadata.snapshot)
    showPopup(
      TableRefreshConfirmation,
      {
        current,
        fresh: tracked ? fresh.snapshot : fresh.markdown,
        metadata: fresh.metadata,
        ...summary,
        onApply: () => {
          try {
            return applyTableRefresh(editor, table.node, table.pos, fresh)
          } catch (error) {
            console.error('Failed to apply table refresh:', error)
            showTableError(error)
            return false
          }
        }
      },
      'center'
    )
  } catch (error) {
    console.error('Failed to refresh table:', error)
    showTableError(error)
  }
}
