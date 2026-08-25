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
import { type Ref, type TxOperations } from '@hcengineering/core'

export interface DisableMeetingRoomDefaultsResult {
  updated: number
  wouldUpdate: number
}

/**
 * Disables automatic recording and transcription for all meeting rooms.
 */
export async function disableMeetingRoomDefaults (
  ops: TxOperations,
  dryRun: boolean
): Promise<DisableMeetingRoomDefaultsResult> {
  const rooms = await ops.findAll(love.class.Room, {})
  const offices = await ops.findAll(love.class.Office, {})
  const processed = new Set<Ref<Room>>()
  let wouldUpdate = 0
  let updated = 0

  for (const room of [...rooms, ...offices]) {
    if (processed.has(room._id) || (room.startWithRecording === false && room.startWithTranscription === false)) {
      continue
    }
    processed.add(room._id)
    wouldUpdate++

    if (dryRun) {
      console.log('[dry-run] meeting room defaults', JSON.stringify({ id: room._id, name: room.name }))
      continue
    }

    await ops.update(room, {
      startWithRecording: false,
      startWithTranscription: false
    })
    updated++
  }

  return { updated, wouldUpdate }
}
