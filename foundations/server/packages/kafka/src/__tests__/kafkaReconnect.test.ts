//
// Copyright © TraceX SAS 2026
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

let connectCallCount = 0
let consumerConnectCallCount = 0

const producerConnectMock = jest.fn(async () => {
  connectCallCount++
  if (connectCallCount === 1) {
    throw new Error('broker not ready yet')
  }
})
const producerSendMock = jest.fn(async () => {})
const producerDisconnectMock = jest.fn(async () => {})

const consumerConnectMock = jest.fn(async () => {
  consumerConnectCallCount++
  if (consumerConnectCallCount === 1) {
    throw new Error('broker not ready yet')
  }
})
const consumerSubscribeMock = jest.fn(async () => {})
const consumerRunMock = jest.fn(async () => {})
const consumerOnMock = jest.fn()
const consumerDisconnectMock = jest.fn(async () => {})

jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: () => ({
      connect: producerConnectMock,
      send: producerSendMock,
      disconnect: producerDisconnectMock
    }),
    consumer: () => ({
      connect: consumerConnectMock,
      subscribe: consumerSubscribeMock,
      run: consumerRunMock,
      on: consumerOnMock,
      disconnect: consumerDisconnectMock
    })
  })),
  Partitioners: { DefaultPartitioner: 'default' },
  CompressionTypes: { GZIP: 1 }
}))

/* eslint-disable @typescript-eslint/no-var-requires */
const { createPlatformQueue } = require('../index')

function fakeCtx (): any {
  const ctx: any = {
    with: async (_name: string, _params: any, op: (c: any) => any) => op(ctx),
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    extractMeta: () => ({}),
    newChild: () => fakeCtx()
  }
  return ctx
}

async function waitFor (pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('PlatformQueueProducerImpl reconnect', () => {
  beforeEach(() => {
    connectCallCount = 0
    producerConnectMock.mockClear()
    producerSendMock.mockClear()
  })

  it('recovers from a failed initial connect instead of wedging forever', async () => {
    const queue = createPlatformQueue({ postfix: '', brokers: ['broker:9092'], clientId: 'test', region: '' })
    const ctx = fakeCtx()
    const producer = queue.getProducer(ctx, 'test-topic')

    for (let i = 0; i < 5 && producerSendMock.mock.calls.length === 0; i++) {
      try {
        await producer.send(ctx, 'ws-1' as any, [{ hello: 'world' }])
      } catch {}
    }

    expect(producerSendMock).toHaveBeenCalledTimes(1)
    expect(connectCallCount).toBeGreaterThanOrEqual(2)

    const countAfterFirstSuccess = connectCallCount
    await producer.send(ctx, 'ws-1' as any, [{ hello: 'again' }])
    expect(connectCallCount).toBe(countAfterFirstSuccess)
    expect(producerSendMock).toHaveBeenCalledTimes(2)
  })
})

describe('PlatformQueueConsumerImpl reconnect', () => {
  beforeEach(() => {
    consumerConnectCallCount = 0
    consumerConnectMock.mockClear()
    consumerSubscribeMock.mockClear()
    consumerRunMock.mockClear()
  })

  it('retries connect/subscribe/run after a failed initial connect', async () => {
    const queue = createPlatformQueue({ postfix: '', brokers: ['broker:9092'], clientId: 'test', region: '' })
    const ctx = fakeCtx()

    queue.createConsumer(ctx, 'test-topic', 'group-1', async () => {}, { retryDelay: 5, maxRetryDelay: 2 })

    await waitFor(() => consumerRunMock.mock.calls.length > 0)

    expect(consumerConnectCallCount).toBeGreaterThanOrEqual(2)
    expect(consumerSubscribeMock).toHaveBeenCalledTimes(1)
    expect(consumerRunMock).toHaveBeenCalledTimes(1)
  })
})
