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

import type { PlatformQueue, PlatformQueueProducer } from '@hcengineering/server-core'
import type { TimeMachineMessage } from '@hcengineering/server-process'
import { getPlatformQueue } from '@hcengineering/kafka'
import { configureTimerProducer } from '../main'
import { closeClients } from '../utils'

jest.mock('@hcengineering/analytics', () => ({ Analytics: { setTag: jest.fn() } }))
jest.mock('@hcengineering/analytics-service', () => ({ configureAnalytics: jest.fn() }))
jest.mock('@hcengineering/core', () => ({}))
jest.mock('@hcengineering/platform', () => ({ setMetadata: jest.fn() }))
jest.mock('@hcengineering/server-token', () => ({
  __esModule: true,
  default: { metadata: { Secret: 'secret', Service: 'service' } }
}))
jest.mock('@hcengineering/server-core', () => ({
  initStatisticsContext: jest.fn(() => ({ error: jest.fn() })),
  QueueTopic: { TimeMachine: 'time-machine', Process: 'process' }
}))
jest.mock('@hcengineering/kafka', () => ({ getPlatformQueue: jest.fn() }))
jest.mock('../main', () => ({ configureTimerProducer: jest.fn(), messageHandler: jest.fn() }))
jest.mock('../init', () => ({ prepare: jest.fn() }))
jest.mock('../utils', () => ({
  configureClients: jest.fn(),
  closeClients: jest.fn(),
  SERVICE_NAME: 'process-service'
}))
jest.mock('../config', () => ({ __esModule: true, default: { Secret: 'secret', QueueRegion: 'region' } }))

const producer: PlatformQueueProducer<TimeMachineMessage> = {
  send: jest.fn(),
  close: jest.fn(),
  getQueue: jest.fn()
}
const consumer = { close: jest.fn(), isConnected: jest.fn() }
const queue = {
  getProducer: jest.fn(() => producer),
  createConsumer: jest.fn(() => consumer),
  getClientId: () => 'process-service'
}
let shutdown: (() => void) | undefined
let exit: jest.SpiedFunction<typeof process.exit>

beforeEach(() => {
  jest.clearAllMocks()
  shutdown = undefined
  jest.spyOn(process, 'once').mockImplementation((event, listener) => {
    if (event === 'SIGTERM') shutdown = () => { listener(); }
    return process
  })
  jest.spyOn(process, 'on').mockReturnValue(process)
  exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  jest.mocked(getPlatformQueue).mockReturnValue(queue as unknown as PlatformQueue)
  jest.mocked(producer.close).mockReset().mockResolvedValue(undefined)
  consumer.close.mockReset().mockResolvedValue(undefined)
  jest.mocked(closeClients).mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

async function start (): Promise<void> {
  await jest.isolateModulesAsync(async () => {
    await import('../index')
  })
}

async function flush (): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

it('shares the service queue producer and closes it only after the consumer has stopped', async () => {
  let stopConsumer: (() => void) | undefined
  consumer.close.mockReturnValue(
    new Promise<void>((resolve) => {
      stopConsumer = resolve
    })
  )
  await start()
  expect(getPlatformQueue).toHaveBeenCalledTimes(1)
  expect(queue.getProducer).toHaveBeenCalledWith(expect.any(Object), 'time-machine')
  expect(configureTimerProducer).toHaveBeenCalledWith(producer)
  expect(shutdown).toBeDefined()
  shutdown?.()
  await flush()
  expect(producer.close).not.toHaveBeenCalled()
  expect(closeClients).not.toHaveBeenCalled()
  stopConsumer?.()
  await flush()
  expect(producer.close).toHaveBeenCalledTimes(1)
  expect(closeClients).toHaveBeenCalledTimes(1)
  expect(exit).toHaveBeenCalledWith()
})

it('closes workspace clients and exits with failure when the producer cannot close', async () => {
  jest.mocked(producer.close).mockRejectedValue(new Error('producer close failed'))
  await start()
  shutdown?.()
  await flush()
  expect(closeClients).toHaveBeenCalledTimes(1)
  expect(exit).toHaveBeenCalledWith(1)
})
