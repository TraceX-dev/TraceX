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

import contact, { type Employee } from '@hcengineering/contact'
import { type AccountUuid, type Ref } from '@hcengineering/core'
import notification from '@hcengineering/notification'
import { translate } from '@hcengineering/platform'
import { getClient, MessageBox } from '@hcengineering/presentation'
import { focusActionWithAvailability } from '@hcengineering/questions-resources'
import { getCurrentLanguage } from '@hcengineering/theme'
import { type TrainingRequest, TrainingAttemptState } from '@hcengineering/training'
import { addNotification, showPopup } from '@hcengineering/ui'
import ReminderSentNotification from '../components/ReminderSentNotification.svelte'
import { canSendTrainingReminder } from '../utils/canSendTrainingReminder'
import training from '../plugin'

/**
 * Manual follow-up: after confirmation, notify every trainee of a request who has not completed it
 * (no `Passed` attempt). Delivery goes through the generic `notification.class.OnDemandNotification`
 * mechanism, so this action carries no bespoke notification-sending logic.
 */
export const trainingRequestSendReminderAction = focusActionWithAvailability<TrainingRequest>(
  async (object: TrainingRequest) => {
    return canSendTrainingReminder(object)
  },
  async (object: TrainingRequest) => {
    const client = getClient()

    const passedAttempts = await client.findAll(training.class.TrainingAttempt, {
      attachedTo: object._id,
      state: TrainingAttemptState.Passed
    })
    const passed = new Set<Ref<Employee>>(passedAttempts.map((a) => a.owner))
    const nonCompleters = object.trainees.filter((t) => !passed.has(t))
    if (nonCompleters.length === 0) return

    const employees = await client.findAll(contact.mixin.Employee, { _id: { $in: nonCompleters } })
    const targets = employees.map((e) => e.personUuid).filter((uuid): uuid is AccountUuid => uuid != null)
    if (targets.length === 0) return

    showPopup(MessageBox, {
      label: training.string.SendReminder,
      message: training.string.ConfirmSendReminder,
      params: { count: targets.length },
      action: async () => {
        await client.createDoc(notification.class.OnDemandNotification, object.space, {
          targets,
          objectId: object._id,
          objectClass: object._class,
          objectSpace: object.space,
          notificationType: training.ids.TrainingDeadlineReminder,
          header: training.string.TrainingDeadlineReminder,
          message: training.string.TrainingDeadlineReminder,
          icon: training.icon.TrainingRequest
        })

        addNotification(
          await translate(training.string.ReminderSent, { count: targets.length }, getCurrentLanguage()),
          '',
          ReminderSentNotification
        )
      }
    })
  }
)
