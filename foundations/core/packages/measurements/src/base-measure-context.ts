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
  consoleLogger,
  isThenable,
  noParamsLogger,
  nullPromise,
  platformNow,
  reportTelemetryFailure
} from './context-utils'
import { EMPTY_PARAMS, updateMeasure, updateNamedParams } from './metrics'
import {
  type ChildOptions,
  type FullParamsType,
  type MeasureContext,
  type MeasureLogger,
  type MeasureLogLevel,
  type Metrics,
  type ParamsType,
  type WithOptions
} from './types'

/**
 * Shared implementation for the built-in measurement contexts.
 * This is not a supported extension API for external consumers.
 * @internal
 */
export abstract class BaseMeasureContext implements MeasureContext {
  private fullParams: FullParamsType | (() => FullParamsType)
  logger: MeasureLogger
  id?: string
  contextData: object
  st = platformNow()
  isDone = false
  private duration = 0

  protected constructor (
    protected readonly name: string,
    protected readonly params: ParamsType,
    fullParams: FullParamsType | (() => FullParamsType),
    public metrics: Metrics,
    logger: MeasureLogger | undefined,
    readonly parent: MeasureContext | undefined,
    readonly logParams: ParamsType | undefined,
    readonly logLevel: MeasureLogLevel
  ) {
    this.fullParams =
      typeof fullParams === 'function'
        ? () => {
            // Cache the fallback too: a throwing factory is still evaluated only once.
            this.fullParams = EMPTY_PARAMS
            try {
              const resolved = fullParams()
              this.fullParams = resolved
              return resolved
            } catch (error) {
              reportTelemetryFailure(error)
              return EMPTY_PARAMS
            }
          }
        : fullParams
    this.contextData = parent !== undefined ? parent.contextData : {}
    updateNamedParams((metrics.namedParams ??= {}), params)
    this.logger = logger ?? (logParams != null ? consoleLogger(logParams) : noParamsLogger)
  }

  protected abstract createChild (
    name: string,
    params: ParamsType,
    fullParams: FullParamsType | (() => FullParamsType) | undefined,
    opt?: ChildOptions,
    span?: WithOptions['span']
  ): BaseMeasureContext

  newChild (name: string, params: ParamsType, opt?: ChildOptions): BaseMeasureContext {
    const child = this.createChild(name, params, opt?.fullParams, opt, opt?.span)
    child.id = this.id
    return child
  }

  private operationChild (
    name: string,
    params: ParamsType,
    fullParams: FullParamsType | (() => FullParamsType) | undefined,
    opt?: WithOptions
  ): BaseMeasureContext {
    const child = this.createChild(
      name,
      opt?.inheritParams === true ? { ...this.params, ...params } : params,
      fullParams,
      opt,
      opt?.span ?? true
    )
    child.id = this.id
    return child
  }

  protected runOperation<T>(op: (ctx: MeasureContext) => T): T {
    return op(this)
  }

  with<T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext) => T | PromiseLike<T>,
    fullParams?: FullParamsType | (() => FullParamsType),
    opt?: WithOptions
  ): Promise<T> {
    const child = this.operationChild(name, params, fullParams, opt)
    let result: T | PromiseLike<T>
    let asynchronous: boolean
    try {
      result = child.runOperation(op)
      asynchronous = isThenable(result)
    } catch (error) {
      child.onFinish(opt, true, error)
      throw error
    }
    if (!asynchronous) {
      child.onFinish(opt, false)
      return result == null ? (nullPromise as Promise<T>) : Promise.resolve(result)
    }
    return Promise.resolve(result).then(
      (value) => {
        child.onFinish(opt, false)
        return value
      },
      (error: unknown) => {
        child.onFinish(opt, true, error)
        throw error
      }
    )
  }

  withSync<T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext) => T,
    fullParams?: FullParamsType | (() => FullParamsType),
    opt?: WithOptions
  ): T {
    const child = this.operationChild(name, params, fullParams, opt)
    let result: T
    try {
      result = child.runOperation(op)
    } catch (error) {
      child.onFinish(opt, true, error)
      throw error
    }
    child.onFinish(opt, false)
    return result
  }

  protected onFinish (opt: WithOptions | undefined, _failed: boolean, _error?: unknown): void {
    try {
      this.end()
      // Explicit end() closes metrics and the span, but does not suppress the operation log.
      if (opt?.log === true) {
        const duration = Math.round(this.duration * 100) / 100
        this.logger.logOperation(this.name, duration, { ...this.params, ...this.getFullParams() })
      }
    } catch (error) {
      reportTelemetryFailure(error)
    }
  }

  protected done (value?: number, override?: boolean): void {
    if (this.isDone) return
    this.isDone = true
    const endedAt = platformNow()
    this.duration = endedAt - this.st
    try {
      updateMeasure(this.metrics, this.st, this.params, this.fullParams, undefined, value, override, endedAt)
    } catch (error) {
      reportTelemetryFailure(error)
    }
    // Always attempt to close the span, including after a metric recording failure.
    try {
      this.onEnd()
    } catch (error) {
      reportTelemetryFailure(error)
    }
  }

  protected onEnd (): void {}

  end (value?: number): void {
    this.done(value)
  }

  protected getFullParams (): FullParamsType {
    return typeof this.fullParams === 'function' ? this.fullParams() : this.fullParams
  }

  getParams (): ParamsType {
    return this.params
  }

  protected onLog (level: 'error' | 'info' | 'warn' | 'debug', message: string, args?: Record<string, unknown>): void {}

  private log (level: 'error' | 'info' | 'warn' | 'debug', message: string, args?: Record<string, unknown>): void {
    if (level === 'debug' && this.logLevel !== 'debug') return
    try {
      this.onLog(level, message, args)
    } catch (error) {
      reportTelemetryFailure(error)
    }
    try {
      this.logger[level](message, { ...this.params, ...this.logParams, ...args })
    } catch (error) {
      reportTelemetryFailure(error)
    }
  }

  error (message: string, args?: Record<string, unknown>): void {
    this.log('error', message, args)
  }

  info (message: string, args?: Record<string, unknown>): void {
    this.log('info', message, args)
  }

  warn (message: string, args?: Record<string, unknown>): void {
    this.log('warn', message, args)
  }

  debug (message: string, args?: Record<string, unknown>): void {
    this.log('debug', message, args)
  }

  abstract extractMeta (): Record<string, string | number | boolean>
  abstract gauge (name: string, value: number): void
  abstract counter (name: string, value: number): void
}
