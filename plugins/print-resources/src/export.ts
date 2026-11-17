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

import type { Blob, Doc, Ref } from '@hcengineering/core'
import type { DocumentExporterOptions, DocumentExportResult } from '@hcengineering/export'
import { getMetadata } from '@hcengineering/platform'
import presentation, { getClient, PDFViewer } from '@hcengineering/presentation'
import print, { type PrintExportParams } from '@hcengineering/print'
import { showPopup } from '@hcengineering/ui'
import type { ComponentProps } from 'svelte'
import PrintBulkToPDF from './components/PrintBulkToPDF.svelte'
import { preparePdf } from './printUtils'

/** PDF generation and signing are owned by print, independently of the export dialog. */
export async function exportPDF (
  doc: Doc,
  options: DocumentExporterOptions,
  params: PrintExportParams = {}
): Promise<DocumentExportResult> {
  const result = await preparePdf(
    getClient(),
    doc,
    getMetadata(presentation.metadata.Token) ?? '',
    params.signed ?? false,
    {
      orientation: options.orientation,
      contentOnly: options.contentOnly
    }
  )
  return { file: result.blobId as Ref<Blob>, name: result.title, contentType: 'application/pdf' }
}

export async function previewPDF (result: DocumentExportResult): Promise<void> {
  if (typeof result.file !== 'string') throw new Error('PDF preview requires a workspace file')
  const props: ComponentProps<PDFViewer> = {
    file: result.file,
    name: result.name,
    contentType: result.contentType,
    showIcon: false
  }
  showPopup(PDFViewer, props, 'float')
}

export async function exportBulkPDF (
  objects: Doc[],
  options: DocumentExporterOptions,
  params: PrintExportParams = {}
): Promise<void> {
  const props: ComponentProps<PrintBulkToPDF> = {
    objects,
    signed: params.signed ?? false,
    orientation: options.orientation ?? 'portrait'
  }
  showPopup(PrintBulkToPDF, props, 'float')
}

export async function canExportPDF (): Promise<boolean> {
  return (getMetadata(print.metadata.PrintURL) ?? '') !== ''
}
