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

import { BaseMeasureContext } from './base-measure-context'
import { consoleLogger, getMetricAttributeKey, platformNow, snapshotMetricAttributes } from './context-utils'

import { childMetrics, EMPTY_PARAMS, newMetrics, updateMeasure, updateNamedParams } from './metrics'
import {
  type ChildOptions,
  type FullParamsType,
  type MeasureContext,
  type MeasureLogger,
  type MeasureLogLevel,
  type Metrics,
  type ParamsType,
  type OperationLog,
  type OperationLogEntry,
  type WithOptions
} from './types'

export { consoleLogger, noParamsLogger, nullPromise } from './context-utils'

/**
 * @public
 */
export class MeasureMetricsContext extends BaseMeasureContext {
  constructor (
    name: string,
    params: ParamsType,
    fullParams: FullParamsType | (() => FullParamsType) = EMPTY_PARAMS,
    metrics: Metrics = newMetrics(),
    logger?: MeasureLogger,
    parent?: MeasureContext,
    logParams?: ParamsType,
    logLevel: MeasureLogLevel = 'info'
  ) {
    super(name, params, fullParams, metrics, logger, parent, logParams, logLevel)
  }

  gauge (name: string, value: number, attributes?: Readonly<ParamsType>): void {
    this.recordValue(name, value, attributes, true)
  }

  counter (name: string, value: number, attributes?: Readonly<ParamsType>): void {
    this.recordValue(name, value, attributes)
  }

  protected recordActive (name: string, delta: number, attributes: Readonly<ParamsType>): void {
    this.recordValue(name, delta, attributes)
  }

  protected snapshotCounterAttributes (params: ParamsType): Readonly<ParamsType> {
    return snapshotMetricAttributes(params)
  }

  private recordValue (name: string, value: number, attributes?: Readonly<ParamsType>, override?: boolean): void {
    const metrics = childMetrics(this.metrics, '#' + name)
    metrics.namedParams = metrics.namedParams ?? {}
    const prepared = attributes === undefined ? undefined : getMetricAttributeKey(attributes)
    if (prepared?.key === undefined) {
      updateMeasure(metrics, platformNow(), EMPTY_PARAMS, EMPTY_PARAMS, undefined, value, override)
      return
    }
    const { params, key } = prepared
    const series = (metrics.series ??= {})
    const point = (series[key] ??= { attributes: { ...params }, operations: 0, value: 0 })
    updateNamedParams(metrics.namedParams, params)
    if (override === true) {
      metrics.operations += value - point.operations
      point.operations = value
    } else {
      point.value += value
      point.operations++
      metrics.value += value
      metrics.operations++
    }
  }

  protected createChild (
    name: string,
    params: ParamsType,
    fullParams: FullParamsType | (() => FullParamsType) | undefined,
    opt?: ChildOptions
  ): MeasureMetricsContext {
    return new MeasureMetricsContext(
      name,
      params,
      fullParams,
      childMetrics(this.metrics, name),
      opt?.logger ?? this.logger,
      this,
      this.logParams,
      opt?.logLevel ?? this.logLevel
    )
  }

  extractMeta (): Record<string, string | number | boolean> {
    return {}
  }
}

export class NoMetricsContext implements MeasureContext {
  logger: MeasureLogger
  id?: string

  contextData: object = {}

  private readonly logLevel: MeasureLogLevel

  constructor (logger?: MeasureLogger, logLevel: MeasureLogLevel = 'info') {
    this.logger = logger ?? consoleLogger({})
    this.logLevel = logLevel
  }

  gauge (name: string, value: number, attributes?: Readonly<ParamsType>): void {}

  counter (name: string, value: number, attributes?: Readonly<ParamsType>): void {}

  newChild (
    name: string,
    params: ParamsType,
    opt?: {
      fullParams?: FullParamsType | (() => FullParamsType)
      logger?: MeasureLogger
      span?: WithOptions['span']
      meta?: Record<string, string | number | boolean>
      logLevel?: MeasureLogLevel
    }
  ): MeasureContext {
    const result = new NoMetricsContext(opt?.logger ?? this.logger, opt?.logLevel ?? this.logLevel)
    result.id = this.id
    result.contextData = this.contextData
    return result
  }

