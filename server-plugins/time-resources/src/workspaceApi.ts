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

import { getEmployeeBySocialId, type Employee } from '@hcengineering/contact'
import { SortingOrder, type Ref } from '@hcengineering/core'
import type { WorkspaceApiContext } from '@hcengineering/integration'
import { makeRank } from '@hcengineering/task'
import time, { ToDoPriority, type ToDo } from '@hcengineering/time'

type Input = Record<string, unknown>
function limit (input: Input): number {
  const value = input.limit ?? 100
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1000) {
    throw new Error('limit must be an integer from 1 to 1000')
  }
  return value as number
}
function id (input: Input): Ref<ToDo> {
  if (typeof input.id !== 'string' || input.id.trim() === '') throw new Error('ToDo id is required')
  return input.id as Ref<ToDo>
}
async function employee (context: WorkspaceApiContext): Promise<Employee> {
  const value = await getEmployeeBySocialId(context.client, context.currentUser)
  if (value === undefined || !value.active) throw new Error('The API key user is not an active employee')
  return value
}
async function get (context: WorkspaceApiContext, input: Input): Promise<ToDo> {
  const todo = await context.client.findOne(time.class.ToDo, { _id: id(input) })
  if (todo === undefined) throw new Error(`ToDo with id "${String(input.id)}" was not found`)
  return todo
}

export async function FindToDos (context: WorkspaceApiContext, input: Input): Promise<ToDo[]> {
  return await context.client.findAll(
    time.class.ToDo,
    {},
    { limit: limit(input), sort: { rank: SortingOrder.Ascending } }
  )
}
export async function GetToDo (context: WorkspaceApiContext, input: Input): Promise<ToDo> {
  return await get(context, input)
}
export async function CreateToDo (context: WorkspaceApiContext, input: Input): Promise<ToDo> {
  if (typeof input.title !== 'string' || input.title.trim() === '') throw new Error('title is required')
  const description = typeof input.description === 'string' ? input.description : ''
  const dueDate = typeof input.dueDate === 'number' || input.dueDate === null ? input.dueDate : undefined
  const priority = typeof input.priority === 'number' ? input.priority : ToDoPriority.NoPriority
  const visibility =
    input.visibility === 'public' || input.visibility === 'freeBusy' || input.visibility === 'private'
      ? input.visibility
      : 'private'
  const current = await employee(context)
  const latest = await context.client.findOne(
    time.class.ToDo,
    { user: current._id, doneOn: null },
    { sort: { rank: SortingOrder.Ascending } }
  )
  const created = await context.client.addCollection(
    time.class.ToDo,
    time.space.ToDos,
    time.ids.NotAttached,
    time.class.ToDo,
    'todos',
    {
      title: input.title.trim(),
      description,
      dueDate,
      priority,
      visibility,
      user: current._id,
      doneOn: null,
      workslots: 0,
      rank: makeRank(undefined, latest?.rank)
    }
  )
  return await get(context, { id: created })
}
export async function PatchToDo (context: WorkspaceApiContext, input: Input): Promise<ToDo> {
  const todo = await get(context, input)
  const current = await employee(context)
  if (todo.user !== current._id) throw new Error('Only the assigned employee can update this ToDo')
  const updates: Record<string, unknown> = {}
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || input.title.trim() === '') throw new Error('title cannot be empty')
    updates.title = input.title.trim()
  }
  for (const field of ['description', 'dueDate', 'priority', 'visibility'] as const) {
    if (input[field] !== undefined) updates[field] = input[field]
  }
  if (Object.keys(updates).length === 0) throw new Error('At least one editable field is required')
  await context.client.update(todo, updates)
  return await get(context, { id: todo._id })
}
