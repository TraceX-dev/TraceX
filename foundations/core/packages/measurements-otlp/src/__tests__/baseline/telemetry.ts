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
  childMetrics,
  EMPTY_PARAMS,
  consoleLogger,
  newMetrics,
  noParamsLogger,
  nullPromise,
  platformNow,
  platformNowDiff,
  updateMeasure,
  updateNamedParams,
  type FullParamsType,
  type MeasureLogger,
  type MeasureLogLevel,
  type Metrics,
  type ParamsType,
  type WithOptions
} from '@hcengineering/measurements'
import { type MeasureContext } from './types'
import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Span,
  type Context,
  type Counter,
  type Gauge,
  type Meter,
  type Tracer
} from '@opentelemetry/api'
import { SeverityNumber, type Logger } from '@opentelemetry/api-logs'
import { suppressTracing } from '@opentelemetry/core'

const sdkServiceName: string | undefined = undefined

class MetricsContext {
  private readonly counters = new Map<string, Counter>()
  private readonly gauges = new Map<string, Gauge>()

  constructor (readonly meter?: Meter) {}

  getCounter (name: string): Counter | undefined {
    if (this.meter === undefined) {
      return undefined
    }
    let counter = this.counters.get(name)
    if (counter === undefined) {
      counter = this.meter.createCounter(name)
      this.counters.set(name, counter)
    }
    return counter
  }

  getGauge (name: string): Gauge | undefined {
    if (this.meter === undefined) {
      return undefined
    }
    let gauge = this.gauges.get(name)
    if (gauge === undefined) {
      gauge = this.meter.createGauge(name)
      this.gauges.set(name, gauge)
    }
    return gauge
  }
}

/**
 * @public
 */
export class OpenTelemetryMetricsContext implements MeasureContext {
  private readonly name: string
  private readonly params: ParamsType

  private fullParams: FullParamsType | (() => FullParamsType)
  logger: MeasureLogger
  metrics: Metrics
  id?: string

  st = platformNow()
  contextData: object
  isDone = false

  private done (value?: number, override?: boolean): void {
    if (!this.isDone) {
      this.isDone = true
      updateMeasure(this.metrics, this.st, this.params, this.fullParams, undefined, value, override)
      this.span?.end()
    }
  }

  constructor (
    name: string,
    readonly tracer: Tracer,
    readonly context: Context | undefined,
    readonly span: Span | undefined,
    params: ParamsType,
    fullParams: FullParamsType | (() => FullParamsType) = EMPTY_PARAMS,
    metrics: Metrics = newMetrics(),
    logger?: MeasureLogger,
    readonly parent?: MeasureContext,
    readonly logParams?: ParamsType,

    readonly otlpLogger?: Logger,
    readonly meter?: MetricsContext,
    readonly logLevel: MeasureLogLevel = 'info'
  ) {
    this.name = name
    this.params = params
    this.fullParams =
      typeof fullParams === 'function'
        ? () => {
            const resolved = fullParams()
            this.fullParams = resolved
            return resolved
          }
        : fullParams
    this.metrics = metrics
    this.contextData = parent !== undefined ? parent.contextData : {}
    updateNamedParams((this.metrics.namedParams ??= {}), params)

    this.logger = logger ?? (this.logParams != null ? consoleLogger(this.logParams ?? {}) : noParamsLogger)
  }

  gauge (name: string, value: number): void {
    this.meter?.getGauge(name)?.record(value, this.params)
  }

  counter (name: string, value: number): void {
    this.meter?.getCounter(name)?.add(value, this.params)
  }

  newChild (
    name: string,
    params: ParamsType,
    opt?: {
      fullParams?: FullParamsType | (() => FullParamsType)
      logger?: MeasureLogger
      span?: WithOptions['span'] // By default true
      meta?: Record<string, string | number | boolean>
      logLevel?: MeasureLogLevel
    }
  ): MeasureContext {
    let _span: Span | undefined
    let childContext: Context | undefined
    if (opt?.span === true || opt?.span === 'inherit') {
      childContext = opt?.span === 'inherit' ? context.active() : (this.context ?? context.active())

      if (opt.meta !== undefined && Object.keys(opt.meta).length > 0) {
        // We need to set meta params
        childContext = propagation.extract(childContext ?? context.active(), opt.meta)
      }
      _span = this.tracer.startSpan(name, undefined, childContext)

      for (const k of Object.keys(params)) {
        const v = params[k]
        _span?.setAttribute(k, v as any)
      }
    }
    if (opt?.span === 'disable') {
      childContext = suppressTracing(childContext ?? context.active())
    }
    if (childContext !== undefined && _span !== undefined) {
      childContext = trace.setSpan(childContext, _span)
    }

    const result = new OpenTelemetryMetricsContext(
      name,
      this.tracer,
      childContext,
      _span,
      params,
      opt?.fullParams ?? undefined,
      childMetrics(this.metrics, name),
      opt?.logger ?? this.logger,
      this,
      this.logParams,
      this.otlpLogger,
      this.meter,
      opt?.logLevel ?? this.logLevel
    )
    result.id = this.id
    return result
  }

