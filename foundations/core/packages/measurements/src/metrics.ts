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

import { platformNow } from './context-utils'
import { type MetricsData } from './types'
import { type FullParamsType, type Metrics, type ParamsType } from './types'

/**
 * @public
 */
export const globals: Metrics = newMetrics()

/**
 * @public
 * @returns
 */
export function newMetrics (): Metrics {
  return {
    operations: 0,
    value: 0,
    measurements: {},
    params: {},
    namedParams: {}
  }
}

/** Shared immutable defaults for operations without additional parameters. @public */
export const EMPTY_PARAMS: Readonly<ParamsType> = Object.freeze({})

/** Merge observed parameter values, marking conflicting observations with "*". @public */
export function updateNamedParams (named: ParamsType, params: ParamsType): void {
  for (const k of Object.keys(params)) {
    const v = params[k]
    // Ignore inherited keys; an own undefined value is an observation too.
    // The prototype call also supports a parameter named "hasOwnProperty".
    if (!Object.prototype.hasOwnProperty.call(named, k)) {
      setOwnValue(named, k, v)
    } else if (named[k] !== v) {
      named[k] = '*'
    }
  }
}

type ParameterResult = NonNullable<MetricsData['topResult']>[number]

function ownValue<T> (values: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined
}

function setOwnValue<T> (values: Record<string, T>, key: string, value: T): void {
  if (key === '__proto__') {
    Object.defineProperty(values, key, { value, enumerable: true, writable: true, configurable: true })
  } else {
    values[key] = value
  }
}

// Keep lookup indexes out of serialized metrics and release them with their arrays.
const parameterIndexes = new WeakMap<ParameterResult[], Map<string, ParameterResult>>()

function getParameterIndex (results: ParameterResult[]): Map<string, ParameterResult> {
  let index = parameterIndexes.get(results)
  if (index === undefined) {
    index = new Map()
    // Existing results may come from previously serialized metrics.
    for (const result of results) {
      for (const key of Object.keys(result.params)) {
        if (result.params[key] === true && !index.has(key)) {
          index.set(key, result)
        }
      }
    }
    parameterIndexes.set(results, index)
  }
  return index
}

function getUpdatedTopResult (
  current: Metrics['topResult'],
  time: number,
  params: FullParamsType
): Metrics['topResult'] {
  if (time === 0) {
    return current
  }
  const result: Metrics['topResult'] = current ?? []

  const newValue = {
    value: time,
    params
  }

  if (result.length > 6) {
    if (result[0].value < newValue.value) {
      result[0] = newValue
      return result
    }
    if (result[result.length - 1].value > newValue.value) {
      result[result.length - 1] = newValue
      return result
    }

    // Preserve the sampled entries without allocating and copying arrays.
    result[4] = result[5]
    result[3] = result[2]
    result[2] = result[1]
    result[1] = newValue
    result.length = 5
    return result
  } else {
    result.push(newValue)
    return result
  }
}

/**
 * Measure with tree expansion. Operation counter will be added only to leaf's.
 * @public
 */
