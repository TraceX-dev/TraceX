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
import core, { type Class, type Doc, generateId, type Ref, type Tx, TxFactory, type TxUpdateDoc } from '@hcengineering/core'
import love, { type ParticipantInfo, type Room, RoomAccess, type RoomInfo } from '@hcengineering/love'
import { type TriggerControl } from '@hcengineering/server-core'

import { OnParticipantInfo } from '../index'

const person = 'test:person' as Ref<Person>
const factory = new TxFactory(core.account.System)

interface RoomState {
  _id: Ref<Room>
  isOffice: boolean
  access: RoomAccess
  defaultAccess?: RoomAccess
}

function createControl (room: RoomState, info: ParticipantInfo): TriggerControl {
  const roomInfo: Partial<RoomInfo> = {
    _id: generateId(),
    _class: love.class.RoomInfo,
    space: core.space.Workspace,
    persons: [person],
    room: room._id,
    isOffice: room.isOffice
  }
  const roomDoc: Record<string, unknown> = {
    _id: room._id,
    _class: room.isOffice ? love.class.Office : love.class.Room,
    space: core.space.Workspace,
    access: room.access,
    defaultAccess: room.defaultAccess,
    ...(room.isOffice ? { person } : {})
  }
  const control: Partial<TriggerControl> = {
    removedMap: new Map<Ref<Doc>, Doc>([[info._id, info]]),
    queryFind: (async () => [roomInfo]) as unknown as TriggerControl['queryFind'],
    findAll: (async (_ctx: unknown, _class: Ref<Class<Doc>>, query: { _id?: Ref<Doc> }) =>
      _class === love.class.Room && query._id === room._id ? [roomDoc] : []) as unknown as TriggerControl['findAll'],
    txFactory: factory
  }
  return control as TriggerControl
}

function makeInfo (roomId: Ref<Room>): ParticipantInfo {
  const info: Partial<ParticipantInfo> = {
    _id: generateId(),
    _class: love.class.ParticipantInfo,
    space: core.space.Workspace,
    person,
    room: roomId
  }
  return info as ParticipantInfo
}

async function leaveLastPerson (room: RoomState): Promise<Tx[]> {
  const info = makeInfo(room._id)
  const removeTx = factory.createTxRemoveDoc(love.class.ParticipantInfo, core.space.Workspace, info._id)
  return await OnParticipantInfo([removeTx], createControl(room, info))
}

function accessUpdates (txes: Tx[]): Array<TxUpdateDoc<Room>> {
  return txes.filter(
    (tx): tx is TxUpdateDoc<Room> =>
      tx._class === core.class.TxUpdateDoc && (tx as TxUpdateDoc<Room>).operations.access !== undefined
  )
}

describe('reset to default room access', () => {
  it('returns a shared room to its default access', async () => {
    const result = await leaveLastPerson({
      _id: generateId(),
      isOffice: false,
      access: RoomAccess.DND,
      defaultAccess: RoomAccess.InviteOnly
    })
    expect(accessUpdates(result).map((it) => it.operations.access)).toEqual([RoomAccess.InviteOnly])
  })

  it('returns a shared room without a default access to open', async () => {
    const result = await leaveLastPerson({ _id: generateId(), isOffice: false, access: RoomAccess.DND })
    expect(accessUpdates(result).map((it) => it.operations.access)).toEqual([RoomAccess.Open])
  })

  it('returns an office to knock', async () => {
    const result = await leaveLastPerson({ _id: generateId(), isOffice: true, access: RoomAccess.DND })
    const updates = accessUpdates(result)
    expect(updates.map((it) => it.operations.access)).toEqual([RoomAccess.Knock])
    expect(updates[0].objectClass).toBe(love.class.Office)
  })

  it('does not update a room that already has its default access', async () => {
    const result = await leaveLastPerson({
      _id: generateId(),
      isOffice: false,
      access: RoomAccess.Knock,
      defaultAccess: RoomAccess.Knock
    })
    expect(accessUpdates(result)).toHaveLength(0)
    expect(result.some((tx) => tx._class === core.class.TxRemoveDoc)).toBe(true)
  })
})
