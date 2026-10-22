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

import { type MeasureLogger } from './types'

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

/** Return a monotonic performance timestamp. */
export const platformNow: () => number = () => performance.now()

/** Return elapsed milliseconds rounded to two decimal places. */
export const platformNowDiff = (old: number): number => Math.round((performance.now() - old) * 100) / 100

/** @internal */
export function isThenable<T> (value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    value != null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as PromiseLike<T>).then === 'function'
  )
}

const TELEMETRY_FAILURE_REPORT_INTERVAL = 30000
let lastTelemetryFailureReport = -Infinity

/** Report telemetry failures at most once per 30 seconds, without throwing. @internal */
export function reportTelemetryFailure (error: unknown): void {
  try {
    const now = Date.now()
    if (now >= lastTelemetryFailureReport && now - lastTelemetryFailureReport < TELEMETRY_FAILURE_REPORT_INTERVAL) {
      return
    }
    lastTelemetryFailureReport = now
    console.error('Failed to record telemetry', error)
  } catch {
    // Diagnostics must not interrupt the application, even if console.error throws.
  }
}