export function measure (
  metrics: Metrics,
  params: ParamsType,
  fullParams: FullParamsType | (() => FullParamsType) = EMPTY_PARAMS,
  endOp?: (spend: number) => void
): () => void {
  const st = platformNow()
  return () => {
    updateMeasure(metrics, st, params, fullParams, endOp)
  }
}
export function updateMeasure (
  metrics: Metrics,
  st: number,
  params: ParamsType,
  fullParams: FullParamsType | (() => FullParamsType),
  endOp?: (spend: number) => void,
  value?: number,
  override?: boolean,
  endedAt: number = platformNow()
): void {
  const duration = endedAt - st
  const measuredValue = value ?? duration

  const fParams = typeof fullParams === 'function' ? fullParams() : fullParams
  // Update params if required
  const keys = Object.keys(params)
  if (keys.length > 0) {
    const k = keys[0]
    const v = params[k]
    let values = ownValue(metrics.params, k)
    if (values === undefined) {
      values = {}
      setOwnValue(metrics.params, k, values)
    }
    const vKey = `${v?.toString() ?? ''}`
    if (override === true && value === 0) {
      // Skip secondary results for deleted gauges, but still update leaf data below.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete values[vKey]
    } else {
      let param = ownValue(values, vKey)
      if (param === undefined) {
        param = { operations: 0, value: 0 }
        setOwnValue(values, vKey, param)
      }
      if (override === true) {
        param.operations = measuredValue
      } else {
        param.value += measuredValue
        param.operations++
      }
      if (keys.length > 1) {
        // Update secondary parameters as counters using the existing lookup index.
        const results = (param.topResult ??= [])
        const index = getParameterIndex(results)
        for (let i = 1; i < keys.length; i++) {
          const key = `${params[keys[i]]}`
          const r = index.get(key)
          if (r !== undefined) {
            r.value += 1 // Counter of operations
            r.time = (r.time ?? 0) + measuredValue
          } else {
            const result = { params: { [key]: true }, value: 1, time: measuredValue }
            results.push(result)
            index.set(key, result)
          }
        }
      }
    }
  }

  // Update leaf data
  if (override === true) {
    metrics.operations = measuredValue
  } else {
    metrics.value += measuredValue
    metrics.operations++
  }

  metrics.topResult = getUpdatedTopResult(metrics.topResult, duration, fParams)
  endOp?.(duration)
}

/**
 * Return or create child metrics for a literal name or a path of names.
 * @public
 */
export function childMetrics (root: Metrics, path: string | string[]): Metrics {
  if (typeof path === 'string') {
    return getChildMetric(root, path)
  }
  let oop = root
  for (const p of path) {
    oop = getChildMetric(oop, p)
  }
  return oop
}

function getChildMetric (root: Metrics, name: string): Metrics {
  let result = ownValue(root.measurements, name)
  if (result === undefined) {
    result = newMetrics()
    setOwnValue(root.measurements, name, result)
  }
  return result
}

/**
 * @public
 */
export function metricsAggregate (m: Metrics, limit: number = -1, roundMath: boolean = false): Metrics {
  const entries = aggregateMetrics(m.measurements, limit)

  // Rank parameter values only when collecting statistics.
  for (const group of Object.values(m.params)) {
    for (const param of Object.values(group)) {
      param.topResult?.sort((a, b) => b.value - a.value)
    }
  }

  // Use child overage, if there is no top level value specified.
  const me = entries
  const sumVal: number =
    (me.length === 0 ? m.value : 0) +
    me
      .filter((it) => !it[0].startsWith('#'))
      .map((it) => it[1])
      .reduce((p, v) => {
        return p + v.value
      }, 0)

  const ms: Record<string, Metrics> = {}
  // Select entries before converting to an object, which reorders integer keys.
  for (const [k, v] of limit === -1 ? entries : entries.slice(0, Math.max(0, limit))) {
    setOwnValue(ms, k, v)
  }

  return {
    operations: m.operations,
    measurements: ms,
    params: m.params,
    value: sumVal,
    topResult: m.topResult,
    namedParams: m.namedParams,
    opLog: m.opLog
  }
}

function aggregateMetrics (m: Record<string, Metrics>, limit: number = -1): [string, Metrics][] {
  return Object.entries(m)
    .map(([k, v]): [string, Metrics] => [k, metricsAggregate(v, limit)])
    .sort((a, b) => b[1].value - a[1].value)
}

function sortedMeasurements (m: Record<string, Metrics>): [string, Metrics][] {
  return Object.entries(m).sort((a, b) => b[1].value - a[1].value)
}

function toLen (val: string, sep: string, len: number): string {
  while (val.length < len) {
    val += sep
  }
  return val
}

function printMetricsChildren (params: Record<string, Metrics>, offset: number, length: number): string {
  let r = ''
  if (Object.keys(params).length > 0) {
    r += '\n' + toLen('', ' ', offset)
    r += sortedMeasurements(params)
      .filter((it) => it[1].value > 0.1)
      .map(([k, vv]) => toString(k, vv, offset, length))
      .join('\n' + toLen('', ' ', offset))
  }
  return r
}

