//
// Copyright © 2025 Hardcore Engineering Inc.
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

import type { Class, Client, Doc, Ref } from '@hcengineering/core'
import { type IntlString, type Metadata, type Plugin, plugin, type Resource, type Asset } from '@hcengineering/platform'
import { type AnyComponent } from '@hcengineering/ui/src/types'
import type { NotificationGroup, NotificationType } from '@hcengineering/notification'
import type { Action, ViewAction } from '@hcengineering/view'
import type {
  DocumentContentTarget,
  DocumentExportFormat,
  DocumentExportOptions,
  DocumentExporter,
  DocumentExportFunction,
  DocumentExportAvailabilityFunction,
  ExportResultRecord
} from './types'

export const exportId = 'export' as Plugin

export const exportPlugin = plugin(exportId, {
  ids: {
    ImportNotificationGroup: '' as Ref<NotificationGroup>,
    ImportedDocumentsNotification: '' as Ref<NotificationType>
  },
  class: {
    ExportResultRecord: '' as Ref<Class<ExportResultRecord>>,
    DocumentExporter: '' as Ref<Class<DocumentExporter>>
  },
  string: {
    PrintHeaderFooter: '' as IntlString,
    Export: '' as IntlString,
    ExportDots: '' as IntlString,
    ExportList: '' as IntlString,
    Orientation: '' as IntlString,
    PortraitMode: '' as IntlString,
    LandscapeMode: '' as IntlString,
    ExportFormat: '' as IntlString,
    ExportCompleted: '' as IntlString,
    ExportFailed: '' as IntlString,
    ExportToWorkspace: '' as IntlString,
    TargetWorkspace: '' as IntlString,
    ImportCompleted: '' as IntlString,
    ImportToWorkspaceNotificationMessage: '' as IntlString,
    SourceWorkspace: '' as IntlString,
    ExportedCount: '' as IntlString,
    ExportedDocumentIds: '' as IntlString,
    DocumentsImportedFromWorkspace: '' as IntlString,
    ExportedDocumentClass: '' as IntlString,
    Import: '' as IntlString,
    ImportedDocuments: '' as IntlString,
    ExportResultRecordTitle: '' as IntlString,

    // Shared markup->docx/md content export & import (used by controlled documents, cards, ...).
    ExportFormatWord: '' as IntlString,
    ExportFormatMarkdown: '' as IntlString,
    ExportDocumentContent: '' as IntlString,
    ImportDocumentContent: '' as IntlString,
    ExportingDocumentContent: '' as IntlString,
    DocumentContentExported: '' as IntlString,
    DocumentContentExportFailed: '' as IntlString,
    ImportingDocumentContent: '' as IntlString,
    ConvertingDocumentContent: '' as IntlString,
    DocumentContentConverted: '' as IntlString,
    DocumentContentImportFailed: '' as IntlString,
    ReviewDocumentContentChanges: '' as IntlString,
    ApplyDocumentContentChanges: '' as IntlString
  },
  component: {
    ExportButton: '' as AnyComponent,
    ExportSettings: '' as AnyComponent,
    ExportNotification: '' as AnyComponent,
    ExportToWorkspaceModal: '' as AnyComponent,
    ExportResultPanel: '' as AnyComponent,
    ExportTableDialog: '' as AnyComponent,
    DocumentExportSettings: '' as AnyComponent,
    DocumentImportFormatPopup: '' as AnyComponent
  },
  exporter: {
    Word: '' as Ref<DocumentExporter>,
    Markdown: '' as Ref<DocumentExporter>
  },
  action: {
    ExportDocuments: '' as Ref<Action<Doc, Record<string, unknown>>>
  },
  actionImpl: {
    ExportDocuments: '' as ViewAction<Record<string, unknown>>,
    ExportTable: '' as ViewAction<Record<string, any>>
  },
  icon: {
    Export: '' as Asset,
    Import: '' as Asset
  },
  metadata: {
    ExportUrl: '' as Metadata<string>
  },
  function: {
    ExportContent: '' as Resource<DocumentExportFunction>,
    CanExportContent: '' as Resource<DocumentExportAvailabilityFunction>,
    CanExport: '' as Resource<(doc?: Doc | Doc[]) => Promise<boolean>>,
    ExportDocumentContent: '' as Resource<
      (doc: DocumentContentTarget, format: DocumentExportFormat, options?: DocumentExportOptions) => Promise<boolean>
    >,
    ExportResultTitleProvider: '' as Resource<(client: Client, ref: Ref<Doc>, doc?: Doc) => Promise<string>>
  }
})

export default exportPlugin
