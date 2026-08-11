//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the PolyForm Shield License 1.0.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://polyformproject.org/licenses/shield/1.0.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { addLocation, type Plugin } from '@hcengineering/platform'
import { cardId } from '@hcengineering/card'
import { documentId } from '@hcengineering/document'
import { serverCardId } from '@hcengineering/server-card'
import { serverCalendarId } from '@hcengineering/server-calendar'
import { serverChunterId } from '@hcengineering/server-chunter'
import { serverContactId } from '@hcengineering/server-contact'
import { serverDocumentsId } from '@hcengineering/server-controlled-documents'
import { serverDocumentId } from '@hcengineering/server-document'
import { serverProcessId } from '@hcengineering/server-process'
import { serverTimeId } from '@hcengineering/server-time'
import { serverTrackerId } from '@hcengineering/server-tracker'

const trackerId = 'tracker' as Plugin

/**
 * Resource composition for the API pod. Domain operations stay in their
 * respective `server-plugins/*-resources` packages; this pod only makes
 * model-referenced resources loadable.
 */
export function registerWorkspaceApiResources (): void {
  addLocation(cardId, () => import('@hcengineering/server-card-resources'))
  addLocation(documentId, () => import('@hcengineering/server-document-resources'))
  addLocation(trackerId, () => import('@hcengineering/server-tracker-resources'))
  addLocation(serverDocumentId, () => import('@hcengineering/server-document-resources'))
  addLocation(serverCardId, () => import('@hcengineering/server-card-resources'))
  addLocation(serverTrackerId, () => import('@hcengineering/server-tracker-resources'))
  addLocation(serverContactId, () => import('@hcengineering/server-contact-resources'))
  addLocation(serverCalendarId, () => import('@hcengineering/server-calendar-resources'))
  addLocation(serverChunterId, () => import('@hcengineering/server-chunter-resources'))
  addLocation(serverTimeId, () => import('@hcengineering/server-time-resources'))
  addLocation(serverDocumentsId, () => import('@hcengineering/server-controlled-documents-resources'))
  addLocation(serverProcessId, () => import('@hcengineering/server-process-resources'))
}
