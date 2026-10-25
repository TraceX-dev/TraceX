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

import { LiveKitPollingService } from './polling'
import { WorkspaceClient } from './workspaceClient'

// ./utils imports ./config, which throws on missing env variables at load time
jest.mock('./utils', () => ({ parseParticipantMetadata: jest.fn(() => undefined) }))

jest.mock('./workspaceClient', () => ({
  WorkspaceClient: { create: jest.fn() }
}))

const ctx: any = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

function makeService (
  rooms: any[] = [],
  participants: any[] = []
): {
  svc: any
  roomClient: any
  poll: () => Promise<void>
} {
  const roomClient = {
    listRooms: jest.fn(async () => rooms),
    listParticipants: jest.fn(async () => participants)
  }
  const svc: any = new LiveKitPollingService(ctx, roomClient as any, { intervalMs: 30000, projectKey: 'p' })
  svc.isRunning = true
  return { svc, roomClient, poll: async () => await svc.poll() }
}

describe('LiveKitPollingService', () => {
  let wsClient: any

  beforeEach(() => {
    jest.clearAllMocks()
    wsClient = {
      checkUnfinishedMeetings: jest.fn(async () => true),
      cleanupOrphanedParticipantInfos: jest.fn(async () => undefined),
      findParticipantInfosByMeeting: jest.fn(async () => []),
      findPersonRefById: jest.fn(async () => undefined),
      removeParticipantInfoById: jest.fn(async () => undefined),
      finishMeeting: jest.fn(async () => undefined)
    }
    ;(WorkspaceClient.create as jest.Mock).mockResolvedValue(wsClient)
  })

  it('checks unfinished meetings only once per workspace', async () => {
    const { svc, poll } = makeService()

    svc.addWorkspaceToCheck('ws1')
    await poll()
    expect(wsClient.checkUnfinishedMeetings).toHaveBeenCalledTimes(1)

    // further transactions in the same workspace must not trigger new checks
    svc.addWorkspaceToCheck('ws1')
    await poll()
    expect(wsClient.checkUnfinishedMeetings).toHaveBeenCalledTimes(1)

    svc.addWorkspaceToCheck('ws2')
    await poll()
    expect(wsClient.checkUnfinishedMeetings).toHaveBeenCalledTimes(2)
  })

  it('retries the check when it reports failure', async () => {
    const { svc, poll } = makeService()
    wsClient.checkUnfinishedMeetings.mockResolvedValueOnce(false)

    svc.addWorkspaceToCheck('ws1')
    await poll()
    await poll()
    expect(wsClient.checkUnfinishedMeetings).toHaveBeenCalledTimes(2)

    await poll()
    expect(wsClient.checkUnfinishedMeetings).toHaveBeenCalledTimes(2)
  })

  it('retries the check when the workspace client throws', async () => {
    const { svc, poll } = makeService()
    ;(WorkspaceClient.create as jest.Mock).mockRejectedValueOnce(new Error('fetch failed'))

    svc.addWorkspaceToCheck('ws1')
    await poll()
    await poll()
    expect(wsClient.checkUnfinishedMeetings).toHaveBeenCalledTimes(1)
  })

  it('loads ParticipantInfo once per room per cycle', async () => {
    const room = { name: 'ws1_meeting1', metadata: JSON.stringify({ projectKey: 'p' }) }
    const { poll } = makeService([room], [{ identity: 'u1', name: 'U1', kind: 0 }])
    wsClient.findParticipantInfosByMeeting.mockResolvedValue([{ _id: 'i1', person: 'u1', name: 'U1' }])

    await poll()
    expect(wsClient.findParticipantInfosByMeeting).toHaveBeenCalledTimes(1)
    expect(wsClient.findParticipantInfosByMeeting).toHaveBeenCalledWith('meeting1')
  })

  it('removes stale ParticipantInfo that is not in LiveKit', async () => {
    const room = { name: 'ws1_meeting1', metadata: JSON.stringify({ projectKey: 'p' }) }
    const { poll } = makeService([room], [])
    wsClient.findParticipantInfosByMeeting.mockResolvedValue([{ _id: 'i1', person: 'gone', name: 'X' }])

    await poll()
    expect(wsClient.removeParticipantInfoById).toHaveBeenCalledWith('i1')
  })

  it('does not start a new cycle while the previous one is still running', async () => {
    const { roomClient, poll } = makeService()
    let release: () => void = () => {}
    roomClient.listRooms.mockImplementationOnce(
      async () =>
        await new Promise<any[]>((resolve) => {
          release = () => {
            resolve([])
          }
        })
    )

    const first = poll()
    await poll() // skipped
    expect(roomClient.listRooms).toHaveBeenCalledTimes(1)

    release()
    await first
    await poll()
    expect(roomClient.listRooms).toHaveBeenCalledTimes(2)
  })
})
