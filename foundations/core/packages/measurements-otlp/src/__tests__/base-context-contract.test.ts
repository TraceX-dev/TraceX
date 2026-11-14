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
  NoMetricsContext,
  newMetrics,
  noParamsLogger,
  type MeasureContext,
  type MeasureLogger,
  type ParamsType,
  type WithOptions
} from '@hcengineering/measurements'
import { context, trace, SpanStatusCode } from '@opentelemetry/api'
import { InMemorySpanExporter, SimpleSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { OpenTelemetryMetricsContext } from '../telemetry'

const exporter = new InMemorySpanExporter()
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
const tracer = provider.getTracer('base-contract')

beforeAll(() => {
  provider.register()
})
afterAll(async () => {
  await provider.shutdown()
  context.disable()
  trace.disable()
})
beforeEach(() => {
  exporter.reset()
})

function logger (): MeasureLogger {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    logOperation: jest.fn(),
    close: async () => {}
  }
}

const implementations = [
  {
    name: 'core',
    create: (log: MeasureLogger, params: ParamsType = {}): MeasureContext =>
      new MeasureMetricsContext(
        'root',
        params,
        undefined,
        newMetrics(),
        log,
        undefined,
        { collision: 'log', shared: true },
        'debug'
      )
  },
  {
    name: 'OTel',
    create: (log: MeasureLogger, params: ParamsType = {}): MeasureContext =>
      new OpenTelemetryMetricsContext(
        'root',
        tracer,
        undefined,
        undefined,
        params,
        undefined,
        newMetrics(),
        log,
        undefined,
        { collision: 'log', shared: true },
        undefined,
        undefined,
        'debug'
      )
  }
]

type Mode = 'with-sync' | 'with-async' | 'withCounter-sync' | 'withCounter-async' | 'withSync'
function run<T> (
  root: MeasureContext,
  mode: Mode,
  op: (ctx: MeasureContext) => T,
  factory: () => Record<string, string>,
  opt?: WithOptions
): T | Promise<T> {
  return mode === 'withSync'
    ? root.withSync('request', { method: 'GET' }, op, factory, opt)
    : root[mode.startsWith('withCounter') ? 'withCounter' : 'with'](
        'request',
        { method: 'GET' },
        mode.endsWith('-async') ? async (ctx) => op(ctx) : op,
        factory,
        opt
      )
}

const modes: Mode[] = ['with-sync', 'with-async', 'withCounter-sync', 'withCounter-async', 'withSync']

describe.each(implementations)('$name shared context contract', ({ create }) => {
  it.each(modes)('%s inherits params, memoizes full params, and logs once', async (mode) => {
    const log = logger()
    const root = create(log, { tenant: 'A' })
    root.id = 'request-id'
    root.contextData = { shared: true }
    const factory = jest.fn(() => ({ detail: 'payload' }))
    const result = run(
      root,
      mode,
      (child) => {
        expect(child.getParams()).toEqual({ tenant: 'A', method: 'GET' })
        expect(child.parent).toBe(root)
        expect(child.id).toBe(root.id)
        expect(child.contextData).toBe(root.contextData)
        expect(factory).not.toHaveBeenCalled()
        return 42
      },
      factory,
      { inheritParams: true, log: true }
    )
    expect(await result).toBe(42)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(root.metrics?.measurements.request.operations).toBe(1)
    expect(log.logOperation).toHaveBeenCalledTimes(1)
    expect(log.logOperation).toHaveBeenCalledWith('request', expect.any(Number), {
      tenant: 'A',
      method: 'GET',
      detail: 'payload'
    })
  })

  it.each(modes)('%s keeps inheritance and operation logs opt-in', async (mode) => {
    const log = logger()
    const root = create(log, { tenant: 'A' })
    await run(
      root,
      mode,
      (child) => {
        expect(child.getParams()).toEqual({ method: 'GET' })
        return 42
      },
      () => ({})
    )
    expect(log.logOperation).not.toHaveBeenCalled()
  })

  it.each(modes)('%s closes explicit end once and logs after a failure', async (mode) => {
    const log = logger()
    const root = create(log)
    const failure = new Error('after end')
    const factory = jest.fn(() => ({ detail: 'payload' }))
    const invoke = (): unknown =>
      run(
        root,
        mode,
        (child) => {
          child.end(7)
          child.end(99)
          throw failure
        },
        factory,
        { log: true }
      )
    if (mode.endsWith('-async')) await expect(invoke()).rejects.toBe(failure)
    else expect(invoke).toThrow(failure)
    expect(root.metrics?.measurements.request).toMatchObject({ operations: 1, value: 7 })
    expect(factory).toHaveBeenCalledTimes(1)
    expect(log.logOperation).toHaveBeenCalledTimes(1)
  })

  it.each(['with-sync', 'withCounter-sync', 'withSync'] as const)(
    '%s propagates throws synchronously and still finishes and logs',
    (mode) => {
      const log = logger()
      const root = create(log)
      const failure = new Error('sync throw')
      expect(() =>
        run(
          root,
          mode,
          () => {
            throw failure
          },
          () => ({}),
          { log: true }
        )
      ).toThrow(failure)
      expect(root.metrics?.measurements.request.operations).toBe(1)
      expect(log.logOperation).toHaveBeenCalledTimes(1)
    }
  )

  it.each([false, true])('awaits non-Promise thenables with reject=%s before finishing', async (reject) => {
    const log = logger()
    const root = create(log)
    const failure = new Error('thenable rejection')
    const thenable: PromiseLike<number> = {
      then: (onSuccess, onError) => (reject ? Promise.reject(failure) : Promise.resolve(42)).then(onSuccess, onError)
    }
    const result = root.with('request', {}, () => thenable, undefined, { log: true })
    expect(root.metrics?.measurements.request.operations).toBe(0)
    if (reject) await expect(result).rejects.toBe(failure)
    else await expect(result).resolves.toBe(42)
    expect(root.metrics?.measurements.request.operations).toBe(1)
    expect(log.logOperation).toHaveBeenCalledTimes(1)
  })

  it.each(['error', 'info', 'warn', 'debug'] as const)('%s gives message args the highest precedence', (level) => {
    const log = logger()
    const root = create(log, { collision: 'params', tenant: 'A' })
    root[level]('message', { collision: 'args' })
    expect(log[level]).toHaveBeenCalledWith('message', { tenant: 'A', shared: true, collision: 'args' })
  })
})

