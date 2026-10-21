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

// Basic performance metrics suite.

import { platformNow, platformNowDiff } from '.'
import { childMetrics, EMPTY_PARAMS, newMetrics, updateMeasure, updateNamedParams } from './metrics'
import {
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

const errorPrinter = ({ message, stack, ...rest }: Error): object => ({
  message,
  stack,
  ...rest
})
function replacer (value: any): any {
  return value instanceof Error ? errorPrinter(value) : value
}

export const consoleLogger = (logParams: Record<string, any>): MeasureLogger => ({
  info: (msg, args) => {
    console.info(
      msg,
      ...Object.entries({ ...(args ?? {}), ...(logParams ?? {}) }).map(
        (it) => `${it[0]}=${JSON.stringify(replacer(it[1]))}`
      )
    )
  },
  error: (msg, args) => {
    console.error(
      msg,
      ...Object.entries({ ...(args ?? {}), ...(logParams ?? {}) }).map(
        (it) => `${it[0]}=${JSON.stringify(replacer(it[1]))}`
      )
    )
  },
  warn: (msg, args) => {
    console.warn(
      msg,
      ...Object.entries({ ...(args ?? {}), ...(logParams ?? {}) }).map(
        (it) => `${it[0]}=${JSON.stringify(replacer(it[1]))}`
      )
    )
  },
  debug: (msg, args) => {
    console.debug(
      msg,
      ...Object.entries({ ...(args ?? {}), ...(logParams ?? {}) }).map(
        (it) => `${it[0]}=${JSON.stringify(replacer(it[1]))}`
      )
    )
  },
  close: async () => {},
  logOperation: (operation, time, params) => {}
})

export const noParamsLogger = consoleLogger({})

export const nullPromise = Promise.resolve()

/**
 * @public
 */
export class MeasureMetricsContext implements MeasureContext {
  private readonly name: string
  private readonly params: ParamsType

  private fullParams: FullParamsType | (() => FullParamsType)
  logger: MeasureLogger
  metrics: Metrics
  id?: string

  private readonly logLevel: MeasureLogLevel

  st = platformNow()
  contextData: object
  isDone = false

  private done (value?: number, override?: boolean): void {
    if (!this.isDone) {
      this.isDone = true
      updateMeasure(this.metrics, this.st, this.params, this.fullParams, undefined, value, override)
    }
  }

  constructor (
    name: string,
    params: ParamsType,
    fullParams: FullParamsType | (() => FullParamsType) = EMPTY_PARAMS,
    metrics: Metrics = newMetrics(),
    logger?: MeasureLogger,
    readonly parent?: MeasureContext,
    readonly logParams?: ParamsType,
    logLevel: MeasureLogLevel = 'info'
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
    this.logLevel = logLevel
    this.contextData = parent !== undefined ? parent.contextData : {}
    updateNamedParams((this.metrics.namedParams ??= {}), params)

    this.logger = logger ?? (this.logParams != null ? consoleLogger(this.logParams ?? {}) : noParamsLogger)
  }

  gauge (name: string, value: number): void {
    this.recordValue(name, value, true)
  }

  counter (name: string, value: number): void {
    this.recordValue(name, value)
  }

  private recordValue (name: string, value: number, override?: boolean): void {
    const metrics = childMetrics(this.metrics, '#' + name)
    metrics.namedParams = metrics.namedParams ?? {}
    updateMeasure(metrics, platformNow(), EMPTY_PARAMS, EMPTY_PARAMS, undefined, value, override)
  }

  newChild (
    name: string,
    params: ParamsType,
    opt?: {
      fullParams?: FullParamsType
      logger?: MeasureLogger
      span?: WithOptions['span'] // By default true
      meta?: Record<string, string | number | boolean>
      logLevel?: MeasureLogLevel
    }
  ): MeasureContext {
    const result = new MeasureMetricsContext(
      name,
      params,
      opt?.fullParams ?? undefined,
      childMetrics(this.metrics, name),
      opt?.logger ?? this.logger,
      this,
      this.logParams,
      opt?.logLevel ?? this.logLevel
    )
    result.id = this.id
    return result
  }

  with<T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext) => T | Promise<T>,
    fullParams?: ParamsType | (() => FullParamsType),
    opt?: WithOptions
  ): Promise<T> {
    const c = this.newChild(name, params, fullParams === undefined ? undefined : { fullParams })
    let needFinally = true
    try {
      const value = op(c)
      if (value instanceof Promise) {
        needFinally = false
        if (opt?.log !== true) {
          return value.then(
            (result) => {
              c.end()
              return result
            },
            (error: unknown) => {
              c.end()
              throw error
            }
          )
        }
        return value.finally(() => {
          c.end()
          if (opt?.log === true) {
            this.logger.logOperation(name, platformNowDiff((c as MeasureMetricsContext).st), {
              ...params,
              ...(c as MeasureMetricsContext).getFullParams()
            })
          }
        })
      } else {
        if (value == null) {
          return nullPromise as Promise<T>
        }
        return Promise.resolve(value)
      }
    } finally {
      if (needFinally) {
        c.end()
      }
    }
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
    const c = this.newChild(name, params, fullParams === undefined ? undefined : { fullParams })
    try {
      return op(c)
    } finally {
      c.end()
    }
  }

  error (message: string, args?: Record<string, any>): void {
    this.logger.error(message, { ...this.params, ...(this.logParams ?? {}), ...args })
  }

  info (message: string, args?: Record<string, any>): void {
    this.logger.info(message, { ...this.params, ...(this.logParams ?? {}), ...args })
  }

  warn (message: string, args?: Record<string, any>): void {
    this.logger.warn(message, { ...this.params, ...(this.logParams ?? {}), ...args })
  }

  debug (message: string, args?: Record<string, any>): void {
    if (this.logLevel !== 'debug') return
    this.logger.debug(message, { ...this.params, ...(this.logParams ?? {}), ...args })
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

export class NoMetricsContext implements MeasureContext {
  logger: MeasureLogger
  id?: string

  contextData: object = {}

  private readonly logLevel: MeasureLogLevel

  constructor (logger?: MeasureLogger, logLevel: MeasureLogLevel = 'info') {
    this.logger = logger ?? consoleLogger({})
    this.logLevel = logLevel
  }

  gauge (name: string, value: number): void {}

  counter (name: string, value: number): void {}

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
    op: (ctx: MeasureContext) => T | Promise<T>,
    fullParams?: ParamsType | (() => FullParamsType)
  ): Promise<T> {
    const r = op(this.newChild(name, params, { fullParams, logger: this.logger }))
    return r instanceof Promise ? r : Promise.resolve(r)
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
    op: (ctx: MeasureContext) => T | Promise<T>,
    fullParams?: ParamsType
  ): Promise<T> {
    const r = op(this.newChild(name, params, { fullParams, logger: this.logger }))
    return r instanceof Promise ? r : Promise.resolve(r)
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
