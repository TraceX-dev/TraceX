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

import love, { type Room } from '@hcengineering/love'
import { type PersonId, type Ref, type TxOperations } from '@hcengineering/core'
import { disableMeetingRoomDefaults } from './meeting-rooms'

function roomFixture (overrides: Partial<Room> = {}): Room {
  return {
    _id: 'love:room:one' as Ref<Room>,
    _class: love.class.Room,
    space: 'core:space:Workspace',
    modifiedOn: 0,
    modifiedBy: 'core:account:System' as PersonId,
    name: 'Meeting room',
    startWithRecording: false,
    startWithTranscription: false,
    ...overrides
  } as unknown as Room
}

function createMockOps (rooms: Room[], offices: Room[]): { ops: TxOperations, update: jest.Mock } {
  const update = jest.fn(async () => undefined)
  const ops = {
    findAll: jest.fn(async (roomClass: unknown) => (roomClass === love.class.Room ? rooms : offices)),
    update
  } as unknown as TxOperations
  return { ops, update }
}

describe('disableMeetingRoomDefaults', () => {
  it('only reports affected rooms in dry-run mode', async () => {
    const enabledRoom = roomFixture({ startWithRecording: true })
    const disabledRoom = roomFixture({ _id: 'love:room:two' as Ref<Room> })
    const { ops, update } = createMockOps([enabledRoom, disabledRoom], [])
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    const result = await disableMeetingRoomDefaults(ops, true)

    expect(result).toEqual({ updated: 0, wouldUpdate: 1 })
    expect(update).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('[dry-run] meeting room defaults', expect.stringContaining(enabledRoom._id))
    logSpy.mockRestore()
  })

  it('disables both defaults for every affected room', async () => {
    const room = roomFixture({ startWithTranscription: true })
    const office = roomFixture({ _id: 'love:office:one' as Ref<Room>, startWithRecording: true })
    const { ops, update } = createMockOps([room], [office])

    const result = await disableMeetingRoomDefaults(ops, false)

    expect(result).toEqual({ updated: 2, wouldUpdate: 2 })
    expect(update).toHaveBeenCalledTimes(2)
    expect(update).toHaveBeenCalledWith(room, { startWithRecording: false, startWithTranscription: false })
    expect(update).toHaveBeenCalledWith(office, { startWithRecording: false, startWithTranscription: false })
  })
})
