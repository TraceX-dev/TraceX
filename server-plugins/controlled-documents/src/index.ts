//
// Copyright © 2023 Hardcore Engineering Inc.
// Copyright © 2026 TraceX SAS.
//
//

import type { Plugin, Resource } from '@hcengineering/platform'
import { plugin } from '@hcengineering/platform'
import type { WorkspaceApiOperation } from '@hcengineering/integration'
import { TriggerFunc } from '@hcengineering/server-core'
import { Presenter, TypeMatchFunc } from '@hcengineering/server-notification'

/**
 * @public
 */
export const serverDocumentsId = 'server-documents' as Plugin

/**
 * @public
 */
export default plugin(serverDocumentsId, {
  trigger: {
    OnDocEnteredNonActionableState: '' as Resource<TriggerFunc>,
    OnDocPlannedEffectiveDateChanged: '' as Resource<TriggerFunc>,
    OnDocApprovalRequestApproved: '' as Resource<TriggerFunc>,
    OnDocHasBecomeEffective: '' as Resource<TriggerFunc>,
    OnDocTitleChanged: '' as Resource<TriggerFunc>
  },
  function: {
    ControlledDocumentTextPresenter: '' as Resource<Presenter>,
    ControlledDocumentHTMLPresenter: '' as Resource<Presenter>,
    CoAuthorsTypeMatch: '' as TypeMatchFunc,
    DocumentReviewedTypeMatch: '' as TypeMatchFunc
  },
  workspaceApi: {
    FindControlledDocuments: '' as Resource<WorkspaceApiOperation>,
    GetControlledDocument: '' as Resource<WorkspaceApiOperation>,
    GetControlledDocumentVersions: '' as Resource<WorkspaceApiOperation>,
    CreateControlledDocumentDraft: '' as Resource<WorkspaceApiOperation>,
    SendControlledDocumentForReview: '' as Resource<WorkspaceApiOperation>,
    SendControlledDocumentForApproval: '' as Resource<WorkspaceApiOperation>
  }
})
