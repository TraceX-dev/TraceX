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

import { checkMyPermission, permissionsStore } from '@hcengineering/contact-resources'
import type { TrainingRequest } from '@hcengineering/training'
import { get } from 'svelte/store'
import { getCurrentEmployeeRef } from './getCurrentEmployeeRef'
import training from '../plugin'

export function canSendTrainingReminder (object: TrainingRequest): boolean {
  return (
    object.canceledOn === null &&
    (object.owner === getCurrentEmployeeRef() ||
      checkMyPermission(training.permission.SendTrainingRequestReminder, object.space, get(permissionsStore)))
  )
}
