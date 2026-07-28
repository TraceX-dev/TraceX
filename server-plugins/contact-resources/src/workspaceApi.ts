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

import contact, { combineName, type Employee, type Organization, type Person } from '@hcengineering/contact'
import type { Class, Doc, Ref } from '@hcengineering/core'
import type { WorkspaceApiContext } from '@hcengineering/integration'
import { getMetadata } from '@hcengineering/platform'

type Input = Record<string, unknown>

function limit (input: Input): number {
  const value = input.limit ?? 100
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1000) {
    throw new Error('limit must be an integer from 1 to 1000')
  }
  return value as number
}

function id (input: Input): Ref<Doc> {
  if (typeof input.id !== 'string' || input.id.trim() === '') throw new Error('Contact id is required')
  return input.id as Ref<Doc>
}

function personName (value: string): string {
  const parts = value.trim().split(/\s+/)
  if (getMetadata(contact.metadata.LastNameFirst) === true) {
    const firstName = parts.length > 1 ? (parts.pop() ?? '') : ''
    return combineName(firstName, parts.join(' '))
  }
  const lastName = parts.length > 1 ? (parts.pop() ?? '') : ''
  return combineName(parts.join(' '), lastName)
}

async function find<T extends Doc> (
  context: WorkspaceApiContext,
  targetClass: Ref<Class<T>>,
  input: Input
): Promise<T[]> {
  return await context.client.findAll(targetClass, {}, { limit: limit(input) })
}

async function get<T extends Doc> (context: WorkspaceApiContext, targetClass: Ref<Class<T>>, input: Input): Promise<T> {
  const query = { _id: id(input) as Ref<T> }
  const value = await context.client.findOne(targetClass, query as never)
  if (value === undefined) throw new Error(`Contact with id "${String(input.id)}" was not found`)
  return value
}

async function create<T extends Person | Organization> (
  context: WorkspaceApiContext,
  targetClass: Ref<Class<T>>,
  input: Input
): Promise<T> {
  if (typeof input.name !== 'string' || input.name.trim() === '') throw new Error('name is required')
  const values: Record<string, unknown> = {
    name: targetClass === contact.class.Person ? personName(input.name) : input.name.trim(),
    avatarType: 'color'
  }
  if (input.city !== undefined) values.city = input.city
  if (targetClass === contact.class.Person && input.birthday !== undefined) values.birthday = input.birthday
  const created = await context.client.createDoc(targetClass, contact.space.Contacts, values)
  return (await get(context, targetClass as never, { id: created as unknown as Ref<T> })) as unknown as T
}

async function patch<T extends Person | Organization> (
  context: WorkspaceApiContext,
  targetClass: Ref<Class<T>>,
  input: Input
): Promise<T> {
  const value = (await get(context, targetClass as never, input)) as unknown as T
  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.trim() === '') throw new Error('name cannot be empty')
    updates.name = targetClass === contact.class.Person ? personName(input.name) : input.name.trim()
  }
  if (input.city !== undefined) updates.city = input.city
  if (targetClass === contact.class.Person && input.birthday !== undefined) updates.birthday = input.birthday
  if (Object.keys(updates).length === 0) throw new Error('At least one editable field is required')
  await context.client.update(value, updates)
  return (await get(context, targetClass as never, { id: value._id as unknown as Ref<T> })) as unknown as T
}

export async function FindPersons (context: WorkspaceApiContext, input: Input): Promise<Person[]> {
  return await find(context, contact.class.Person, input)
}
export async function GetPerson (context: WorkspaceApiContext, input: Input): Promise<Person> {
  return await get(context, contact.class.Person, input)
}
export async function CreatePerson (context: WorkspaceApiContext, input: Input): Promise<Person> {
  return await create(context, contact.class.Person, input)
}
export async function PatchPerson (context: WorkspaceApiContext, input: Input): Promise<Person> {
  return await patch(context, contact.class.Person, input)
}
export async function FindOrganizations (context: WorkspaceApiContext, input: Input): Promise<Organization[]> {
  return await find(context, contact.class.Organization, input)
}
export async function GetOrganization (context: WorkspaceApiContext, input: Input): Promise<Organization> {
  return await get(context, contact.class.Organization, input)
}
export async function CreateOrganization (context: WorkspaceApiContext, input: Input): Promise<Organization> {
  return await create(context, contact.class.Organization, input)
}
export async function PatchOrganization (context: WorkspaceApiContext, input: Input): Promise<Organization> {
  return await patch(context, contact.class.Organization, input)
}
export async function FindEmployees (context: WorkspaceApiContext, input: Input): Promise<Employee[]> {
  return await find(context, contact.mixin.Employee, input)
}
export async function GetEmployee (context: WorkspaceApiContext, input: Input): Promise<Employee> {
  return await get(context, contact.mixin.Employee, input)
}