  with<T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext) => T | PromiseLike<T>,
    fullParams?: FullParamsType | (() => FullParamsType),
    opt?: WithOptions
  ): Promise<T> {
    const r = op(this.newChild(name, params, { fullParams, logger: this.logger }))
    return Promise.resolve(r)
  }

  withCounter<T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext) => T | PromiseLike<T>,
    fullParams?: FullParamsType | (() => FullParamsType),
    opt?: WithOptions
  ): Promise<T> {
    return this.with(name, params, op, fullParams, opt)
  }

  extractMeta (): Record<string, string | number | boolean> {
    return {}
  }

  withSync<T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext) => T,
    fullParams?: ParamsType | (() => FullParamsType)
  ): T {
    const c = this.newChild(name, params, { fullParams, logger: this.logger })
    return op(c)
  }

  withLog<T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext) => T | PromiseLike<T>,
    fullParams?: ParamsType
  ): Promise<T> {
    const r = op(this.newChild(name, params, { fullParams, logger: this.logger }))
    return Promise.resolve(r)
  }

  error (message: string, args?: Record<string, any>): void {
    this.logger.error(message, { ...args })
  }

  info (message: string, args?: Record<string, any>): void {
    this.logger.info(message, { ...args })
  }

  warn (message: string, args?: Record<string, any>): void {
    this.logger.warn(message, { ...args })
  }

  debug (message: string, args?: Record<string, any>): void {
    if (this.logLevel !== 'debug') return
    this.logger.debug(message, { ...args })
  }

  end (): void {}

  getParams (): ParamsType {
    return {}
  }
}

/**
 * Allow to use decorator for context enabled functions
 */
export function withContext (name: string, params: ParamsType = {}, options?: WithOptions): any {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor => {
    const originalMethod = descriptor.value
    descriptor.value = function (...args: any[]): Promise<any> {
      const ctx = args[0] as MeasureContext
      return ctx.with(
        name,
        params,
        (ctx) => originalMethod.apply(this, [ctx, ...args.slice(1)]) as Promise<any>,
        {},
        options
      )
    }
    return descriptor
  }
}

let operationProfiling = false

export function setOperationLogProfiling (value: boolean): void {
  operationProfiling = value
}

let globalId: number = 0

export function registerOperationLog (ctx: MeasureContext): { opLogMetrics?: Metrics, op?: OperationLog } {
  if (!operationProfiling) {
    return {}
  }
  const op: OperationLog = { start: platformNow(), ops: [], end: -1 }
  let opLogMetrics: Metrics | undefined

  if (ctx.id === undefined) {
    ctx.id = 'op_' + (++globalId).toString(16)
  }
  if (ctx.metrics !== undefined) {
    if (ctx.metrics.opLog === undefined) {
      ctx.metrics.opLog = {}
    }
    ctx.metrics.opLog[ctx.id] = op
    opLogMetrics = ctx.metrics
  }
  return { opLogMetrics, op }
}

export function updateOperationLog (opLogMetrics: Metrics | undefined, op: OperationLog | undefined): void {
  if (!operationProfiling) {
    return
  }
  if (op !== undefined) {
    op.end = platformNow()
  }
  // We should keep only longest one entry
  if (opLogMetrics?.opLog !== undefined) {
    const entries = Object.entries(opLogMetrics.opLog)

    const incomplete = entries.filter((it) => it[1].end === -1)
    const complete = entries.filter((it) => it[1].end !== -1)
    complete.sort((a, b) => a[1].start - b[1].start)
    if (complete.length > 30) {
      complete.splice(0, complete.length - 30)
    }

    opLogMetrics.opLog = Object.fromEntries(incomplete.concat(complete))
  }
}

export function addOperation<T> (
  ctx: MeasureContext,
  name: string,
  params: ParamsType,
  op: (ctx: MeasureContext) => Promise<T>,
  fullParams?: FullParamsType
): Promise<T> {
  if (!operationProfiling) {
    return op(ctx)
  }
  let opEntry: OperationLogEntry | undefined

  let p: MeasureContext | undefined = ctx
  let opLogMetrics: Metrics | undefined
  let id: string | undefined

  while (p !== undefined) {
    if (p.metrics?.opLog !== undefined) {
      opLogMetrics = p.metrics
    }
    if (id === undefined && p.id !== undefined) {
      id = p.id
    }
    p = p.parent
  }
  const opLog = id !== undefined ? opLogMetrics?.opLog?.[id] : undefined

  if (opLog !== undefined) {
    opEntry = {
      op: name,
      start: platformNow(),
      params: {},
      end: -1
    }
  }
  const result = op(ctx)
  if (opEntry !== undefined && opLog !== undefined) {
    const record = (): void => {
      opEntry.end = platformNow()
      opEntry.params = { ...params, ...(typeof fullParams === 'function' ? fullParams() : fullParams) }
      opLog.ops.push(opEntry)
    }

    void result.then(record, record)
  }
  return result
}
