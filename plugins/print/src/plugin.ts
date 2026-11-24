//
// Copyright © 2024 Hardcore Engineering Inc.
// Copyright © 2026 TraceX SAS.
//
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

import type { Class, Mixin, Ref } from '@hcengineering/core'
import type { TemplateField, TemplateFieldCategory } from '@hcengineering/templates'
import type {
  DocumentExporter,
  DocumentExportFunction,
  DocumentExportPreviewFunction,
  DocumentExportAvailabilityFunction,
  DocumentBulkExportFunction
} from '@hcengineering/export'
import { type IntlString, type Metadata, type Plugin, plugin, type Asset, type Resource } from '@hcengineering/platform'
import { type AnyComponent } from '@hcengineering/ui/src/types'

import type { PrintConfiguration, PrintConfig, PrintExportParams } from './types'

export const printId = 'print' as Plugin

export const print = plugin(printId, {
  string: {
    Enabled: '' as IntlString,
    Printing: '' as IntlString,
    Header: '' as IntlString,
    Footer: '' as IntlString,
    PrintLogo: '' as IntlString,
    InsertField: '' as IntlString,
    InvalidPrintSettings: '' as IntlString,
    PrintedObject: '' as IntlString,
    Title: '' as IntlString,
    Page: '' as IntlString,
    Of: '' as IntlString,
    CreatedFromTemplate: '' as IntlString,

    PrintToPDF: '' as IntlString,
    PrintingDocumentOf: '' as IntlString,
    DownloadAll: '' as IntlString,
    PrintFailed: '' as IntlString,
    PrintSettings: '' as IntlString
  },
  component: {
    PrintHeader: '' as AnyComponent,
    PrintFooter: '' as AnyComponent,
    PrintApp: '' as AnyComponent,
    PrintBulkToPDF: '' as AnyComponent,
    DOCXViewer: '' as AnyComponent
  },
  icon: {
    Print: '' as Asset
  },
  metadata: {
    PrintURL: '' as Metadata<string>
  },
  exporter: {
    PDF: '' as Ref<DocumentExporter>
  },
  class: {
    PrintConfiguration: '' as Ref<Class<PrintConfiguration>>
  },
  mixin: {
    PrintConfig: '' as Ref<Mixin<PrintConfig>>
  },
  ids: {
    PrintConfiguration: '' as Ref<PrintConfiguration>
  },
  templateFieldCategory: {
    PrintedObject: '' as Ref<TemplateFieldCategory>
  },
  templateField: {
    Title: '' as Ref<TemplateField>
  },
  function: {
    ExportPDF: '' as Resource<DocumentExportFunction<PrintExportParams>>,
    PreviewPDF: '' as Resource<DocumentExportPreviewFunction>,
    CanExportPDF: '' as Resource<DocumentExportAvailabilityFunction>,
    ExportBulkPDF: '' as Resource<DocumentBulkExportFunction<PrintExportParams>>,
    CanConvert: '' as Resource<() => Promise<boolean>>
  }
})

export default print
