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

import { MeasureMetricsContext, NoMetricsContext, noParamsLogger } from '../context'
import { createMeasureContextProxy } from '../context-proxy'
import { metricsAggregate, metricsToJson } from '../metrics'
import type { MeasureContext } from '../types'

describe('withCounter', () => {
  it('balances overlapping operations immediately and counts success separately from failure', async () => {
    const ctx = new MeasureMetricsContext('root', {})
    let finish = (): void => {}
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    const attributes = { domain: 'task' }
    const first = ctx.withCounter('operation', attributes, async () => {
      await gate
    })
    const failure = new Error('failed')
    const second = ctx.withCounter('operation', attributes, async () => {
      throw failure
    })

    expect(ctx.metrics.measurements['#operation'].value).toBe(2)
    expect(ctx.metrics.measurements['#operation-active'].value).toBe(2)
    await expect(second).rejects.toBe(failure)
    expect(ctx.metrics.measurements['#operation-active'].value).toBe(1)
    expect(ctx.metrics.measurements['#operation-failed'].value).toBe(1)
    expect(ctx.metrics.measurements['#operation-completed']).toBeUndefined()

    finish()
    await first
    expect(ctx.metrics.measurements['#operation-active'].value).toBe(0)
    expect(ctx.metrics.measurements['#operation-completed'].value).toBe(1)
  })

  it('preserves synchronous exceptions and rejected thenables', async () => {
    const ctx = new MeasureMetricsContext('root', {})
    const failure = new Error('sync')
    expect(() =>
      ctx.withCounter('operation', {}, () => {
        throw failure
      })
    ).toThrow(failure)
    await expect(
      ctx.withCounter(
        'operation',
        {},
        () =>
          ({
            then: (_resolve: unknown, reject: (error: Error) => void) => {
              reject(failure)
            }
          }) as unknown as PromiseLike<void>
      )
    ).rejects.toBe(failure)
    expect(ctx.metrics.measurements['#operation-active'].value).toBe(0)
    expect(ctx.metrics.measurements['#operation-failed'].value).toBe(2)
  })

  it('preserves with return behavior for synchronous and asynchronous results', async () => {
    const ctx = new MeasureMetricsContext('root', {})
    for (const value of [null, undefined, false, 0, 'value', { result: true }]) {
      expect(await ctx.withCounter('counted', {}, () => value)).toBe(await ctx.with('plain', {}, () => value))
      expect(await ctx.withCounter('counted', {}, async () => value)).toBe(
        await ctx.with('plain', {}, async () => value)
      )
    }
  })

  it('keeps counters active after early end and freezes metric dimensions at entry', async () => {
    const ctx = new MeasureMetricsContext('root', { workspace: 'trace-only' })
    const attributes = { domain: 'original' }
    let finish = (): void => {}
    const gate = new Promise<void>((resolve) => {
      finish = resolve
    })
    const result = ctx.withCounter(
      'operation',
      attributes,
      async (child) => {
        child.end()
        attributes.domain = 'changed'
        await gate
      },
      undefined,
      { inheritParams: true }
    )
    expect(ctx.metrics.measurements['#operation-active'].value).toBe(1)
    finish()
    await result
    for (const name of ['operation', 'operation-active', 'operation-completed']) {
      const points = Object.values(ctx.metrics.measurements['#' + name].series ?? {})
      expect(points).toHaveLength(1)
      expect(points[0].attributes).toEqual({ domain: 'original' })
    }
    expect(ctx.metrics.measurements['#operation-active'].value).toBe(0)
  })

  it('preserves inherited parameters, context data, fullParams and operation logs', async () => {
    const log = { ...noParamsLogger, logOperation: jest.fn() }
    const ctx = new MeasureMetricsContext('root', { parent: true }, undefined, undefined, log)
    ctx.id = 'request'
    ctx.contextData = { shared: true }
    const fullParams = jest.fn(() => ({ detail: 'diagnostic' }))
    const result = await ctx.withCounter(
      'operation',
      { domain: 'task' },
      (child) => {
        expect(child.parent).toBe(ctx)
        expect(child.id).toBe('request')
        expect(child.contextData).toBe(ctx.contextData)
        expect(child.getParams()).toEqual({ parent: true, domain: 'task' })
        return 42
      },
      fullParams,
      { inheritParams: true, log: true }
    )
    expect(result).toBe(42)
    expect(fullParams).toHaveBeenCalledTimes(1)
    expect(log.logOperation).toHaveBeenCalledWith('operation', expect.any(Number), {
      parent: true,
      domain: 'task',
      detail: 'diagnostic'
    })
  })

  it('does not replace business results or errors when metric recording fails', async () => {
    const ctx = new MeasureMetricsContext('root', {})
    const diagnostic = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(ctx, 'counter').mockImplementation(() => {
      throw new Error('metric failure')
    })
    try {
      expect(await ctx.withCounter('operation', {}, () => 42)).toBe(42)
      const failure = new Error('business failure')
      await expect(
        ctx.withCounter('operation', {}, async () => {
          throw failure
        })
      ).rejects.toBe(failure)
      expect(ctx.metrics.measurements['#operation-active'].value).toBe(0)
    } finally {
      diagnostic.mockRestore()
    }
  })

  it('runs work once through a proxy and records in every backend', async () => {
    const first = new MeasureMetricsContext('first', {})
    const second = new MeasureMetricsContext('second', {})
    const proxy = createMeasureContextProxy(first, second, new NoMetricsContext())
    const operation = jest.fn((child: MeasureContext) => {
      expect(child.parent).toBe(proxy)
      return 7
    })
    expect(await proxy.withCounter('operation', { domain: 'task' }, operation)).toBe(7)
    expect(operation).toHaveBeenCalledTimes(1)
    for (const ctx of [first, second]) {
      expect(ctx.metrics.measurements['#operation'].value).toBe(1)
      expect(ctx.metrics.measurements['#operation-active'].value).toBe(0)
      expect(ctx.metrics.measurements['#operation-completed'].value).toBe(1)
    }
  })

  it('preserves complete dimension combinations and independent gauge readings in local snapshots', () => {
    const first = new MeasureMetricsContext('first', {})
    const second = new MeasureMetricsContext('second', {})
    const ctx = createMeasureContextProxy(first, second)
    ctx.gauge('sessions', 5, { kind: 'system', service: 'process' })
    ctx.gauge('sessions', 2, { service: 'fulltext', kind: 'system' })
    ctx.gauge('sessions', 3, { service: 'process', kind: 'system' })
    ctx.gauge('sessions', 0, { service: 'fulltext', kind: 'system' })
    ctx.counter('requests', 1, { domain: 'task', operation: 'find' })
    ctx.counter('requests', 2, { domain: 'task', operation: 'tx' })
    for (const backend of [first, second]) {
      const metrics = metricsAggregate(backend.metrics)
      expect(metrics.measurements['#sessions'].operations).toBe(3)
      expect(Object.values(metrics.measurements['#sessions'].series ?? {})).toEqual([
        { attributes: { kind: 'system', service: 'process' }, operations: 3, value: 0 },
        { attributes: { kind: 'system', service: 'fulltext' }, operations: 0, value: 0 }
      ])
      expect(Object.values(metrics.measurements['#requests'].series ?? {}).map((point) => point.value)).toEqual([1, 2])
      expect(metricsToJson(metrics.measurements['#sessions']).series).toEqual(metrics.measurements['#sessions'].series)
    }
  })

  it('reads caller-owned dimensions again when their object is reused and changed', () => {
    const ctx = new MeasureMetricsContext('root', {})
    const attributes = { domain: 'task' }
    ctx.counter('requests', 1, attributes)
    ctx.gauge('sessions', 3, attributes)
    attributes.domain = 'note'
    ctx.counter('requests', 2, attributes)
    ctx.gauge('sessions', 5, attributes)
    expect(Object.values(ctx.metrics.measurements['#requests'].series ?? {})).toEqual([
      { attributes: { domain: 'task' }, operations: 1, value: 1 },
      { attributes: { domain: 'note' }, operations: 1, value: 2 }
    ])
    expect(ctx.metrics.measurements['#sessions'].operations).toBe(8)
  })

  it('keeps stored metric attributes independent of later lifecycle records', async () => {
    const ctx = new MeasureMetricsContext('root', {})
    await ctx.withCounter('operation', { domain: 'task', omitted: undefined }, async () => {
      const recorded = Object.values(ctx.metrics.measurements['#operation'].series ?? {})[0]
      recorded.attributes.domain = 'edited-diagnostic-data'
    })
    for (const name of ['operation-active', 'operation-completed']) {
      const points = Object.values(ctx.metrics.measurements['#' + name].series ?? {})
      expect(points).toHaveLength(1)
      expect(points[0].attributes).toEqual({ domain: 'task' })
    }
    expect(ctx.metrics.measurements['#operation-active'].value).toBe(0)
  })
})