it.each(modes)('OTel %s executes in its child span context and attaches full params', async (mode) => {
  const root = implementations[1].create(noParamsLogger)
  await run(
    root,
    mode,
    () => {
      expect(trace.getSpan(context.active())?.spanContext().traceId).toBeDefined()
      return 42
    },
    () => ({ detail: 'payload' }),
    { span: true }
  )
  const spans = exporter.getFinishedSpans()
  expect(spans).toHaveLength(1)
  expect(spans[0].attributes).toMatchObject({ method: 'GET', detail: 'payload' })
})

it.each(modes)('OTel %s preserves span:false', async (mode) => {
  const root = implementations[1].create(noParamsLogger)
  await run(
    root,
    mode,
    () => 42,
    () => ({}),
    { span: false }
  )
  expect(exporter.getFinishedSpans()).toHaveLength(0)
})

it.each(modes.flatMap((mode) => [false, true].map((suspendErrors) => ({ mode, suspendErrors }))))(
  'OTel $mode honors suspendErrors=$suspendErrors',
  async ({ mode, suspendErrors }) => {
    const root = implementations[1].create(noParamsLogger)
    const failure = new Error('operation failed')
    const invoke = (): unknown =>
      run(
        root,
        mode,
        () => {
          throw failure
        },
        () => ({}),
        { suspendErrors }
      )
    if (mode.endsWith('-async')) await expect(invoke()).rejects.toBe(failure)
    else expect(invoke).toThrow(failure)
    const spans = exporter.getFinishedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0].events).toHaveLength(suspendErrors ? 0 : 1)
    expect(spans[0].status.code).toBe(suspendErrors ? SpanStatusCode.UNSET : SpanStatusCode.ERROR)
  }
)

it('does not create a span for a direct newChild without span options', () => {
  implementations[1].create(noParamsLogger).newChild('direct', {}).end()
  expect(exporter.getFinishedSpans()).toHaveLength(0)
})

it('NoMetricsContext assimilates thenables in with and withLog and preserves synchronous throws', async () => {
  const root = new NoMetricsContext(noParamsLogger)
  const thenable: PromiseLike<number> = { then: (resolve, reject) => Promise.resolve(42).then(resolve, reject) }
  await expect(root.with('request', {}, () => thenable)).resolves.toBe(42)
  await expect(root.withLog('request', {}, () => thenable)).resolves.toBe(42)
  const failure = new Error('sync throw')
  expect(() =>
    root.with('request', {}, () => {
      throw failure
    })
  ).toThrow(failure)
})

it('preserves the OTel context across await and nested child operations', async () => {
  const root = implementations[1].create(noParamsLogger)
  await root.with('outer', {}, async (child) => {
    const parentSpan = trace.getSpan(context.active())
    expect(parentSpan).toBeDefined()
    await Promise.resolve()
    expect(trace.getSpan(context.active())).toBe(parentSpan)
    await child.with('inner', {}, async () => {
      await Promise.resolve()
      expect(trace.getSpan(context.active())?.spanContext().traceId).toBe(parentSpan?.spanContext().traceId)
      expect(trace.getSpan(context.active())).not.toBe(parentSpan)
    })
    expect(trace.getSpan(context.active())).toBe(parentSpan)
  })
  expect(exporter.getFinishedSpans()).toHaveLength(2)
})

