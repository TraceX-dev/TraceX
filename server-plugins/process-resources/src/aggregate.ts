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

function isFiniteNumber (value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function numbers (value: unknown): number[] {
  return Array.isArray(value) ? value.filter(isFiniteNumber) : []
}

function timestamps (value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map((item: unknown) => (item instanceof Date ? item.getTime() : item)).filter(isFiniteNumber)
}

function booleans (value: unknown): boolean[] {
  return Array.isArray(value) ? value.filter((item: unknown): item is boolean => typeof item === 'boolean') : []
}

function sum (values: number[]): number {
  return values.reduce((total, item) => total + item, 0)
}

function extreme (values: number[], compare: (left: number, right: number) => number): number | null {
  return values.reduce<number | null>((result, item) => (result === null ? item : compare(result, item)), null)
}

/** Adds the finite numbers in an array. */
export function ArraySum (value: unknown): number | null {
  const result = sum(numbers(value))
  return Number.isFinite(result) ? result : null
}

/** Multiplies the finite numbers in an array. */
export function ArrayProduct (value: unknown): number | null {
  const values = numbers(value)
  if (values.includes(0)) return 0
  const result = values.reduce((product, item) => product * item, 1)
  return Number.isFinite(result) ? result : null
}

/** Returns the least finite number, or null for an empty array. */
export function ArrayMin (value: unknown): number | null {
  return extreme(numbers(value), Math.min)
}

/** Returns the greatest finite number, or null for an empty array. */
export function ArrayMax (value: unknown): number | null {
  return extreme(numbers(value), Math.max)
}

/** Returns the arithmetic mean of the finite numbers, or null when there are none. */
export function ArrayAverage (value: unknown): number | null {
  const values = numbers(value)
  if (values.length === 0) return null
  const total = sum(values)
  if (Number.isFinite(total)) return total / values.length
  const scaled = values.reduce((runningTotal, item) => runningTotal + item / Number.MAX_VALUE, 0)
  return (scaled / values.length) * Number.MAX_VALUE
}

/** Returns the earliest date as a timestamp, or null when there are no dates. */
export function ArrayEarliest (value: unknown): number | null {
  return extreme(timestamps(value), Math.min)
}

/** Returns the latest date as a timestamp, or null when there are no dates. */
export function ArrayLatest (value: unknown): number | null {
  return extreme(timestamps(value), Math.max)
}

/** Returns whether all boolean entries are true, including when there are no entries. */
export function ArrayAllTrue (value: unknown): boolean {
  return booleans(value).every((item) => item)
}

/** Returns whether any boolean entry is true. */
export function ArrayAnyTrue (value: unknown): boolean {
  return booleans(value).some((item) => item)
}

/** Counts the boolean entries that are true. */
export function ArrayCountTrue (value: unknown): number {
  return booleans(value).filter((item) => item).length
}
