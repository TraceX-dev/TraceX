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

/** A YAML authoring diagnostic identifying the invalid property. */
export class ProcessAuthoringError extends Error {
  constructor (
    readonly path: string,
    message: string,
    readonly line?: number,
    readonly column?: number
  ) {
    super(`${path}: ${message}`)
    this.name = 'ProcessAuthoringError'
  }
}

export interface AuthoringDiagnostic {
  message: string
  path: string
  line?: number
  column?: number
}

export interface AuthoringValidation {
  valid: boolean
  diagnostic?: AuthoringDiagnostic
}

export function fail (path: string, message: string): never {
  throw new ProcessAuthoringError(path, message)
}

export function object (value: unknown, path: string, keys?: string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path, 'Expected an object')
  const result = value as Record<string, unknown>
  for (const key of Object.keys(result)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(`${path}.${key}`, 'Reserved key')
    if (keys !== undefined && !keys.includes(key)) fail(`${path}.${key}`, 'Unsupported property')
  }
  return result
}

export function text (value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'Expected a nonempty string')
  return value
}

export function identifier (value: unknown, path: string): string {
  const result = text(value, path)
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(result) || ['constructor', 'prototype'].includes(result)) {
    fail(path, 'Expected a symbolic identifier')
  }
  return result
}

export function flag (value: unknown, path: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') fail(path, 'Expected a boolean')
  return value
}

export function list (value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'Expected an array')
  return value
}

export function assertTree (value: unknown, path: string = '$'): void {
  const parents = new Set<object>()
  const heights = new Map<object, number>()
  const visit = (value: unknown, path: string, depth: number): number => {
    if (depth > 32) fail(path, 'Maximum nesting depth exceeded')
    if (value === null || typeof value !== 'object') return 0
    if (parents.has(value)) fail(path, 'Cyclic YAML aliases are not supported')
    const previous = heights.get(value)
    if (previous !== undefined) {
      if (depth + previous > 32) fail(path, 'Maximum nesting depth exceeded')
      return previous
    }
    parents.add(value)
    let height = 0
    for (const [key, child] of Object.entries(value)) {
      height = Math.max(height, 1 + visit(child, `${path}.${key}`, depth + 1))
    }
    parents.delete(value)
    heights.set(value, height)
    return height
  }
  visit(value, path, 0)
}

/** Compares plain model data independent of object property order. */
export function authoringDataEqual (left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => authoringDataEqual(item, right[index]))
    )
  }
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a).filter((key) => a[key] !== undefined)
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && authoringDataEqual(a[key], b[key]))
  )
}
