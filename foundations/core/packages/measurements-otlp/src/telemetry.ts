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
  BaseMeasureContext,
  childMetrics,
  EMPTY_PARAMS,
  MeasureContext,
  MeasureMetricsContext,
  newMetrics,
  type ChildOptions,
  type FullParamsType,
  type MeasureLogger,
  type MeasureLogLevel,
  type Metrics,
  type ParamsType,
  reportTelemetryFailure,
  type WithOptions
} from '@hcengineering/measurements'
import {
  context,
  metrics as otelMetrics,
  propagation,
  Span,
  SpanStatusCode,
  trace,
  type Context,
  type Counter,
  type Gauge,
  type Meter,
  type Tracer
} from '@opentelemetry/api'
import { logs, Logger, SeverityNumber, type LoggerProvider } from '@opentelemetry/api-logs'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { suppressTracing } from '@opentelemetry/core'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { AWSXRayIdGenerator } from '@opentelemetry/id-generator-aws-xray'
import { CompressionAlgorithm } from '@opentelemetry/otlp-exporter-base'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node'

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
export class OpenTelemetryMetricsContext extends BaseMeasureContext {
  constructor (
    name: string,
    readonly tracer: Tracer,
    readonly context: Context | undefined,
    readonly span: Span | undefined,
    params: ParamsType,
    fullParams: FullParamsType | (() => FullParamsType) = EMPTY_PARAMS,
    metrics: Metrics = newMetrics(),
    logger?: MeasureLogger,
    parent?: MeasureContext,
    logParams?: ParamsType,

    readonly otlpLogger?: Logger,
    readonly meter?: MetricsContext,
    logLevel: MeasureLogLevel = 'info'
  ) {
    super(name, params, fullParams, metrics, logger, parent, logParams, logLevel)
  }

  gauge (name: string, value: number): void {
    this.meter?.getGauge(name)?.record(value, this.params)
  }

  counter (name: string, value: number): void {
    this.meter?.getCounter(name)?.add(value, this.params)
  }

  protected createChild (
    name: string,
    params: ParamsType,
    fullParams: FullParamsType | (() => FullParamsType) | undefined,
    opt?: ChildOptions,
    span?: WithOptions['span']
  ): OpenTelemetryMetricsContext {
    let _span: Span | undefined
    let childContext: Context | undefined
    if (span === true || span === 'inherit') {
      childContext = span === 'inherit' ? context.active() : (this.context ?? context.active())

      if (opt?.meta !== undefined && Object.keys(opt.meta).length > 0) {
        // We need to set meta params
        childContext = propagation.extract(childContext ?? context.active(), opt.meta)
      }
      _span = this.tracer.startSpan(name, undefined, childContext)

      for (const k of Object.keys(params)) {
        const v = params[k]
        if (v !== undefined) {
          _span?.setAttribute(k, v)
        }
      }
    }
    if (span === 'disable') {
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
      fullParams,
      childMetrics(this.metrics, name),
      opt?.logger ?? this.logger,
      this,
      this.logParams,
      this.otlpLogger,
      this.meter,
      opt?.logLevel ?? this.logLevel
    )
    return result
  }

  extractMeta (): Record<string, string | number | boolean> {
    const headers: Record<string, string> = {}
    if (this.context !== undefined) {
      propagation.inject(this.context, headers)
    }
    return headers
  }

  protected onFinish (opt: WithOptions | undefined, failed: boolean, error?: unknown): void {
    try {
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
      }
    } catch (error) {
      reportTelemetryFailure(error)
    }
    // An error after explicit end() cannot be recorded: the span is already closed.
    super.onFinish(opt, failed, error)
  }

  protected onEnd (): void {
    this.span?.end()
  }

  protected runOperation<T>(op: (ctx: MeasureContext) => T): T {
    return this.context !== undefined ? context.with(this.context, op, undefined, this) : op(this)
  }

  protected onLog (level: 'error' | 'info' | 'warn' | 'debug', message: string, args?: Record<string, unknown>): void {
    if (this.otlpLogger === undefined) return
    const severityNumber =
      level === 'error'
        ? SeverityNumber.ERROR
        : level === 'warn'
          ? SeverityNumber.WARN
          : level === 'debug'
            ? SeverityNumber.DEBUG
            : SeverityNumber.INFO
    this.otlpLogger.emit({
      severityNumber,
      severityText: level,
      context: this.context,
      body: message,
      attributes: { 'service.name': sdkServiceName, ...args }
    })
  }
}

/**
 * Parse W3C baggage header format to Record<string, string>
 *
 * W3C baggage format: "key1=value1,key2=value2;property=value,key3=value3"
 * Returns only the key-value pairs, ignoring properties
 */
