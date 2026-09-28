/**

Copyright © 2026 TraceX SAS.

Licensed under the PolyForm Shield License 1.0.0 (the "License");
you may not use this file except in compliance with the License. You may
obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the License for the specific language governing permissions and
limitations under the License.
*/

import { DOCUMENT_SEQUENCE_NAMESPACE, documentsId } from '@hcengineering/controlled-documents'
import core, { type ClassPermission } from '@hcengineering/core'
import { type Builder } from '@hcengineering/model'

import documents from './plugin'

/**
 * Guest create policies of the documents module. They take effect only while the guest group of the module
 * grants `core.permission.CreateObject`, and only in spaces of the group's space class.
 *
 * They are separate from the space permissions `CreateDocument` and `CreateDocumentCategory`, so the checks
 * of other roles are not affected.
 */
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
      // A template is a controlled document created together with its template mixin.
      guestCreateMixinAttributes: {
        [documents.mixin.DocumentTemplate]: ['sequence', 'docPrefix']
      },
      relatedCreateClasses: [
        documents.class.DocumentMeta,
        documents.class.ProjectMeta,
        documents.class.ProjectDocument,
        documents.class.ChangeControl
      ],
      // Document numbers per template and per-prefix document codes.
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
