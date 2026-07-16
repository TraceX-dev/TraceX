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

import calendar, { AccessLevel, generateEventId, getPrimaryCalendar } from '@hcengineering/calendar'
import { type Employee, type Person } from '@hcengineering/contact'
import core, {
  type Data,
  type DocumentUpdate,
  pickPrimarySocialId,
  type Ref,
  type Space,
  type Tx,
  type TxCreateDoc,
  type TxMixin,
  type TxRemoveDoc,
  type TxUpdateDoc,
  type TypedSpace
} from '@hcengineering/core'
import { getAccountBySocialId, getSocialIds } from '@hcengineering/server-contact'
import { type TriggerControl } from '@hcengineering/server-core'
import training, {
  type Training,
  TrainingAttemptState,
  type TrainingDeadlineEvent,
  type TrainingReminderSettings,
  type TrainingRequest
} from '@hcengineering/training'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_OFFSETS_DAYS = [30, 7, 1]

function sameOffsets (a: number[] | undefined, b: number[]): boolean {
  const sa = [...(a ?? [])].sort((x, y) => x - y)
  const sb = [...b].sort((x, y) => x - y)
  if (sa.length !== sb.length) return false
  return sa.every((v, i) => v === sb[i])
}

/**
 * Resolve the reminder lead-time series (in ms before `dueDate`) configured for a Trainings space.
 * Reads the {@link training.mixin.TrainingReminderSettings} mixin on the space; falls back to a default
 * when the space was never configured.
 *
 * Returns an empty series when reminders are disabled — the deadline event is still created (so the
 * deadline stays visible on the trainee's calendar), it just carries no reminders to schedule.
 */
async function resolveReminderOffsetsMs (control: TriggerControl, spaceRef: Ref<TypedSpace>): Promise<number[]> {
  let days = DEFAULT_OFFSETS_DAYS
  const space = (await control.findAll(control.ctx, core.class.TypedSpace, { _id: spaceRef }, { limit: 1 }))[0]
  if (space !== undefined && control.hierarchy.hasMixin(space, training.mixin.TrainingReminderSettings)) {
    const settings = control.hierarchy.as(space, training.mixin.TrainingReminderSettings)
    if (settings.remindersEnabled === false) return []
    if (Array.isArray(settings.reminderOffsetsDays) && settings.reminderOffsetsDays.length > 0) {
      days = settings.reminderOffsetsDays
    }
  }
  return days.filter((d) => typeof d === 'number' && d > 0).map((d) => d * DAY_MS)
}

/**
 * Build a `TxCreateDoc` for a per-trainee {@link TrainingDeadlineEvent}, resolving the trainee's
 * primary calendar + social id the same way the calendar `OnEvent` trigger does for participants.
 *
 * The event is created with `access = Reader` so calendar's own participant fan-out is skipped, while
 * its `reminders` are still scheduled by the `OnEvent` trigger (scheduling runs regardless of access).
 */
async function buildDeadlineEventTx (
  control: TriggerControl,
  request: TrainingRequest,
  trainee: Ref<Employee>,
  offsetsMs: number[],
  title: string
): Promise<Tx | undefined> {
  if (request.dueDate == null) return undefined

  const socialIds = await getSocialIds(control, trainee as unknown as Ref<Person>)
  if (socialIds.length === 0) return undefined
  const primary = pickPrimarySocialId(socialIds)._id
  const acc = await getAccountBySocialId(control, primary)
  if (acc == null) return undefined

  const calendars = await control.findAll(control.ctx, calendar.class.Calendar, { user: primary, hidden: false })
  const cal = getPrimaryCalendar(calendars, undefined, acc)

  const data: Data<TrainingDeadlineEvent> = {
    attachedTo: request._id,
    attachedToClass: training.class.TrainingRequest,
    collection: 'trainingDeadlineEvents',
    calendar: cal,
    eventId: generateEventId(),
    title,
    description: '',
    allDay: true,
    date: request.dueDate,
    dueDate: request.dueDate,
    participants: [trainee as unknown as Ref<Person>],
    reminders: offsetsMs,
    access: AccessLevel.Reader,
    user: primary,
    blockTime: false,
    request: request._id,
    trainee
  }

  return control.txFactory.createTxCreateDoc(training.class.TrainingDeadlineEvent, calendar.space.Calendar, data)
}

/**
 * Idempotently reconcile the set of deadline events for a request against its current trainees / dueDate.
 * Handles create, dueDate change, trainee add/remove and cancellation in one path.
 */
