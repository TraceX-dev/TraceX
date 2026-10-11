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

import { DOCUMENT_SEQUENCE_NAMESPACE, documentsId } from '@hcengineering/controlled-documents'
import core, { type ClassPermission } from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'

import documents from './plugin'

/** Defines guest creation policies for the documents module. */
export function defineGuestCreatePolicies (builder: Builder): void {
  builder.createDoc<ClassPermission>(
    core.class.ClassPermission,
    core.space.Model,
    {
      label: documents.string.CreateDocumentPermission,
      description: documents.string.CreateDocumentDescription,
      targetClass: documents.class.ControlledDocument,
      application: documents.app.Documents,
      guestUpdateAttributes: ['title', 'code', 'prefix', 'category', 'abstract', 'reviewInterval'],
      guestUpdateMixinAttributes: {
        [documents.mixin.DocumentTemplate]: ['docPrefix']
      },
      guestCreateMixinAttributes: {
        [documents.mixin.DocumentTemplate]: ['sequence', 'docPrefix']
      },
      relatedCreateClasses: [
        documents.class.DocumentMeta,
        documents.class.ProjectMeta,
        documents.class.ProjectDocument,
        documents.class.ChangeControl
      ],
      sequenceNamespaces: [DOCUMENT_SEQUENCE_NAMESPACE, documentsId]
    },
    documents.ids.GuestCreateDocumentPolicy
  )

  builder.createDoc<ClassPermission>(
    core.class.ClassPermission,
    core.space.Model,
    {
      label: documents.string.CreateDocumentCategoryPermission,
      description: documents.string.CreateDocumentCategoryDescription,
      targetClass: documents.class.DocumentCategory,
      application: documents.app.Documents,
      guestUpdateAttributes: ['code', 'title', 'description']
    },
    documents.ids.GuestCreateDocumentCategoryPolicy
  )
}
