//
// Copyright @ 2022 Hardcore Engineering Inc.
//
import { type Builder } from '@hcengineering/model'

import training from '@hcengineering/model-training'
import serverTraining from '@hcengineering/server-training'
import serverCore from '@hcengineering/server-core'
import core from '@hcengineering/core'
import notification from '@hcengineering/notification'
import serverNotification from '@hcengineering/server-notification'

export { serverTrainingId } from '@hcengineering/server-training/src/index'

export function createModel (builder: Builder): void {
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverTraining.trigger.OnTrainingRequest,
    txMatch: {
      objectClass: training.class.TrainingRequest
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverTraining.trigger.OnTrainingAttempt,
    txMatch: {
      objectClass: training.class.TrainingAttempt
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverTraining.trigger.OnTrainingReminderSettings,
    txMatch: {
      _class: core.class.TxMixin,
      mixin: training.mixin.TrainingReminderSettings
    }
  })

  builder.mixin(
    training.notification.TrainingRequest,
    notification.class.NotificationType,
    serverNotification.mixin.TypeMatch,
    {
      func: serverTraining.function.TrainingRequestNotificationTypeMatch
    }
  )

  builder.mixin(training.class.TrainingRequest, core.class.Class, serverNotification.mixin.TextPresenter, {
    presenter: serverTraining.function.TrainingRequestTextPresenter
  })

  builder.mixin(training.class.TrainingRequest, core.class.Class, serverNotification.mixin.HTMLPresenter, {
    presenter: serverTraining.function.TrainingRequestHTMLPresenter
  })
}
