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

import * as clock from '../context-utils'
import { MeasureMetricsContext, noParamsLogger } from '../context'
import { createMeasureContextProxy } from '../context-proxy'

describe('createMeasureContextProxy', () => {
  let now = 0

  beforeEach(() => {
    now = 0
    jest.spyOn(clock, 'platformNow').mockImplementation(() => now)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('keeps sequential request timings separate while accumulating global metrics', async () => {
    const global = new MeasureMetricsContext('global', {})
    const request = async (duration: number): Promise<number> => {
      const local = new MeasureMetricsContext('request', {})
      await createMeasureContextProxy(global, local).with('getBlob', {}, async (ctx) => {
        await ctx.with('db.getBlob', {}, () => {
          now += duration
        })
      })
      return local.metrics.measurements.getBlob.measurements['db.getBlob'].value
    }

    expect(await request(10)).toBe(10)
    expect(await request(20)).toBe(20)
    const db = global.metrics.measurements.getBlob.measurements['db.getBlob']
    expect(db.value).toBe(30)
    expect(db.operations).toBe(2)
  })

  it('isolates overlapping requests using the same operation names', async () => {
    const global = new MeasureMetricsContext('global', {})
    const first = new MeasureMetricsContext('first', {})
    const second = new MeasureMetricsContext('second', {})
    let finishFirst = (): void => {}
    let finishSecond = (): void => {}
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    const secondGate = new Promise<void>((resolve) => {
      finishSecond = resolve
    })
    const firstRequest = createMeasureContextProxy(global, first).with('getBlob', {}, async (ctx) => {
      await ctx.with('db.getBlob', {}, async () => {
        await firstGate
      })
    })
    const secondRequest = createMeasureContextProxy(global, second).with('getBlob', {}, async (ctx) => {
      await ctx.with('db.getBlob', {}, async () => {
        await secondGate
      })
    })

    now = 10
    finishFirst()
    await firstRequest
    now = 30
    finishSecond()
    await secondRequest

    expect(first.metrics.measurements.getBlob.measurements['db.getBlob'].value).toBe(10)
    expect(second.metrics.measurements.getBlob.measurements['db.getBlob'].value).toBe(30)
    expect(global.metrics.measurements.getBlob.measurements['db.getBlob'].value).toBe(40)
  })

  it('runs the operation once across three contexts and preserves nested proxies', async () => {
    const contexts = [
      new MeasureMetricsContext('first', {}),
      new MeasureMetricsContext('second', {}),
      new MeasureMetricsContext('third', {})
    ]
    const proxy = createMeasureContextProxy(contexts[0], ...contexts.slice(1))
    const operation = jest.fn(() => {
      now += 5
      return 42
    })
    const result = await proxy.with('outer', { source: 'test' }, async (outer) => {
      expect(outer.parent).toBe(proxy)
      return outer.withSync('inner', {}, (inner) => {
        expect(inner.parent).toBe(outer)
        const leaf = inner.newChild('leaf', {})
        expect(leaf.parent).toBe(inner)
        try {
          return operation()
        } finally {
          leaf.end()
        }
      })
    })

    expect(result).toBe(42)
    expect(operation).toHaveBeenCalledTimes(1)
    for (const ctx of contexts) {
      const outer = ctx.metrics.measurements.outer
      expect(outer.operations).toBe(1)
      expect(outer.value).toBe(5)
      expect(outer.measurements.inner.value).toBe(5)
      expect(outer.measurements.inner.measurements.leaf.value).toBe(5)
    }
  })

  it('closes every measurement when an async operation rejects', async () => {
    const first = new MeasureMetricsContext('first', {})
    const second = new MeasureMetricsContext('second', {})
    const error = new Error('operation failed')
    const operation = jest.fn(async () => {
      now += 7
      throw error
    })

    await expect(createMeasureContextProxy(first, second).with('failing', {}, operation)).rejects.toBe(error)

    expect(operation).toHaveBeenCalledTimes(1)
    for (const ctx of [first, second]) {
      expect(ctx.metrics.measurements.failing.operations).toBe(1)
      expect(ctx.metrics.measurements.failing.value).toBe(7)
    }
  })

  it('closes every measurement when a synchronous operation throws', () => {
    const first = new MeasureMetricsContext('first', {})
    const second = new MeasureMetricsContext('second', {})
    const error = new Error('operation failed')
    const operation = jest.fn(() => {
      now += 3
      throw error
    })

    expect(() => createMeasureContextProxy(first, second).withSync('failing', {}, operation)).toThrow(error)

    expect(operation).toHaveBeenCalledTimes(1)
    for (const ctx of [first, second]) {
      expect(ctx.metrics.measurements.failing.operations).toBe(1)
      expect(ctx.metrics.measurements.failing.value).toBe(3)
    }
  })

  it('delegates counters, gauges and explicit completion to every context', () => {
    const first = new MeasureMetricsContext('first', {})
    const second = new MeasureMetricsContext('second', {})
    const proxy = createMeasureContextProxy(first, second)
    const firstEnd = jest.spyOn(first, 'end')
    const secondEnd = jest.spyOn(second, 'end')

    proxy.counter('bytes', 100)
    proxy.counter('bytes', 50)
    proxy.gauge('active', 2)
    now = 12
    proxy.end(12)

    expect(firstEnd).toHaveBeenCalledWith(12)
    expect(secondEnd).toHaveBeenCalledWith(12)
    for (const ctx of [first, second]) {
      expect(ctx.metrics.measurements['#bytes'].value).toBe(150)
      expect(ctx.metrics.measurements['#active'].operations).toBe(2)
      expect(ctx.metrics.value).toBe(12)
      expect(ctx.metrics.operations).toBe(1)
    }
  })

  it('uses the primary context for logs and metadata without duplicating operation logs', async () => {
    const first = new MeasureMetricsContext('first', { source: 'primary' })
    const second = new MeasureMetricsContext('second', {})
    const proxy = createMeasureContextProxy(first, second)
    const primaryInfo = jest.spyOn(first, 'info').mockImplementation()
    const secondaryInfo = jest.spyOn(second, 'info').mockImplementation()
    const logOperation = jest.spyOn(noParamsLogger, 'logOperation')
    const meta = { traceparent: 'primary' }
    const extractMeta = jest.spyOn(first, 'extractMeta').mockImplementation(function (this: MeasureMetricsContext) {
      expect(this).toBe(first)
      return meta
    })

    proxy.info('message')
    await proxy.with('operation', {}, async () => {}, undefined, { log: true })

    expect(primaryInfo).toHaveBeenCalledTimes(1)
    expect(secondaryInfo).not.toHaveBeenCalled()
    expect(logOperation).toHaveBeenCalledTimes(1)
    expect(proxy.extractMeta()).toBe(meta)
    expect(extractMeta).toHaveBeenCalledTimes(1)
    expect(proxy.getParams()).toEqual({ source: 'primary' })
    expect(proxy.metrics).toBe(first.metrics)
  })

  it('propagates shared context data and ids to every child context', () => {
    const first = new MeasureMetricsContext('first', {})
    const second = new MeasureMetricsContext('second', {})
    const proxy = createMeasureContextProxy(first, second)
    const data = { request: 'request-id' }
    proxy.contextData = data
    proxy.id = 'request-id'
    const child = proxy.newChild('child', {})

    for (const ctx of [first, second]) {
      expect(ctx.contextData).toBe(data)
      expect(ctx.id).toBe('request-id')
    }
    expect(child.contextData).toBe(data)
    expect(child.id).toBe('request-id')
  })

  it('supports a single context', async () => {
    const ctx = new MeasureMetricsContext('single', {})
    const operation = jest.fn(() => 'result')

    expect(await createMeasureContextProxy(ctx).with('operation', {}, operation)).toBe('result')
    expect(operation).toHaveBeenCalledTimes(1)
    expect(ctx.metrics.measurements.operation.operations).toBe(1)
  })
})
