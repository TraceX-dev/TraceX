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

import type { Ref } from '@hcengineering/core'
import { createContext, parseDSLContext } from './dslContext'
import type { ProcessFunction } from './index'
import type { SelectedContext } from './types'
import { fail, list, object } from './authoring-validation'

export interface AuthoringField {
  name: string
  type: 'string' | 'number' | 'employee' | 'choice'
  choices?: string[]
  multiple: boolean
  readonly: boolean
}

export interface CompiledExpression {
  value: string | number
  type: AuthoringField['type']
  dependencies: string[]
}

function field (key: string, fields: Record<string, AuthoringField>, path: string): AuthoringField {
  const result = fields[key]
  if (!Object.prototype.hasOwnProperty.call(fields, key)) fail(path, `Unknown field or slot "${key}"`)
  return result
}

function nativeFunction (name: string): Ref<ProcessFunction> {
  return `process:function:${name}` as Ref<ProcessFunction>
}

/** Compiles field references, number(field), and multiplication without executing scripts. */
export function compileExpression (
  source: string,
  fields: Record<string, AuthoringField>,
  path: string
): CompiledExpression {
  const factors = source
    .trim()
    .split('*')
    .map((part) => part.trim())
  if (factors.some((part) => part === '')) fail(path, 'Invalid multiplication expression')
  const compiled = factors.map((factor): CompiledExpression => {
    if (/^-?\d+(\.\d+)?$/.test(factor)) {
      const value = Number(factor)
      if (!Number.isFinite(value)) fail(path, 'Expected a finite number')
      return { value, type: 'number', dependencies: [] }
    }
    const converted = /^number\(([A-Za-z][A-Za-z0-9_]*)\)$/.exec(factor)
    const key = converted?.[1] ?? factor
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
      fail(path, 'Supported expressions: field, number(field), and multiplication')
    }
    const definition = field(key, fields, path)
    if (definition.multiple || definition.type === 'employee') fail(path, 'A scalar value is required')
    const context: SelectedContext = { type: 'attribute', key: definition.name }
    if (converted !== null) {
      if (definition.type === 'choice') {
        if (
          definition.choices?.some((choice) => !/^-?\d+(\.\d+)?$/.test(choice) || !Number.isFinite(Number(choice))) ===
          true
        ) {
          fail(path, 'number() requires numeric choice values')
        }
        context.functions = [
          { func: nativeFunction('StringFromEnum'), props: {} },
          { func: nativeFunction('NumberFromString'), props: {} }
        ]
      } else if (definition.type === 'string') {
        fail(
          path,
          'number() on arbitrary strings has no verified numeric input guard; use a numeric choice or number field'
        )
      }
    }
    return { value: createContext(context), type: converted !== null ? 'number' : definition.type, dependencies: [key] }
  })
  if (compiled.length === 1) return compiled[0]
  if (compiled.some((part) => part.type !== 'number')) {
    fail(path, 'Multiplication requires number operands; use number(field) for numeric choices')
  }
  let result = compiled[0].value
  for (const part of compiled.slice(1)) {
    if (typeof result === 'number' && typeof part.value === 'number') {
      result *= part.value
      if (!Number.isFinite(result)) fail(path, 'Numeric multiplication exceeds the finite number range')
    } else {
      if (
        (typeof result === 'number' && !/^-?\d+(\.\d+)?$/.test(String(result))) ||
        (typeof part.value === 'number' && !/^-?\d+(\.\d+)?$/.test(String(part.value)))
      ) {
        fail(path, 'Native expressions cannot encode numeric operands that serialize with exponent notation')
      }
      const context: SelectedContext =
        typeof result === 'number' ? { type: 'const', value: result, key: '' } : parseCompiled(result, path)
      context.functions = [
        ...(context.functions ?? []),
        { func: nativeFunction('Multiply'), props: { value: part.value } }
      ]
      result = createContext(context)
    }
  }
  return { value: result, type: 'number', dependencies: [...new Set(compiled.flatMap((part) => part.dependencies))] }
}

function parseCompiled (value: string, path: string): SelectedContext {
  // Nested multiplications are assembled from the existing context serializer.
  const context = parseDSLContext(value)
  if (context === undefined) fail(path, 'Could not encode a native expression')
  return context
}

export interface CompiledCondition {
  field: string
  query: Record<string, number> | number
}

/** Compiles a single numeric comparison to a native card match predicate. */
export function compileCondition (
  source: string,
  fields: Record<string, AuthoringField>,
  path: string
): CompiledCondition {
  const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*(>=|<=|>|<|==)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(source)
  if (match === null) fail(path, 'Expected a numeric comparison: field > number, <, >=, <=, or ==')
  const definition = field(match[1], fields, path)
  if (definition.type !== 'number' || definition.multiple) fail(path, 'Comparison requires a number field')
  const operators: Record<string, string> = { '>': '$gt', '<': '$lt', '>=': '$gte', '<=': '$lte' }
  const value = Number(match[3])
  if (!Number.isFinite(value)) fail(path, 'Expected a finite comparison value')
  return { field: match[1], query: match[2] === '==' ? value : { [operators[match[2]]]: value } }
}

/** Compiles readable conjunctions of verified native predicate operators. */
export function compileMatch (
  value: unknown,
  fields: Record<string, AuthoringField>,
  path: string
): Record<string, unknown> {
  if (typeof value === 'string') {
    const condition = compileCondition(value, fields, path)
    return { [fields[condition.field].name]: condition.query }
  }
  const result: Record<string, unknown> = {}
  for (const [key, query] of Object.entries(object(value, path))) {
    const definition = field(key, fields, `${path}.${key}`)
    const scalar = (value: unknown): unknown => {
      if (value === null) return null
      if (
        definition.type === 'choice' &&
        (typeof value === 'number' || typeof value === 'string') &&
        definition.choices?.includes(String(value))
      ) {
        return String(value)
      }
      if (definition.type === 'number' && typeof value === 'number' && Number.isFinite(value)) return value
      if (definition.type === 'string' && typeof value === 'string' && !value.includes('${')) return value
      return fail(`${path}.${key}`, 'Predicate value does not match the field type')
    }
    if (query === null || typeof query !== 'object') {
      result[definition.name] = scalar(query)
      continue
    }
    const predicates = object(query, `${path}.${key}`, ['exists', 'ne', 'in', 'gt', 'gte', 'lt', 'lte'])
    if (Object.keys(predicates).length === 0) fail(`${path}.${key}`, 'At least one predicate operator is required')
    const native: Record<string, unknown> = {}
    for (const [operator, operand] of Object.entries(predicates)) {
      if (operator === 'exists') {
        if (typeof operand !== 'boolean') fail(`${path}.${key}.exists`, 'Expected a boolean')
        native.$exists = operand
      } else if (operator === 'in') {
        native.$in = list(operand, `${path}.${key}.in`).map(scalar)
      } else if (operator === 'ne') {
        native.$ne = scalar(operand)
      } else {
        if (definition.type !== 'number' || typeof operand !== 'number' || !Number.isFinite(operand)) {
          fail(`${path}.${key}.${operator}`, 'Comparison requires a finite number and a number field')
        }
        native[`$${operator}`] = operand
      }
    }
    result[definition.name] = native
  }
  return result
}
