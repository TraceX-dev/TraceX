//
// Copyright © 2026 TraceX SAS.
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

import { type Person } from '@hcengineering/contact'
import { type DocumentUpdate, type Ref } from '@hcengineering/core'
import { isApprovalAccess, type Room, RoomAccess } from '@hcengineering/love'
import { getClient } from '@hcengineering/presentation'
import { get } from 'svelte/store'
import { infos } from './stores'

/**
 * Whether nobody is in the room. Agents have no session and do not keep a room occupied on the server either.
 */
function isRoomEmpty (room: Room): boolean {
  return !get(infos).some((it) => it.room === room._id && it.kind !== 'agent')
}

/**
 * Set owners of a shared room. A room without owners is public, so approval access is reset to open.
 */
export async function updateRoomOwners (room: Room, owners: Array<Ref<Person>>): Promise<void> {
  const update: DocumentUpdate<Room> = { owners }
  if (owners.length === 0) {
    if (isApprovalAccess(room.defaultAccess)) update.defaultAccess = RoomAccess.Open
    if (isApprovalAccess(room.access)) update.access = RoomAccess.Open
  }
  await getClient().diffUpdate(room, update)
}

/**
 * Set the default access of a room. It applies right away while nobody is in the room.
 */
export async function updateRoomDefaultAccess (room: Room, access: RoomAccess): Promise<void> {
  const update: DocumentUpdate<Room> = { defaultAccess: access }
  if (isRoomEmpty(room)) update.access = access
  await getClient().diffUpdate(room, update)
}

/**
 * Assign owners and an approval default access in one update, used when a public room becomes private.
 */
export async function updateRoomOwnersAndDefaultAccess (
  room: Room,
  owners: Array<Ref<Person>>,
  access: RoomAccess
): Promise<void> {
  const update: DocumentUpdate<Room> = { owners, defaultAccess: access }
  if (isRoomEmpty(room)) update.access = access
  await getClient().diffUpdate(room, update)
}