function round2 (value: number): number {
  return Math.round(value * 100) / 100
}

function avg2 (value: number, count: number): number {
  return round2(value / (count > 0 ? count : 1))
}

function printMetricsParams (
  params: Record<string, Record<string, MetricsData>>,
  offset: number,
  length: number
): string {
  let r = ''
  const joinP = (key: string, data: Record<string, MetricsData>): string[] => {
    return Object.entries(data)
      .filter((it) => it[1].value >= 0.1)
      .map(([k, vv]) =>
        `${toLen('', ' ', offset)}${toLen(key + '=' + k, '-', length - offset)}: avg ${avg2(
          vv.value,
          vv.operations
        )} total: ${round2(vv.value)} ops: ${vv.operations}`.trim()
      )
  }
  const joinParams = Object.entries(params).flatMap(([key, values]) => joinP(key, values))
  if (joinParams.length > 0) {
    r += '\n' + toLen('', ' ', offset)
    r += joinParams.join('\n' + toLen('', ' ', offset))
  }
  return r
}

function toString (name: string, m: Metrics, offset: number, length: number): string {
  let r = `${toLen('', ' ', offset)}${toLen(name, '-', length - offset)}: avg ${avg2(
    m.value,
    m.operations
  )} total: ${round2(m.value)} ops: ${m.operations}`.trim()
  r += printMetricsParams(m.params, offset + 4, length)
  r += printMetricsChildren(m.measurements, offset + 4, length)
  return r
}

function toJson (m: Metrics): any {
  const obj: any = {
    $total: m.value,
    $ops: m.operations
  }
  if (m.operations > 1) {
    obj.avg = avg2(m.value, m.operations)
  }
  if (Object.keys(m.params).length > 0) {
    obj.params = m.params
  }
  for (const [k, v] of sortedMeasurements(m.measurements ?? {})) {
    obj[`${k} ${v.value} ${v.operations} ${v.operations > 1 ? avg2(v.value, v.operations) : ''}`] = toJson(v)
  }

  return obj
}

/**
 * @public
 */
export function metricsToString (metrics: Metrics, name = 'System', length: number): string {
  return toString(name, metricsAggregate(metrics, 50, true), 0, length)
}

export function metricsToJson (metrics: Metrics): any {
  return toJson(metricsAggregate(metrics))
}

function printMetricsParamsRows (
  params: Record<string, Record<string, MetricsData>>,
  offset: number
): (string | number)[][] {
  const r: (string | number)[][] = []
  function joinP (key: string, data: Record<string, MetricsData>): (string | number)[][] {
    return Object.entries(data).map(([k, vv]) => [
      offset,
      `${key}=${k}`,
      avg2(vv.value, vv.operations),
      round2(vv.value),
      vv.operations
    ])
  }
  for (const [k, v] of Object.entries(params)) {
    r.push(...joinP(k, v))
  }
  return r
}

function printMetricsChildrenRows (params: Record<string, Metrics>, offset: number): (string | number)[][] {
  const r: (string | number)[][] = []
  if (Object.keys(params).length > 0) {
    sortedMeasurements(params).forEach(([k, vv]) => r.push(...toStringRows(k, vv, offset)))
  }
  return r
}

function toStringRows (name: string, m: Metrics, offset: number): (number | string)[][] {
  const r: (number | string)[][] = [[offset, name, avg2(m.value, m.operations), round2(m.value), m.operations]]
  r.push(...printMetricsParamsRows(m.params, offset + 1))
  r.push(...printMetricsChildrenRows(m.measurements, offset + 1))
  return r
}

/**
 * @public
 */
export function metricsToRows (metrics: Metrics, name = 'System'): (number | string)[][] {
  return toStringRows(name, metricsAggregate(metrics, 50, true), 0)
}
