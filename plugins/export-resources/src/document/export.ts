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
import {
  type DocumentExporter,
  type DocumentExporterOptions,
  type DocumentExportResult,
  type DocumentExportSettingsValues
} from '@hcengineering/export'
import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'
import type { ComponentProps } from 'svelte'
import DocumentExportSettings from './components/DocumentExportSettings.svelte'
import { downloadDocumentResult, reportExportError } from './exporters'

/** Prepare exports inside settings; open the next popup only after settings close. */
export async function exportDocuments (
  object: Doc | Doc[],
  _event: Event,
  params: Record<string, unknown> = {}
): Promise<void> {
  const objects = Array.isArray(object) ? object : [object]
  if (objects.length === 0) return
  const bulk = objects.length > 1
  let prepared: DocumentExportResult | undefined
  let selected: DocumentExporter | undefined
  let options: DocumentExporterOptions | undefined

  async function submit (settings: DocumentExportSettingsValues): Promise<boolean> {
    prepared = undefined
    selected = undefined
    options = undefined
    try {
      const exporter = getClient().getModel().getObject(settings.exporter)
      if (bulk && exporter.bulkExport === undefined) return false
      const exportOptions: DocumentExporterOptions = {
        format: exporter.format,
        orientation: exporter.supportsOrientation ? settings.orientation : undefined
      }
      if (!bulk) {
        const generate = await getResource(exporter.export)
        prepared = await generate(objects[0], exportOptions, params)
      }
      selected = exporter
      options = exportOptions
      return true
    } catch (error) {
      await reportExportError(error)
      return false
    }
  }

  async function complete (settings: DocumentExportSettingsValues | undefined): Promise<void> {
    if (settings === undefined || selected === undefined || options === undefined) return
    try {
      if (bulk && selected.bulkExport !== undefined) {
        const exportBulk = await getResource(selected.bulkExport)
        await exportBulk(objects, options, params)
      } else if (prepared !== undefined) {
        if (settings.preview && selected.preview !== undefined) {
          const preview = await getResource(selected.preview)
          await preview(prepared)
        } else {
          downloadDocumentResult(prepared)
        }
      }
    } catch (error) {
      await reportExportError(error)
    }
  }

  const settingsProps: ComponentProps<DocumentExportSettings> = { objects, onSubmit: submit }
  showPopup(DocumentExportSettings, settingsProps, 'center', complete)
}