function parseBaggage (baggageHeader?: string): Record<string, string> {
  if (baggageHeader == null || typeof baggageHeader !== 'string') {
    return {}
  }

  const result: Record<string, string> = {}

  // Split by comma to get individual baggage members
  const members = baggageHeader.split(',')

  for (const member of members) {
    const trimmedMember = member.trim()
    if (trimmedMember === '') continue

    // Split by semicolon to separate key=value from properties
    const parts = trimmedMember.split(';')
    const keyValuePart = parts[0]?.trim()

    if (keyValuePart == null) continue

    // Split by equals to get key and value
    const equalIndex = keyValuePart.indexOf('=')
    if (equalIndex === -1) continue

    const key = keyValuePart.substring(0, equalIndex).trim()
    const value = keyValuePart.substring(equalIndex + 1).trim()

    if (key != null) {
      // URL decode the key and value
      try {
        const decodedKey = decodeURIComponent(key)
        const decodedValue = decodeURIComponent(value)
        result[decodedKey] = decodedValue
      } catch (error) {
        // If decoding fails, use the original values
        result[key] = value
      }
    }
  }

  return result
}

let sdk: NodeSDK | undefined
let sdkServiceName: string | undefined
let sdkServiceVersion: string | undefined
let loggerProvider: LoggerProvider | undefined

export function initOpenTelemetrySDK (serviceName: string, version: string): boolean {
  if (sdk !== undefined) {
    return true
  }
  const tracesUrl = getTracesUrl()

  if (tracesUrl === undefined) {
    return false
  }

  process.env.OTEL_SERVICE_NAME = serviceName
  process.env.OTEL_SERVICE_VERSION = version

  sdkServiceName = serviceName
  sdkServiceVersion = version

  const traceHeaders = parseTraceExporterHeaders()

  const exporter = new OTLPTraceExporter({
    url: tracesUrl,
    headers: traceHeaders,
    compression:
      (process.env.OTEL_EXPORTER_OTLP_COMPRESSION as CompressionAlgorithm) ??
      (process.env.OTEL_EXPORTER_OTLP_TRACES_COMPRESSION as CompressionAlgorithm) ??
      CompressionAlgorithm.GZIP,
    keepAlive: true
  })

  const batchSpanProcessor = new BatchSpanProcessor(exporter, {
    maxExportBatchSize: parseInt(process.env.OTEL_EXPORTER_OTLP_TRACES_MAX_EXPORT_BATCH_SIZE ?? '1000'),
    maxQueueSize: parseInt(process.env.OTEL_EXPORTER_OTLP_TRACES_MAX_QUEUE_SIZE ?? '1000')
  })

  // Logs
  const logsEndpoint = getLogsUrl()
  const logHeaders = parseLogsExporterHeaders()
  const logExporter = new OTLPLogExporter({
    url: logsEndpoint,
    headers: logHeaders,
    compression:
      (process.env.OTEL_EXPORTER_OTLP_COMPRESSION as CompressionAlgorithm) ??
      (process.env.OTEL_EXPORTER_OTLP_LOGS_COMPRESSION as CompressionAlgorithm) ??
      CompressionAlgorithm.GZIP,
    keepAlive: true
  })

  const batchLogProcessor = new BatchLogRecordProcessor({
    exporter: logExporter,
    maxExportBatchSize: parseInt(process.env.OTEL_EXPORTER_OTLP_LOGS_MAX_EXPORT_BATCH_SIZE ?? '1000'),
    maxQueueSize: parseInt(process.env.OTEL_EXPORTER_OTLP_LOGS_MAX_QUEUE_SIZE ?? '1000')
  })

  // Metrics

  const metricsUrl = getMetricsUrl()
  const metricsHeaders = parseMetricsExporterHeaders()
  const metricsExporter = new OTLPMetricExporter({
    url: metricsUrl,
    headers: metricsHeaders
  })
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricsExporter,
    exportIntervalMillis: 15000
  })

  // SDK

  sdk = new NodeSDK({
    spanProcessors: [batchSpanProcessor],
    serviceName,
    traceExporter: exporter,
    resource: resourceFromAttributes({
      'service-name': serviceName,
      'service-version': version,
      'deployment-environment': process.env.OTEL_ENVIRONMENT
    }),
    instrumentations: [getNodeAutoInstrumentations()],
    idGenerator: new AWSXRayIdGenerator(),
    logRecordProcessors: [batchLogProcessor],
    metricReader
  })

  sdk.start()

  // NodeSDK registers this provider and owns its processors and shutdown.
  loggerProvider = logs.getLoggerProvider()

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdk
      ?.shutdown()
      .then(() => {
        console.log('Tracing terminated')
      })
      .catch((error) => {
        console.log('Error terminating tracing', error)
      })
      .finally(() => process.exit(0))
  })
  console.log('Using open telemetry metrics context', {
    traceEndpoint: tracesUrl,
    tracerHeadersSet: Array.from(Object.keys(traceHeaders)),
    logsEndpoint,
    logHeadersSet: Array.from(Object.keys(logHeaders))
  })
  return true
}

