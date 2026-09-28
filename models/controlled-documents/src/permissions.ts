//
// Copyright © 2024 Hardcore Engineering Inc.
// Copyright © 2026 TraceX SAS.
//

import { type Builder } from '@hcengineering/model'
import core, { type ClassPermission } from '@hcengineering/core'
import documents, { DOCUMENT_SEQUENCE_NAMESPACE, documentsId } from '@hcengineering/controlled-documents'

export function definePermissions (builder: Builder): void {
  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: documents.string.ReviewDocumentPermission,
      scope: 'space',
      description: documents.string.ReviewDocumentDescription
    },
    documents.permission.ReviewDocument
  )

  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: documents.string.ApproveDocumentPermission,
      scope: 'space',
      description: documents.string.ApproveDocumentDescription
    },
    documents.permission.ApproveDocument
  )

  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: documents.string.ArchiveDocumentPermission,
      scope: 'space',
      description: documents.string.ArchiveDocumentDescription
    },
    documents.permission.ArchiveDocument
  )

  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: documents.string.CoAuthorDocumentPermission,
      scope: 'space',
      description: documents.string.CoAuthorDocumentDescription
    },
    documents.permission.CoAuthorDocument
  )

  builder.createDoc<ClassPermission>(
    core.class.ClassPermission,
    core.space.Model,
    {
      label: documents.string.CreateDocumentPermission,
      scope: 'space',
      description: documents.string.CreateDocumentDescription,
      txClass: core.class.TxCreateDoc,
      objectClass: documents.class.ControlledDocument,
      targetClass: documents.class.ControlledDocument,
      application: documents.app.Documents,
      guestUpdateAttributes: [
        'title',
        'code',
        'prefix',
        'category',
        'abstract',
        'reviewInterval'
      ],
      guestUpdateMixinAttributes: {
        [documents.mixin.DocumentTemplate]: ['docPrefix']
      },
      relatedCreateClasses: [
        documents.class.DocumentMeta,
        documents.class.ProjectMeta,
        documents.class.ProjectDocument,
        documents.class.ChangeControl
      ],
      sequenceNamespaces: [DOCUMENT_SEQUENCE_NAMESPACE, documentsId]
    },
    documents.permission.CreateDocument
  )

  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: documents.string.UpdateDocumentOwnerPermission,
      scope: 'space',
      description: documents.string.UpdateDocumentOwnerDescription
    },
    documents.permission.UpdateDocumentOwner
  )

  builder.createDoc<ClassPermission>(
    core.class.ClassPermission,
    core.space.Model,
    {
      label: documents.string.CreateDocumentCategoryPermission,
      scope: 'space',
      description: documents.string.CreateDocumentCategoryDescription,
      txClass: core.class.TxCreateDoc,
      objectClass: documents.class.DocumentCategory,
      targetClass: documents.class.DocumentCategory,
      application: documents.app.Documents,
      guestUpdateAttributes: ['code', 'title', 'description']
    },
    documents.permission.CreateDocumentCategory
  )

  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: documents.string.UpdateDocumentCategoryPermission,
      scope: 'space',
      description: documents.string.UpdateDocumentCategoryDescription
    },
    documents.permission.UpdateDocumentCategory
  )

  builder.createDoc(
    core.class.Permission,
    core.space.Model,
    {
      label: documents.string.DeleteDocumentCategoryPermission,
      scope: 'space',
      description: documents.string.DeleteDocumentCategoryDescription
    },
    documents.permission.DeleteDocumentCategory
  )
}
