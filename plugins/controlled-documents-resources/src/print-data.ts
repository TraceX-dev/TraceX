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

import documents, { type ControlledDocument } from '@hcengineering/controlled-documents'
import type { Client, Doc } from '@hcengineering/core'
import type { PrintData } from '@hcengineering/print'
import type { TemplateDataProvider } from '@hcengineering/templates'
import { getDocReference } from './docutils'

/** Use the exact document version already resolved by the editor panel. */
export async function getPrintData (client: Client, object: Doc, provider: TemplateDataProvider): Promise<PrintData> {
  const document = object as ControlledDocument
  provider.set(documents.class.ControlledDocument, document)
  const template =
    document.template == null ? undefined : await client.findOne(documents.class.Document, { _id: document.template })
  return {
    title: document.title,
    reference: getDocReference(document),
    templateReference: getDocReference(template ?? null)
  }
}
