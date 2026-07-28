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

import calendar, { AccessLevel, type Calendar, type Event, type Visibility } from '@hcengineering/calendar'
import contact, { getEmployeeBySocialId, type Contact } from '@hcengineering/contact'
import { generateId, SortingOrder, type Ref } from '@hcengineering/core'
import type { WorkspaceApiContext } from '@hcengineering/integration'

type Input = Record<string, unknown>

function limit (input: Input): number {
  const value = input.limit ?? 100
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1000) {
    throw new Error('limit must be an integer from 1 to 1000')
  }
  return value as number
}
function id (input: Input): Ref<Event> {
  if (typeof input.id !== 'string' || input.id.trim() === '') throw new Error('Event id is required')
  return input.id as Ref<Event>
}
function dates (date: unknown, dueDate: unknown): void {
  if (
    typeof date !== 'number' ||
    typeof dueDate !== 'number' ||
    !Number.isFinite(date) ||
    !Number.isFinite(dueDate) ||
    dueDate < date
  ) {
    throw new Error('date and dueDate must be ordered timestamps')
  }
}
function strings (value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings`)
  }
  return value
}
function numbers (value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number')) {
    throw new Error(`${field} must be an array of numbers`)
  }
  return value
}
function visibility (value: unknown): Visibility {
  if (value === undefined) return 'private'
  if (!['public', 'freeBusy', 'private'].includes(value as string)) {
    throw new Error('visibility must be public, freeBusy, or private')
  }
  return value as Visibility
}

async function selectedCalendar (context: WorkspaceApiContext, name: unknown): Promise<Calendar> {
  if (typeof name !== 'string' || name.trim() === '') throw new Error('calendar name is required')
  const calendars = await context.client.findAll(calendar.class.Calendar, { name, hidden: { $ne: true } }, { limit: 2 })
  if (calendars.length !== 1) throw new Error(`Calendar named "${name}" was not found or is ambiguous`)
  if (
    calendars[0].user !== context.currentUser ||
    ![AccessLevel.Owner, AccessLevel.Writer].includes(calendars[0].access)
  ) {
    throw new Error('Calendar is not writable by the API key user')
  }
  return calendars[0]
}

async function contacts (
  context: WorkspaceApiContext,
  names: unknown,
  own?: Ref<Contact>
): Promise<Array<Ref<Contact>>> {
  if (!Array.isArray(names)) return own === undefined ? [] : [own]
  const all = await context.client.findAll(contact.class.Contact, {})
  const result: Array<Ref<Contact>> = own === undefined ? [] : [own]
  for (const name of names) {
    if (typeof name !== 'string' || name.trim() === '') throw new Error('participants must contain contact names')
    const matches = all.filter((item) => item.name === name)
    if (matches.length !== 1) throw new Error(`Contact named "${name}" was not found or is ambiguous`)
    if (!result.includes(matches[0]._id)) result.push(matches[0]._id)
  }
  return result
}

async function get (context: WorkspaceApiContext, input: Input): Promise<Event> {
  const event = await context.client.findOne(calendar.class.Event, { _id: id(input) })
  if (event === undefined) throw new Error(`Event with id "${String(input.id)}" was not found`)
  return event
}

export async function FindEvents (context: WorkspaceApiContext, input: Input): Promise<Event[]> {
  const target = await selectedCalendar(context, input.calendar)
  return await context.client.findAll(
    calendar.class.Event,
    { calendar: target._id },
    { limit: limit(input), sort: { date: SortingOrder.Ascending } }
  )
}
export async function GetEvent (context: WorkspaceApiContext, input: Input): Promise<Event> {
  return await get(context, input)
}
export async function CreateEvent (context: WorkspaceApiContext, input: Input): Promise<Event> {
  if (typeof input.title !== 'string' || input.title.trim() === '') throw new Error('title is required')
  dates(input.date, input.dueDate)
  const target = await selectedCalendar(context, input.calendar)
  const employee = await getEmployeeBySocialId(context.client, context.currentUser)
  if (employee === undefined || !employee.active) throw new Error('The API key user is not an active employee')
  const created = await context.client.addCollection(
    calendar.class.Event,
    calendar.space.Calendar,
    calendar.ids.NoAttached,
    calendar.class.Event,
    'events',
    {
      calendar: target._id,
      eventId: generateId(),
      title: input.title.trim(),
      description: typeof input.description === 'string' ? input.description : '',
      date: input.date as number,
      dueDate: input.dueDate as number,
      allDay: input.allDay === true,
      location: typeof input.location === 'string' ? input.location : undefined,
      participants: await contacts(context, input.participants, employee._id as Ref<Contact>),
      externalParticipants:
        input.externalParticipants === undefined ? [] : strings(input.externalParticipants, 'externalParticipants'),
      reminders: input.reminders === undefined ? [] : numbers(input.reminders, 'reminders'),
      visibility: visibility(input.visibility),
      access: AccessLevel.Owner,
      timeZone: typeof input.timeZone === 'string' ? input.timeZone : undefined,
      user: context.currentUser,
      blockTime: input.allDay !== true
    }
  )
  return await get(context, { id: created })
}
export async function PatchEvent (context: WorkspaceApiContext, input: Input): Promise<Event> {
  const event = await get(context, input)
  if (event.user !== context.currentUser || event.access !== AccessLevel.Owner) {
    throw new Error('Only an event owned by the API key user can be updated')
  }
  const updates: Record<string, unknown> = {}
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || input.title.trim() === '') throw new Error('title cannot be empty')
    updates.title = input.title.trim()
  }
  for (const field of [
    'description',
    'location',
    'externalParticipants',
    'reminders',
    'visibility',
    'timeZone'
  ] as const) {
    if (input[field] !== undefined) updates[field] = input[field]
  }
  if (input.date !== undefined) updates.date = input.date
  if (input.dueDate !== undefined) updates.dueDate = input.dueDate
  dates(updates.date ?? event.date, updates.dueDate ?? event.dueDate)
  if (input.allDay !== undefined) {
    updates.allDay = input.allDay
    updates.blockTime = input.allDay !== true
  }
  if (input.participants !== undefined) updates.participants = await contacts(context, input.participants)
  if (Object.keys(updates).length === 0) throw new Error('At least one editable field is required')
  await context.client.update(event, updates)
  return await get(context, { id: event._id })
}
