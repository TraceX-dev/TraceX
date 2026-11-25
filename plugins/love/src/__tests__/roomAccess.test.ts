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
import { type Data, type Ref } from '@hcengineering/core'
import { type Office, type Room, RoomAccess } from '../types'
import {
  canManageRoomAccess,
  canManageRoomDefaultAccess,
  canManageRoomOwners,
  getAvailableRoomAccess,
  getDefaultRoomAccess,
  getRoomOwners,
  isValidRoomOwnership,
  requiresApproval
} from '../utils'

type AccessFields = Pick<Data<Room>, 'access' | 'owners' | 'defaultAccess'>

const alice = 'alice' as Ref<Person>
const bob = 'bob' as Ref<Person>

function room (fields: Partial<AccessFields> = {}): AccessFields {
  const value: AccessFields = { access: RoomAccess.Open, ...fields }
  return value
}

function office (person: Ref<Person> | null): AccessFields & Pick<Office, 'person'> {
  const value: AccessFields & Pick<Office, 'person'> = { access: RoomAccess.Knock, person }
  return value
}

describe('room access helpers', () => {
  it('returns owners of offices and shared rooms', () => {
    expect(getRoomOwners(office(alice))).toEqual([alice])
    expect(getRoomOwners(office(null))).toEqual([])
    expect(getRoomOwners(room({ owners: [bob] }))).toEqual([bob])
    expect(getRoomOwners(room())).toEqual([])
  })

  it('offers approval access only for rooms with owners', () => {
    expect(getAvailableRoomAccess(room())).toEqual([RoomAccess.Open, RoomAccess.DND])
    expect(getAvailableRoomAccess(room({ owners: [alice] }))).toEqual([
      RoomAccess.Open,
      RoomAccess.Knock,
      RoomAccess.InviteOnly,
      RoomAccess.DND
    ])
    expect(getAvailableRoomAccess(office(alice))).toEqual([RoomAccess.Knock, RoomAccess.DND])
  })

  it('uses the default access of the room', () => {
    expect(getDefaultRoomAccess(room())).toBe(RoomAccess.Open)
    expect(getDefaultRoomAccess(room({ defaultAccess: RoomAccess.InviteOnly, owners: [alice] }))).toBe(
      RoomAccess.InviteOnly
    )
    expect(getDefaultRoomAccess(office(alice))).toBe(RoomAccess.Knock)
  })

  it('requires approval for knock and invite only shared rooms', () => {
    expect(requiresApproval(room({ access: RoomAccess.Knock, owners: [alice] }))).toBe(true)
    expect(requiresApproval(room({ access: RoomAccess.InviteOnly, owners: [alice] }))).toBe(true)
    expect(requiresApproval(room({ access: RoomAccess.DND }))).toBe(false)
    expect(requiresApproval(room({ access: RoomAccess.Knock }))).toBe(false)
    expect(requiresApproval(office(alice))).toBe(false)
  })

  it('checks who manages access and owners', () => {
    const owned = room({ owners: [alice] })
    expect(canManageRoomAccess(owned, alice, false)).toBe(true)
    expect(canManageRoomAccess(owned, bob, false)).toBe(false)
    expect(canManageRoomAccess(owned, bob, true)).toBe(true)
    expect(canManageRoomAccess(room(), bob, false)).toBe(true)
    expect(canManageRoomAccess(office(alice), bob, true)).toBe(false)

    expect(canManageRoomDefaultAccess(owned, alice, false)).toBe(true)
    expect(canManageRoomDefaultAccess(owned, bob, false)).toBe(false)
    expect(canManageRoomDefaultAccess(room(), bob, false)).toBe(false)
    expect(canManageRoomDefaultAccess(room(), bob, true)).toBe(true)
    expect(canManageRoomDefaultAccess(office(alice), alice, true)).toBe(false)

    expect(canManageRoomOwners(owned, alice, false)).toBe(true)
    expect(canManageRoomOwners(room(), bob, false)).toBe(false)
    expect(canManageRoomOwners(room(), bob, true)).toBe(true)
    expect(canManageRoomOwners(office(alice), alice, true)).toBe(false)
  })

  it('requires an owner for approval access', () => {
    expect(isValidRoomOwnership(room({ access: RoomAccess.Knock }))).toBe(false)
    expect(isValidRoomOwnership(room({ defaultAccess: RoomAccess.InviteOnly }))).toBe(false)
    expect(isValidRoomOwnership(room({ access: RoomAccess.Knock, owners: [alice] }))).toBe(true)
    expect(isValidRoomOwnership(room({ access: RoomAccess.DND }))).toBe(true)
    expect(isValidRoomOwnership(office(null))).toBe(true)
  })
})
