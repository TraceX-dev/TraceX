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

import type { Class, Client, Doc, Ref } from '@hcengineering/core'
import type { Resource } from '@hcengineering/platform'
import type { TemplateDataProvider } from '@hcengineering/templates'

export type PrintPageOrientation = 'portrait' | 'landscape'

export interface PrintToPDFOptions {
  orientation?: PrintPageOrientation
  printHeaderFooter?: boolean
}

/** Editable decoration values shared by configuration records and class defaults. */
export interface PrintConfigurationValues {
  enabled: boolean
  header: string
  footer: string
  printLogo: boolean
}

/** Class-specific configuration, protected by the configuration domain. */
export interface PrintConfiguration extends Doc, PrintConfigurationValues {
  targetClass: Ref<Class<Doc>>
}

/** Values supplied by the module owning the actual printed document. */
export interface PrintData {
  title: string
  reference?: string
  templateReference?: string
}

export type PrintDataProvider = (client: Client, object: Doc, provider: TemplateDataProvider) => Promise<PrintData>

/** Opt a document class and its descendants into common PDF decorations. */
export interface PrintConfig extends Class<Doc> {
  provider: Resource<PrintDataProvider>
  defaultConfiguration?: PrintConfigurationValues
}

/** PDF-specific parameters supplied by document export actions. */
export interface PrintExportParams {
  signed?: boolean
}