async function reconcileDeadlineEvents (control: TriggerControl, requestId: Ref<TrainingRequest>): Promise<Tx[]> {
  const request = (
    await control.findAll(control.ctx, training.class.TrainingRequest, { _id: requestId }, { limit: 1 })
  )[0]
  const existing = await control.findAll(control.ctx, training.class.TrainingDeadlineEvent, { request: requestId })

  // Request gone, cancelled, or without a deadline → drop all deadline events.
  if (request?.dueDate == null || request.canceledOn != null) {
    return existing.map((ev) => control.txFactory.createTxRemoveDoc(ev._class, ev.space, ev._id))
  }

  const res: Tx[] = []
  const offsetsMs = await resolveReminderOffsetsMs(control, request.space)
  const training0 = (
    await control.findAll(control.ctx, training.class.Training, { _id: request.attachedTo }, { limit: 1 })
  )[0] as Training | undefined
  const title = training0?.title ?? 'Training'

  const wanted = new Set(request.trainees)
  const byTrainee = new Map(existing.map((ev) => [ev.trainee, ev]))

  // Create for newly-added trainees; keep dueDate + reminder offsets in sync for existing ones.
  for (const trainee of request.trainees) {
    const ev = byTrainee.get(trainee)
    if (ev === undefined) {
      const tx = await buildDeadlineEventTx(control, request, trainee, offsetsMs, title)
      if (tx !== undefined) res.push(tx)
    } else {
      const ops: DocumentUpdate<TrainingDeadlineEvent> = {}
      if (ev.date !== request.dueDate) {
        ops.date = request.dueDate
        ops.dueDate = request.dueDate
      }
      if (!sameOffsets(ev.reminders, offsetsMs)) {
        ops.reminders = offsetsMs
      }
      if (Object.keys(ops).length > 0) {
        res.push(control.txFactory.createTxUpdateDoc(ev._class, ev.space, ev._id, ops))
      }
    }
  }

  // Remove events for trainees no longer on the request.
  for (const ev of existing) {
    if (!wanted.has(ev.trainee)) {
      res.push(control.txFactory.createTxRemoveDoc(ev._class, ev.space, ev._id))
    }
  }

  return res
}

/**
 * Trigger on `TrainingRequest` changes: (re)build the trainees' deadline events.
 * @public
 */
export async function OnTrainingRequest (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const res: Tx[] = []
  for (const tx of txes) {
    if (!control.hierarchy.isDerived(tx._class, core.class.TxCUD)) continue
    const cud = tx as TxCreateDoc<TrainingRequest> | TxUpdateDoc<TrainingRequest> | TxRemoveDoc<TrainingRequest>
    if (!control.hierarchy.isDerived(cud.objectClass, training.class.TrainingRequest)) continue
    res.push(...(await reconcileDeadlineEvents(control, cud.objectId)))
  }
  return res
}

/**
 * Trigger on `TrainingReminderSettings` mixin changes: when the reminder offsets for a Trainings space
 * change, reconcile every open request in that space so existing deadline events pick up the new series.
 * @public
 */
export async function OnTrainingReminderSettings (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const spaces = new Set<Ref<TypedSpace>>()
  for (const tx of txes) {
    if (!control.hierarchy.isDerived(tx._class, core.class.TxMixin)) continue
    const mixinTx = tx as TxMixin<Space, TrainingReminderSettings>
    if (mixinTx.mixin !== training.mixin.TrainingReminderSettings) continue
    spaces.add(mixinTx.objectId as Ref<TypedSpace>)
  }

  const res: Tx[] = []
  for (const space of spaces) {
    const requests = await control.findAll(control.ctx, training.class.TrainingRequest, {
      space,
      canceledOn: null
    })
    for (const request of requests) {
      res.push(...(await reconcileDeadlineEvents(control, request._id)))
    }
  }
  return res
}

/**
 * Trigger on `TrainingAttempt` changes: when a trainee passes, remove their deadline event
 * (reminders are cancelled by calendar's `onRemoveEvent`). A reminder already in flight is also
 * suppressed by the events-processor once the attempt is `Passed`.
 * @public
 */
export async function OnTrainingAttempt (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const res: Tx[] = []
  for (const tx of txes) {
    if (!control.hierarchy.isDerived(tx._class, core.class.TxCUD)) continue
    const cud = tx as TxCreateDoc<any> | TxUpdateDoc<any>
    if (!control.hierarchy.isDerived(cud.objectClass, training.class.TrainingAttempt)) continue

    let becamePassed = false
    if (control.hierarchy.isDerived(cud._class, core.class.TxCreateDoc)) {
      becamePassed = (cud as TxCreateDoc<any>).attributes?.state === TrainingAttemptState.Passed
    } else if (control.hierarchy.isDerived(cud._class, core.class.TxUpdateDoc)) {
      becamePassed = (cud as TxUpdateDoc<any>).operations?.state === TrainingAttemptState.Passed
    }
    if (!becamePassed) continue

    const attempt = (
      await control.findAll(control.ctx, training.class.TrainingAttempt, { _id: cud.objectId }, { limit: 1 })
    )[0]
    if (attempt === undefined) continue

    const events = await control.findAll(control.ctx, training.class.TrainingDeadlineEvent, {
      request: attempt.attachedTo,
      trainee: attempt.owner
    })
    for (const ev of events) {
      res.push(control.txFactory.createTxRemoveDoc(ev._class, ev.space, ev._id))
    }
  }
  return res
}
