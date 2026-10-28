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

import type { S3 } from '@aws-sdk/client-s3'
import { MeasureMetricsContext } from '@hcengineering/core'
import { createBucket } from './bucket'

describe('S3 bucket initialization', () => {
  const interval = 30_000
  let ctx: MeasureMetricsContext
  let client: {
    headBucket: jest.Mock
    createBucket: jest.Mock
    putObject: jest.Mock
    headObject: jest.Mock
  }

  beforeEach(() => {
    jest.useFakeTimers()
    ctx = new MeasureMetricsContext('s3-test', {})
    jest.spyOn(ctx, 'newChild').mockReturnValue(ctx)
    client = {
      headBucket: jest.fn().mockResolvedValue({}),
      createBucket: jest.fn().mockResolvedValue({}),
      putObject: jest.fn().mockResolvedValue({}),
      headObject: jest.fn().mockResolvedValue({})
    }
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  const initialize = async (): ReturnType<typeof createBucket> =>
    await createBucket(ctx, client as unknown as S3, 'blobs', interval)

  it('waits for the canary write before starting monitoring or resolving', async () => {
    const gauge = jest.spyOn(ctx, 'gauge')
    let completeCanary: () => void = () => {}
    client.putObject.mockReturnValueOnce(
      new Promise((resolve) => {
        completeCanary = () => {
          resolve({})
        }
      })
    )
    let started = false
    const initialization = initialize().then((bucket) => {
      started = true
      return bucket
    })

    await jest.advanceTimersByTimeAsync(0)
    expect(client.putObject).toHaveBeenCalledWith({ Bucket: 'blobs', Key: 'datalake-canary', Body: '' })
    expect(started).toBe(false)
    expect(client.headObject).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)

    completeCanary()
    const bucket = await initialization
    expect(started).toBe(true)
    expect(client.headObject).toHaveBeenCalledTimes(1)
    expect(gauge).toHaveBeenCalledWith('datalake.s3.available', 1)

    await jest.advanceTimersByTimeAsync(interval)
    expect(client.headObject).toHaveBeenCalledTimes(2)
    expect(client.putObject).toHaveBeenCalledTimes(1)
    bucket.close()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('rejects a failed canary write without starting monitoring', async () => {
    const error = new Error('Access denied')
    client.putObject.mockRejectedValueOnce(error)

    await expect(initialize()).rejects.toBe(error)
    expect(client.headObject).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('propagates bucket errors without adding retries around the SDK', async () => {
    const error = new Error('Storage unavailable')
    client.headBucket.mockRejectedValue(error)

    await expect(initialize()).rejects.toBe(error)
    expect(client.headBucket).toHaveBeenCalledTimes(1)
    expect(client.putObject).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('creates a missing bucket before writing the canary', async () => {
    client.headBucket.mockRejectedValueOnce(Object.assign(new Error('Not found'), { name: 'NotFound' }))
    client.putObject.mockImplementationOnce(async () => {
      expect(client.createBucket).toHaveBeenCalledWith({ Bucket: 'blobs' })
      return {}
    })

    const bucket = await initialize()
    expect(client.putObject).toHaveBeenCalledTimes(1)
    bucket.close()
  })

  it('rejects bucket creation failure before writing the canary', async () => {
    const error = new Error('Cannot create bucket')
    client.headBucket.mockRejectedValueOnce(Object.assign(new Error('Not found'), { name: 'NotFound' }))
    client.createBucket.mockRejectedValueOnce(error)

    await expect(initialize()).rejects.toBe(error)
    expect(client.putObject).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })
})
