//
// Copyright © 2026 TraceX SAS.
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

import type { Doc } from '@hcengineering/core'
import { translate } from '@hcengineering/platform'
import { addNotification, NotificationSeverity } from '@hcengineering/ui'
import { getCurrentLanguage } from '@hcengineering/theme'
import view, { type ResolvedTableSnapshot } from '@hcengineering/view'
import { getClient } from '@hcengineering/presentation'
import { copyMarkdown, SimpleNotification } from '@hcengineering/view-resources'

import type { CopyAsMarkdownTableProps, CopyRelationshipTableAsMarkdownProps } from '../types'
import { captureTableSnapshot, captureRelationshipSnapshot } from '../trackedTable'

/** `tracex` keeps the link to the source; `markdown` is a plain table. */
export type TableCopyFormat = 'tracex' | 'markdown'

async function notify (label: typeof view.string.TableCopiedToClipboard, severity: NotificationSeverity): Promise<void> {
  const language = getCurrentLanguage()
  addNotification(
    await translate(view.string.Copied, {}, language),
    await translate(label, {}, language),
    SimpleNotification,
    undefined,
    severity
  )
}

/** Write a resolved table to the clipboard. Errors propagate to the caller. */
export async function writeTableToClipboard (resolved: ResolvedTableSnapshot, format: TableCopyFormat): Promise<void> {
  await copyMarkdown(resolved.markdown, format === 'tracex' ? resolved.metadata : undefined)
  await notify(view.string.TableCopiedToClipboard, NotificationSeverity.Success)
}

/**
 * Copy documents as a TraceX table (resource API without a dialog).
 */
export async function copyAsMarkdownTable (
  doc: Doc | Doc[],
  evt: Event,
  props: CopyAsMarkdownTableProps
): Promise<void> {
  const docs = Array.isArray(doc) ? doc : doc !== undefined ? [doc] : []
  if (docs.length === 0) return
  try {
    await writeTableToClipboard(await captureTableSnapshot(docs, props, getClient()), 'tracex')
  } catch (error) {
    console.error('Error copying markdown table', error)
    await notify(view.string.TableCopyFailed, NotificationSeverity.Error)
  }
}

/**
 * Wrapper for the function resource (evt, props).
 * Callers must pass docs in props when using getResource(converter.function.CopyAsMarkdownTable).
 */
export async function copyAsMarkdownTableFromResource (
  evt: Event,
  props: CopyAsMarkdownTableProps & { docs?: Doc[] }
): Promise<void> {
  const docs = props.docs ?? []
  await copyAsMarkdownTable(docs, evt, props)
}

/**
 * Copy a RelationshipTable as a TraceX table (resource API without a dialog).
 */
export async function copyRelationshipTableAsMarkdown (
  evt: Event,
  props: CopyRelationshipTableAsMarkdownProps
): Promise<void> {
  try {
    await writeTableToClipboard(await captureRelationshipSnapshot(props, getClient()), 'tracex')
  } catch (error) {
    console.error('Error copying relationship table', error)
    await notify(view.string.TableCopyFailed, NotificationSeverity.Error)
  }
}