export function reportOTELError (error: Error, attributes?: Record<string, any>): void {
  if (sdkServiceName !== undefined && sdkServiceVersion !== undefined && loggerProvider !== undefined) {
    const otlpLogger = loggerProvider?.getLogger(sdkServiceName, sdkServiceVersion)
    otlpLogger?.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: 'error',
      body: error.message,
      context: context.active(),
      attributes: {
        ...attributes,
        'service.name': sdkServiceName,
        'service.version': sdkServiceVersion,
        'error.stack': error.stack
      }
    })
  }
}

export function reportOTEL (
  severity: 'info' | 'warning',
  message: string,
  time: number,
  attributes?: Record<string, any>
): void {
  if (sdkServiceName !== undefined && sdkServiceVersion !== undefined && loggerProvider !== undefined) {
    const otlpLogger = loggerProvider?.getLogger(sdkServiceName, sdkServiceVersion)
    otlpLogger?.emit({
      severityNumber: severity === 'info' ? SeverityNumber.INFO : SeverityNumber.WARN,
      body: message,
      severityText: severity,
      timestamp: time,
      context: context.active(),
      attributes: {
        ...attributes,
        'service.name': sdkServiceName,
        'service.version': sdkServiceVersion
      }
    })
  }
}

export function createOpenTelemetryMetricsContext (
  name: string,
  params: ParamsType,
  fullParams: FullParamsType | (() => FullParamsType) = EMPTY_PARAMS,
  metrics: Metrics = newMetrics(),
  logger?: MeasureLogger,
  version?: string
): MeasureContext {
  if (!initOpenTelemetrySDK(name, version ?? '')) {
    console.warn('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is not set, OpenTelemetry metrics will not be sent')
    const rootLogLevel: MeasureLogLevel = process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info'
    return new MeasureMetricsContext(name, params, fullParams, metrics, logger, undefined, undefined, rootLogLevel)
  }

  // Traces

  const tracer = trace.getTracer(name)

  const otlpLogger =
    process.env.OTEL_LOGGER_ENABLED === 'true' ? loggerProvider?.getLogger(sdkServiceName ?? name, version) : undefined

  const meter = otelMetrics.getMeter(name, version)

  const rootLogLevel: MeasureLogLevel = process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info'

  const ctx = new OpenTelemetryMetricsContext(
    name,
    tracer,
    undefined,
    undefined,
    params,
    fullParams,
    metrics,
    logger,
    undefined,
    undefined,
    otlpLogger,
    new MetricsContext(meter),
    rootLogLevel
  )
  return ctx
}
function parseTraceExporterHeaders (): Record<string, string> {
  const headers: Record<string, string> = parseBaggage(process.env.OTEL_EXPORTER_OTLP_HEADERS) ?? {}

  if (process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS !== undefined) {
    const extraHeaders = parseBaggage(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS)
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers[key] = value
    }
  }
  return headers
}

function getTracesUrl (): string | undefined {
  let tracesUrl = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  if (tracesUrl !== undefined && !tracesUrl.endsWith('/v1/traces')) {
    if (tracesUrl.endsWith('/')) {
      tracesUrl += 'v1/traces'
    } else {
      tracesUrl += '/v1/traces'
    }
  }
  return tracesUrl
}

function getLogsUrl (): string | undefined {
  let logsUrl = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  if (logsUrl !== undefined && !logsUrl.endsWith('/v1/logs')) {
    if (logsUrl.endsWith('/')) {
      logsUrl += 'v1/logs'
    } else {
      logsUrl += '/v1/logs'
    }
  }
  return logsUrl
}
function parseLogsExporterHeaders (): Record<string, string> {
  const headers: Record<string, string> = parseBaggage(process.env.OTEL_EXPORTER_OTLP_HEADERS) ?? {}

  if (process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS !== undefined) {
    const extraHeaders = parseBaggage(process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS)
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers[key] = value
    }
  }
  return headers
}

function getMetricsUrl (): string | undefined {
  let metricsUrl = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT

  if (metricsUrl !== undefined && !metricsUrl.endsWith('/v1/metrics')) {
    if (metricsUrl.endsWith('/')) {
      metricsUrl += 'v1/metrics'
    } else {
      metricsUrl += '/v1/metrics'
    }
  }
  return metricsUrl
}
function parseMetricsExporterHeaders (): Record<string, string> {
  const headers: Record<string, string> = parseBaggage(process.env.OTEL_EXPORTER_OTLP_HEADERS) ?? {}

  if (process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS !== undefined) {
    const extraHeaders = parseBaggage(process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS)
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers[key] = value
    }
  }
  return headers
}