describe.each(implementations)('$name telemetry failure isolation', ({ name, create }) => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it.each(
    modes.flatMap((mode) =>
      [false, true].flatMap((failed) => ['fullParams', 'logOperation'].map((fault) => ({ mode, failed, fault })))
    )
  )('$mode preserves the business outcome with $fault failure, failed=$failed', async ({ mode, failed, fault }) => {
    const log = logger()
    const root = create(log)
    const businessError = new Error('business failure')
    const telemetryError = new Error('telemetry failure')
    const factory = jest.fn(() => {
      if (fault === 'fullParams') throw telemetryError
      return { detail: 'payload' }
    })
    if (fault === 'logOperation') {
      log.logOperation = () => {
        throw telemetryError
      }
    }
    const invoke = (): unknown =>
      run(
        root,
        mode,
        () => {
          jest.advanceTimersByTime(5)
          if (failed) throw businessError
          return 42
        },
        factory,
        { log: true }
      )
    if (failed && !mode.endsWith('-async')) expect(invoke).toThrow(businessError)
    else if (failed) await expect(invoke()).rejects.toBe(businessError)
    else expect(await invoke()).toBe(42)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(root.metrics?.measurements.request.operations).toBe(1)
    const span = exporter.getFinishedSpans().find((span) => span.name === 'request')
    if (span !== undefined && failed) expect(span.status.code).toBe(SpanStatusCode.ERROR)
  })

  it.each(modes)('%s logs the elapsed time captured by explicit end', async (mode) => {
    const log = logger()
    const root = create(log)
    await run(
      root,
      mode,
      (child) => {
        jest.advanceTimersByTime(5)
        child.end()
        jest.advanceTimersByTime(50)
        return 42
      },
      () => ({}),
      { log: true }
    )
    expect(root.metrics?.measurements.request.value).toBe(5)
    expect(log.logOperation).toHaveBeenCalledWith('request', 5, { method: 'GET' })
  })

  it('does not let a throwing factory or diagnostic console interrupt explicit end', () => {
    const root = create(logger())
    jest.mocked(console.error).mockImplementation(() => {
      throw new Error('console failure')
    })
    const factory = jest.fn(() => {
      throw new Error('factory failure')
    })
    const child = root.newChild('request', {}, { fullParams: factory })
    expect(() => {
      child.end()
    }).not.toThrow()
    expect(() => {
      child.end()
    }).not.toThrow()
    expect(child.metrics?.operations).toBe(1)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('attempts to close the span even when recording metrics fails', () => {
    const root = create(logger())
    const read = jest.fn(() => {
      throw new Error('metric recording failure')
    })
    expect(
      root.withSync('request', { method: 'GET' }, (child) => {
        if (child.metrics === undefined) throw new Error('Missing test metrics')
        Object.defineProperty(child.metrics, 'params', { get: read })
        return 42
      })
    ).toBe(42)
    expect(read).toHaveBeenCalledTimes(1)
    expect(exporter.getFinishedSpans()).toHaveLength(name === 'OTel' ? 1 : 0)
  })

  it.each(['error', 'info', 'warn', 'debug'] as const)('contains exceptions from the %s logger', (level) => {
    const log = logger()
    log[level] = () => {
      throw new Error('logger failure')
    }
    expect(() => {
      create(log)[level]('message')
    }).not.toThrow()
  })
})

it.each(['setAttribute', 'recordException', 'end'] as const)(
  'contains a throwing span %s and preserves the business error',
  async (method) => {
    const span = tracer.startSpan('request')
    const start = jest.spyOn(tracer, 'startSpan').mockReturnValue(span)
    const telemetryError = new Error('span failure')
    const fault = jest.spyOn(span, method).mockImplementation(() => {
      throw telemetryError
    })
    const report = jest.spyOn(console, 'error').mockImplementation(() => {})
    const businessError = new Error('business failure')
    const log = logger()
    const root = implementations[1].create(log)
    try {
      await expect(
        root.with(
          'request',
          {},
          async () => {
            throw businessError
          },
          () => ({ detail: 'payload' }),
          { log: true }
        )
      ).rejects.toBe(businessError)
      expect(root.metrics?.measurements.request.operations).toBe(1)
      expect(log.logOperation).toHaveBeenCalledTimes(1)
      expect(fault).toHaveBeenCalled()
    } finally {
      fault.mockRestore()
      start.mockRestore()
      report.mockRestore()
      if (span.isRecording()) span.end()
    }
  }
)
