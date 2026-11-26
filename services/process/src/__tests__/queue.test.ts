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
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { getPlatformQueue } from '@hcengineering/kafka'
import { closeQueue, getQueue } from '../queue'

jest.mock('@hcengineering/kafka', () => ({
  getPlatformQueue: jest.fn(() => ({ shutdown: jest.fn().mockResolvedValue(undefined) }))
}))
jest.mock('../utils', () => ({ SERVICE_NAME: 'process-service' }))
jest.mock('../config', () => ({ __esModule: true, default: { QueueRegion: 'region' } }))

describe('process queue', () => {
  afterEach(async () => {
    await closeQueue()
    jest.mocked(getPlatformQueue).mockClear()
  })

  it('creates a single Kafka client for repeated calls', () => {
    const first = getQueue()
    for (let i = 0; i < 100; i++) {
      expect(getQueue()).toBe(first)
    }
    expect(getPlatformQueue).toHaveBeenCalledTimes(1)
    expect(getPlatformQueue).toHaveBeenCalledWith('process-service', 'region')
  })

  it('shuts down the queue and creates a new one after close', async () => {
    const first = getQueue()
    await closeQueue()
    expect(first.shutdown).toHaveBeenCalledTimes(1)

    const second = getQueue()
    expect(second).not.toBe(first)
    expect(getPlatformQueue).toHaveBeenCalledTimes(2)
  })

  it('does nothing when closing a queue that was never created', async () => {
    await expect(closeQueue()).resolves.toBeUndefined()
    expect(getPlatformQueue).not.toHaveBeenCalled()
  })
})
