//
// Copyright © 2024 Hardcore Engineering Inc.
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

import { type Resources } from '@hcengineering/platform'
import { getPrintBaseURL } from '@hcengineering/print'

import PrintApp from './components/PrintApp.svelte'
import PrintBulkToPDF from './components/PrintBulkToPDF.svelte'
import DOCXViewer from './components/DOCXViewer.svelte'
import { exportPDF, previewPDF, exportBulkPDF, canExportPDF } from './export'

import PrintHeader from './components/PrintHeader.svelte'
import PrintFooter from './components/PrintFooter.svelte'
import PrintSettings from './components/PrintSettings.svelte'
import { printedObjectTitle } from './decorations'
export { getPrintObject } from './print-object'

import PrintConfigurationPresenter from './components/PrintConfigurationPresenter.svelte'

export default async (): Promise<Resources> => ({
  component: {
    PrintHeader,
    PrintFooter,
    PrintSettings,
    PrintConfigurationPresenter,
    PrintApp,
    PrintBulkToPDF,
    DOCXViewer
  },
  function: {
    PrintedObjectTitle: printedObjectTitle,
    ExportPDF: exportPDF,
    PreviewPDF: previewPDF,
    ExportBulkPDF: exportBulkPDF,
    CanExportPDF: canExportPDF,
    CanConvert: async () => {
      try {
        return getPrintBaseURL() !== ''
      } catch {
        return false
      }
    }
  }
})
