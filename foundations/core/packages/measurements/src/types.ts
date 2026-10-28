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

/**
 * @public
 */
export type ParamType = string | number | boolean | undefined

/**
 * @public
 */
export type ParamsType = Record<string, ParamType>

/**
 * @public
 */
export type FullParamsType = Record<string, any>

/**
 * @public
 */
export interface MetricsData {
  operations: number
  value: number
  topResult?: {
    value: number
    time?: number
    params: FullParamsType
  }[]
}

export interface OperationLogEntry {
  op: string
  params: ParamsType
  start: number
  end: number
}
export interface OperationLog {
  ops: OperationLogEntry[]
  start: number
  end: number
}

/**
 * @public
 */
export interface Metrics extends MetricsData {
  namedParams: ParamsType
  params: Record<string, Record<string, MetricsData>>
  measurements: Record<string, Metrics>

  /** Explicit metric series keyed by the complete, normalized attribute set. */
  series?: Record<string, MetricsData & { attributes: ParamsType }>

  opLog?: Record<string, OperationLog>
}

/**
 * Root log verbosity for {@link MeasureContext.debug} (child contexts inherit unless overridden in {@link MeasureContext.newChild}).
 * @public
 */
export type MeasureLogLevel = 'info' | 'debug'

/**
 * @public
 */
export interface MeasureLogger {
  info: (message: string, obj?: Record<string, any>) => void
  error: (message: string, obj?: Record<string, any>) => void

  warn: (message: string, obj?: Record<string, any>) => void

  debug: (message: string, obj?: Record<string, any>) => void

  logOperation: (operation: string, time: number, params: ParamsType) => void

  childLogger?: (name: string, params: Record<string, any>) => MeasureLogger

  close: () => Promise<void>
}

export interface WithOptions {
  span?: true | false | 'disable' | 'skip' | 'inherit' // 'none' means no span will be created, 'disable' means context will be tracing disabled
  log?: boolean
  inheritParams?: boolean

  // Passed context metadata
  meta?: Record<string, string | number | boolean>

  // If passed, will not send an error into span, for some cases we need to throw error from with, without reporting it.
  suspendErrors?: boolean
}

/** Options for creating a child context. @public */
export interface ChildOptions {
  fullParams?: FullParamsType | (() => FullParamsType)
  logger?: MeasureLogger
  span?: WithOptions['span']
  meta?: Record<string, string | number | boolean>
  logLevel?: MeasureLogLevel
}

/**
 * @public
 */
export interface MeasureContext<Q = any> {
  id?: string

  // Context data will be copied referenced for all child contexts.
  contextData: Q
  // Create a child metrics context
  newChild: (name: string, params: ParamsType, opt?: ChildOptions) => MeasureContext

  metrics?: Metrics

  /**
   * Measure an operation, awaiting native promises and other thenables.
   * A synchronous exception from the callback is thrown synchronously.
   */
  with: <T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext<Q>) => T | PromiseLike<T>,
    fullParams?: FullParamsType | (() => FullParamsType),
    opt?: WithOptions
  ) => Promise<T>

  /** Execute exactly as with(), additionally recording invocation and lifecycle counters. */
  withCounter: <T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext<Q>) => T | PromiseLike<T>,
    fullParams?: FullParamsType | (() => FullParamsType),
    opt?: WithOptions
  ) => Promise<T>

  withSync: <T>(
    name: string,
    params: ParamsType,
    op: (ctx: MeasureContext<Q>) => T,
    fullParams?: FullParamsType | (() => FullParamsType),
    opt?: WithOptions
  ) => T

  extractMeta: () => Record<string, string | number | boolean>

  logger: MeasureLogger

  parent?: MeasureContext
  getParams: () => ParamsType

  gauge: (name: string, value: number, attributes?: Readonly<ParamsType>) => void
  counter: (name: string, value: number, attributes?: Readonly<ParamsType>) => void

  // Capture error
  error: (message: string, obj?: Record<string, any>) => void
  info: (message: string, obj?: Record<string, any>) => void
  warn: (message: string, obj?: Record<string, any>) => void
  debug: (message: string, obj?: Record<string, any>) => void // No-op unless this context was created with log level `debug`.

  // Mark current context as complete
  // If no value is passed, time difference will be used.
  end: (value?: number) => void
}
