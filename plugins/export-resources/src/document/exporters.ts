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

import type { Doc } from '@hcengineering/core'
import exportPlugin, { type DocumentExporter, type DocumentExportResult } from '@hcengineering/export'
import { getResource, translate } from '@hcengineering/platform'
import { getClient, getFileUrl } from '@hcengineering/presentation'
import { addNotification, NotificationSeverity } from '@hcengineering/ui'
import { downloadBlob } from '../download'

export interface DocumentExporterState {
  exporter: DocumentExporter
  available: boolean
}

/** Read model registrations and evaluate their optional document predicates. */
export async function loadDocumentExporters (objects: Doc[]): Promise<DocumentExporterState[]> {
  const exporters = [...getClient().getModel().findAllSync(exportPlugin.class.DocumentExporter, {})]
  exporters.sort((a, b) => a.order - b.order || a.format.localeCompare(b.format))
  return await Promise.all(
    exporters.map(async (exporter): Promise<DocumentExporterState> => {
      let available = objects.length > 0 && (objects.length === 1 || exporter.bulkExport !== undefined)
      if (available && exporter.isAvailable !== undefined) {
        try {
          const check = await getResource(exporter.isAvailable)
          available = (await Promise.all(objects.map(async (object) => await check(object)))).every(Boolean)
        } catch {
          // One unavailable implementation must not prevent other formats from being used.
          available = false
        }
      }
      return { exporter, available }
    })
  )
}

export async function canExport (object?: Doc | Doc[]): Promise<boolean> {
  if (object === undefined) return false
  const states = await loadDocumentExporters(Array.isArray(object) ? object : [object])
  return states.some(({ available }) => available)
}

/** Download either an in-memory conversion result or a workspace file. */
export function downloadDocumentResult (result: DocumentExportResult): void {
  if (typeof result.file !== 'string') {
    downloadBlob(result.file, result.name)
    return
  }
  const anchor = document.createElement('a')
  anchor.href = getFileUrl(result.file, result.name)
  anchor.download = result.name
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

export async function reportExportError (error: unknown): Promise<void> {
  addNotification(
    await translate(exportPlugin.string.ExportFailed, {}),
    error instanceof Error ? error.message : String(error),
    exportPlugin.component.ExportNotification,
    undefined,
    NotificationSeverity.Error
  )
}
