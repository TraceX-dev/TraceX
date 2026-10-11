//
// Copyright © 2026 Hardcore Engineering Inc.
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

import { cardId } from '@hcengineering/card'
import { documentId } from '@hcengineering/document'
import { addLocation } from '@hcengineering/platform'
import { trackerId } from '@hcengineering/tracker'

export function prepare (): void {
  addLocation(cardId, () => import('@hcengineering/server-card-resources'))
  addLocation(documentId, () => import('@hcengineering/server-document-resources'))
  addLocation(trackerId, () => import('@hcengineering/server-tracker-resources'))
}