  extractMeta (): Record<string, string | number | boolean> {
    const headers: Record<string, string> = {}
    if (this.context !== undefined) {
      propagation.inject(this.context, headers)
    }
    return headers
  }

  with<T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext) => T | Promise<T>,
    fullParams?: FullParamsType | (() => FullParamsType),
    opt?: WithOptions
  ): Promise<T> {
    const c = this.newChild(name, opt?.inheritParams === true ? { ...this.params, ...params } : params, {
      fullParams,
      span: opt?.span ?? true,
      meta: opt?.meta
    }) as OpenTelemetryMetricsContext

    let result: T | Promise<T>
    try {
      result = c.context !== undefined ? context.with(c.context, () => op(c)) : op(c)
    } catch (err) {
      c.finish(opt, true, err)
      throw err
    }

    if (!(result instanceof Promise)) {
      c.finish(opt, false)
      return result == null ? (nullPromise as Promise<T>) : Promise.resolve(result)
    }

    return Promise.resolve(result).then(
      (value) => {
        c.finish(opt, false)
        return value
      },
      (err: unknown) => {
        c.finish(opt, true, err)
        throw err
      }
    )
  }

  withSync<T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext) => T,
    fullParams?: ParamsType | (() => FullParamsType),
    opt?: WithOptions
  ): T {
    const c = this.newChild(name, params, { fullParams, logger: this.logger, span: opt?.span ?? true })
    const _context = (c as OpenTelemetryMetricsContext).context
    try {
      return _context !== undefined ? context.with(_context, () => op(c)) : op(c)
    } finally {
      c.end()
    }
  }

  private finish (opt: WithOptions | undefined, failed: boolean, error?: unknown): void {
    if (!this.isDone) {
      const span = this.span
      if (span !== undefined) {
        if (failed && opt?.suspendErrors !== true) {
          span.recordException(error as Error)
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error)
          })
        }

        const fParams = this.getFullParams()
        for (const [k, v] of Object.entries(fParams ?? {})) {
          if (v != null) span.setAttribute(k, typeof v === 'object' ? JSON.stringify(v) : v)
        }
      }

      this.end()
    }

    // Explicit end() closes the span, but does not suppress the requested operation log.
    if (opt?.log === true) {
      this.logger.logOperation(this.name, platformNowDiff(this.st), {
        ...this.params,
        ...this.getFullParams()
      })
    }
  }

  error (message: string, args?: Record<string, any>): void {
    if (this.otlpLogger !== undefined) {
      this.otlpLogger.emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: 'error',
        context: this.context,
        body: message,
        attributes: {
          'service.name': sdkServiceName,
          ...(args ?? {})
        }
      })
    }
    this.logger.error(message, { ...this.params, ...args, ...(this.logParams ?? {}) })
  }

  info (message: string, args?: Record<string, any>): void {
    if (this.otlpLogger !== undefined) {
      this.otlpLogger.emit({
        context: this.context,
        severityNumber: SeverityNumber.INFO,
        severityText: 'info',
        body: message,
        attributes: {
          'service.name': sdkServiceName,
          ...(args ?? {})
        }
      })
    }
    this.logger.info(message, { ...this.params, ...args, ...(this.logParams ?? {}) })
  }

  warn (message: string, args?: Record<string, any>): void {
    if (this.otlpLogger !== undefined) {
      this.otlpLogger.emit({
        severityNumber: SeverityNumber.WARN,
        severityText: 'warn',
        context: this.context,
        body: message,
        attributes: {
          'service.name': sdkServiceName,
          ...(args ?? {})
        }
      })
    }
    this.logger.warn(message, { ...this.params, ...args, ...(this.logParams ?? {}) })
  }

  debug (message: string, args?: Record<string, any>): void {
    if (this.logLevel !== 'debug') return
    if (this.otlpLogger !== undefined) {
      this.otlpLogger.emit({
        severityNumber: SeverityNumber.DEBUG,
        severityText: 'debug',
        context: this.context,
        body: message,
        attributes: {
          'service.name': sdkServiceName,
          ...(args ?? {})
        }
      })
    }
    this.logger.debug(message, { ...this.params, ...args, ...(this.logParams ?? {}) })
  }

  end (value?: number): void {
    this.done(value)
  }

  private getFullParams (): FullParamsType {
    return typeof this.fullParams === 'function' ? this.fullParams() : this.fullParams
  }

  getParams (): ParamsType {
    return this.params
  }
}
