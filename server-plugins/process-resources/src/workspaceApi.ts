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

import { getEmployeeBySocialId } from '@hcengineering/contact'
import { SortingOrder, type Ref } from '@hcengineering/core'
import type { WorkspaceApiContext } from '@hcengineering/integration'
import process, { type ProcessToDo } from '@hcengineering/process'

type Input = Record<string, unknown>

function idFrom (input: Input): Ref<ProcessToDo> {
  if (typeof input.id !== 'string' || input.id.trim() === '') {
    throw new Error('Process ToDo id is required')
  }
  return input.id as Ref<ProcessToDo>
}

function limitFrom (input: Input): number {
  if (input.limit === undefined) return 100
  if (!Number.isInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > 1000) {
    throw new Error('limit must be an integer from 1 to 1000')
  }
  return input.limit as number
}

export async function FindProcessToDos (context: WorkspaceApiContext, input: Input): Promise<ProcessToDo[]> {
  return await context.client.findAll(
    process.class.ProcessToDo,
    {},
    {
      limit: limitFrom(input),
      sort: { rank: SortingOrder.Ascending }
    }
  )
}

export async function GetProcessToDo (context: WorkspaceApiContext, input: Input): Promise<ProcessToDo> {
  const todo = await context.client.findOne(process.class.ProcessToDo, { _id: idFrom(input) })
  if (todo === undefined) throw new Error(`Process ToDo with id "${String(input.id)}" was not found`)
  return todo
}

/**
 * Process ToDos are deliberately not completable through the workspace API.
 * Their `doneOn` state is controlled only by the process engine.
 */
export async function PatchProcessToDo (context: WorkspaceApiContext, input: Input): Promise<ProcessToDo> {
  const todo = await GetProcessToDo(context, input)
  const employee = await getEmployeeBySocialId(context.client, context.currentUser)
  if (employee === undefined || !employee.active || todo.user !== employee._id) {
    throw new Error('Only the assigned active employee can update this Process ToDo')
  }

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
  return await GetProcessToDo(context, { id: todo._id })
}
