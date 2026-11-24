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

import { type Builder } from '@hcengineering/model'
import core from '@hcengineering/model-core'
import presentation from '@hcengineering/model-presentation'
import exportPlugin from '@hcengineering/export'
import { getEmbeddedLabel } from '@hcengineering/platform'

import print from './plugin'
import { TPrintConfiguration, TPrintConfig } from './types'
import setting from '@hcengineering/setting'
import templates from '@hcengineering/templates'
import view from '@hcengineering/model-view'
import type { Viewlet } from '@hcengineering/view'
import { AccountRole, type Data } from '@hcengineering/core'

export { printId } from '@hcengineering/print'
export * from './migration'
export default print

export function createModel (builder: Builder): void {
  builder.createModel(TPrintConfiguration, TPrintConfig)
  builder.mixin(print.class.PrintConfiguration, core.class.Class, view.mixin.ObjectPresenter, {
    presenter: print.component.PrintConfigurationPresenter
  })
  const configurationsTable: Data<Viewlet> = {
    attachTo: print.class.PrintConfiguration,
    descriptor: view.viewlet.Table,
    config: [
      { key: '', label: core.string.Class, sortingKey: 'targetClass' },
      'enabled',
      'header',
      'footer',
      'printLogo'
    ]
  }
  builder.createDoc(view.class.Viewlet, core.space.Model, configurationsTable, print.viewlet.PrintConfigurations)
  builder.createDoc(
    setting.class.WorkspaceSettingCategory,
    core.space.Model,
    {
      name: 'printing',
      label: print.string.Printing,
      icon: print.icon.Print,
      component: print.component.PrintSettings,
      role: AccountRole.Owner,
      order: 960
    },
    print.ids.Printing
  )
  builder.createDoc(
    templates.class.TemplateFieldCategory,
    core.space.Model,
    {
      label: print.string.PrintedObject
    },
    print.templateFieldCategory.PrintedObject
  )
  builder.createDoc(
    templates.class.TemplateField,
    core.space.Model,
    {
      label: print.string.Title,
      category: print.templateFieldCategory.PrintedObject,
      func: print.function.PrintedObjectTitle
    },
    print.templateField.Title
  )
  builder.createDoc(
    exportPlugin.class.DocumentExporter,
    core.space.Model,
    {
      format: 'pdf',
      label: getEmbeddedLabel('PDF'),
      export: print.function.ExportPDF,
      supportsOrientation: true,
      supportsHeaderFooter: true,
      preview: print.function.PreviewPDF,
      isAvailable: print.function.CanExportPDF,
      bulkExport: print.function.ExportBulkPDF,
      order: 10
    },
    print.exporter.PDF
  )

  builder.createDoc(
    presentation.class.FilePreviewExtension,
    core.space.Model,
    {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      alignment: 'float',
      component: print.component.DOCXViewer,
      extension: presentation.extension.FilePreviewExtension,
      availabilityChecker: print.function.CanConvert
    },
    print.previewExtension.DOCX
  )
}
