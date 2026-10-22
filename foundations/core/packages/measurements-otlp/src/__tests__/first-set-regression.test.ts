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

import {
  MeasureMetricsContext,
  newMetrics,
  EMPTY_PARAMS,
  type MeasureContext,
  type MeasureLogger
} from '@hcengineering/measurements'
import { trace } from '@opentelemetry/api'
import { OpenTelemetryMetricsContext } from '../telemetry'

const contexts = [
  {
    name: 'base',
    create: (logger?: MeasureLogger): MeasureContext => new MeasureMetricsContext('test', {}, {}, newMetrics(), logger)
  },
  {
    name: 'OTLP',
    create: (logger?: MeasureLogger): MeasureContext =>
      new OpenTelemetryMetricsContext(
        'test',
        trace.getTracer('regression'),
        undefined,
        undefined,
        {},
        {},
        newMetrics(),
        logger
      )
  }
]

describe.each(contexts)('$name correctness regressions', ({ create }) => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it.each([0, -2, 42])('records explicit end value %i instead of elapsed time', (value) => {
    const root = create()
    const child = root.newChild('request', { method: 'GET' }, { span: false })
    jest.advanceTimersByTime(5)
    child.end(value)
    expect(child.metrics?.value).toBe(value)
    expect(child.metrics?.params.method.GET).toMatchObject({ operations: 1, value })
  })

  it('shares immutable empty full parameters across operations', () => {
    const root = create()
    for (const name of ['first', 'second']) {
      const child = root.newChild(name, {}, { span: false })
      jest.advanceTimersByTime(1)
      child.end()
      expect(child.metrics?.topResult?.[0].params).toBe(EMPTY_PARAMS)
    }
    expect(Object.isFrozen(EMPTY_PARAMS)).toBe(true)
    expect(EMPTY_PARAMS).toEqual({})
  })

  it('keeps equal named parameters and marks mixed values permanently', () => {
    const root = create()
    for (const method of ['GET', 'GET', 'GET']) {
      root.newChild('request', { method }, { span: false })
      expect(root.metrics?.measurements.request.namedParams.method).toBe('GET')
    }
    for (const method of ['POST', 'GET', 'POST']) {
      root.newChild('request', { method }, { span: false })
      expect(root.metrics?.measurements.request.namedParams.method).toBe('*')
    }
    const params = root.newChild('undefined', { value: undefined }, { span: false }).metrics?.namedParams
    expect(params).toEqual({ value: undefined })
    expect(Object.prototype.hasOwnProperty.call(params, 'value')).toBe(true)
  })

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'records the reserved named parameter %s',
    (name) => {
      const root = create()
      const child = root.newChild(name, { [name]: name }, { span: false })
      child.end(7)
      expect(child.metrics?.namedParams[name]).toBe(name)
      expect(child.metrics?.params[name][name]).toMatchObject({ operations: 1, value: 7 })
      expect(Object.prototype.hasOwnProperty.call(child.metrics?.namedParams, name)).toBe(true)
    }
  )

  it.each([false, true])(
    'resolves full parameters once per operation with span=%s for metrics and logging',
    async (span) => {
      const root = create()
      const logOperation = jest.fn()
      root.logger = { ...root.logger, logOperation }
      let calls = 0
      const factory = jest.fn(() => ({ detail: 'payload', ordinal: ++calls }))
      for (const ordinal of [1, 2]) {
        await root.with(
          'request',
          {},
          async () => {
            jest.advanceTimersByTime(5)
          },
          factory,
          { span, log: true }
        )
        expect(factory).toHaveBeenCalledTimes(ordinal)
        expect(logOperation).toHaveBeenLastCalledWith('request', 5, { detail: 'payload', ordinal })
        expect(root.metrics?.measurements.request.topResult?.[ordinal - 1].params).toEqual({
          detail: 'payload',
          ordinal
        })
      }
    }
  )

  it('preserves the original rejection and logs resolved full parameters once', async () => {
    const root = create()
    const logOperation = jest.fn()
    root.logger = { ...root.logger, logOperation }
    const failure = new Error('operation failed')
    const factory = jest.fn(() => ({ failed: true }))
    await expect(
      root.with(
        'request',
        {},
        async () => {
          jest.advanceTimersByTime(3)
          throw failure
        },
        factory,
        { span: true, log: true }
      )
    ).rejects.toBe(failure)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(logOperation).toHaveBeenCalledWith('request', 3, { failed: true })
    expect(root.metrics?.measurements.request.operations).toBe(1)
  })

  it('resolves full parameters after the callback without including their computation in elapsed time', () => {
    const root = create()
    const factory = jest.fn(() => {
      jest.advanceTimersByTime(100)
      return { detail: 'payload' }
    })
    root.withSync(
      'request',
      {},
      () => {
        expect(factory).not.toHaveBeenCalled()
        jest.advanceTimersByTime(5)
      },
      factory,
      { span: false }
    )
    expect(factory).toHaveBeenCalledTimes(1)
    expect(root.metrics?.measurements.request.value).toBe(5)
    expect(root.metrics?.measurements.request.topResult?.[0].params).toEqual({ detail: 'payload' })
  })
})

it('uses the same resolved full parameters for span attributes, statistics and logs', async () => {
  const tracer = trace.getTracer('attribute-regression')
  const span = tracer.startSpan('template')
  const start = jest.spyOn(tracer, 'startSpan').mockReturnValue(span)
  const attribute = jest.spyOn(span, 'setAttribute')
  const root = new OpenTelemetryMetricsContext('test', tracer, undefined, undefined, {})
  const logOperation = jest.fn()
  root.logger = { ...root.logger, logOperation }
  const factory = jest.fn(() => ({ detail: 'payload' }))
  try {
    await root.with('request', { method: 'GET' }, async () => 42, factory, { log: true })
    expect(factory).toHaveBeenCalledTimes(1)
    expect(attribute).toHaveBeenCalledWith('detail', 'payload')
    expect(root.metrics.measurements.request.topResult?.[0].params).toEqual({ detail: 'payload' })
    expect(logOperation).toHaveBeenCalledWith('request', expect.any(Number), { method: 'GET', detail: 'payload' })
  } finally {
    attribute.mockRestore()
    start.mockRestore()
  }
})

it('records gauges for every attribute set and repeated collection interval', () => {
  const record = jest.fn()
  const instrument = { record }
  const instruments = { getGauge: () => instrument }
  const make = (worker: string): OpenTelemetryMetricsContext =>
    new OpenTelemetryMetricsContext(
      'test',
      trace.getTracer('regression'),
      undefined,
      undefined,
      { worker },
      {},
      newMetrics(),
      undefined,
      undefined,
      undefined,
      undefined,
      instruments as unknown as NonNullable<ConstructorParameters<typeof OpenTelemetryMetricsContext>[11]>
    )
  const first = make('A')
  const second = make('B')
  first.gauge('jobs', 5)
  second.gauge('jobs', 5)
  first.gauge('jobs', 5)
  expect(record.mock.calls).toEqual([
    [5, { worker: 'A' }],
    [5, { worker: 'B' }],
    [5, { worker: 'A' }]
  ])
})

it.each([
  [false, false, false],
  [false, false, true],
  [false, true, false],
  [false, true, true],
  [true, false, false],
  [true, false, true],
  [true, true, false],
  [true, true, true]
])('does not modify an ended span with async=%s failed=%s log=%s', async (asynchronous, failed, log) => {
  const tracer = trace.getTracer('early-end-regression')
  const span = tracer.startSpan('template')
  const start = jest.spyOn(tracer, 'startSpan').mockReturnValue(span)
  const attribute = jest.spyOn(span, 'setAttribute')
  const exception = jest.spyOn(span, 'recordException')
  const status = jest.spyOn(span, 'setStatus')
  const end = jest.spyOn(span, 'end')
  const root = new OpenTelemetryMetricsContext('test', tracer, undefined, undefined, {})
  const logOperation = jest.fn()
  root.logger = { ...root.logger, logOperation }
  const factory = jest.fn(() => ({ detail: 'payload' }))
  const failure = new Error('failed after end')
  const operation = (ctx: MeasureContext): number => {
    ctx.end(7)
    attribute.mockClear()
    if (failed) throw failure
    return 42
  }
  const invoke = (): Promise<number> =>
    root.with('request', { method: 'GET' }, asynchronous ? async (ctx) => operation(ctx) : operation, factory, {
      span: true,
      log
    })
  try {
    if (failed && !asynchronous) {
      expect(invoke).toThrow(failure)
    } else if (failed) {
      await expect(invoke()).rejects.toBe(failure)
    } else {
      await expect(invoke()).resolves.toBe(42)
    }
    expect(attribute).not.toHaveBeenCalled()
    expect(exception).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
    expect(end).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(root.metrics.measurements.request).toMatchObject({ operations: 1, value: 7 })
    if (log) {
      expect(logOperation).toHaveBeenCalledTimes(1)
      expect(logOperation).toHaveBeenCalledWith('request', expect.any(Number), { method: 'GET', detail: 'payload' })
    } else {
      expect(logOperation).not.toHaveBeenCalled()
    }
  } finally {
    end.mockRestore()
    status.mockRestore()
    exception.mockRestore()
    attribute.mockRestore()
    start.mockRestore()
  }
})
