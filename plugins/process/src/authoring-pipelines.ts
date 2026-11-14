//
// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import type { ProcessFunction } from './index'
import type { Ref } from '@hcengineering/core'
import type { Func, SelectedContext } from './types'
import { createContext } from './dslContext'
import { parseContext } from './utils'
import { authoringDataEqual, fail, list, object, text } from './authoring-validation'
import { authoringOperationContract, type AuthoringOutputEnvironment } from './authoring-contracts'

type Resolve = (value: unknown, path: string) => unknown

function stage (
  value: unknown,
  role: 'call' | 'reduce' | 'pipe',
  environment: AuthoringOutputEnvironment,
  resolve: Resolve,
  path: string
): Func {
  const entries = typeof value === 'string' ? [[value, {}]] : Object.entries(object(value, path))
  if (entries.length !== 1) fail(path, 'Expected exactly one function and its parameters')
  const name = text(entries[0][0], path)
  const id = name.includes(':') ? name : `process:function:${name}`
  const definition = authoringOperationContract(id, 'functions', environment)
  if (environment.model !== undefined && definition === undefined) {
    fail(path, `Function ${id} is not registered in the destination model`)
  }
  const allowed = role === 'call' ? ['context'] : role === 'reduce' ? ['reduce'] : ['transform', 'convert']
  if (definition?.type !== undefined && !allowed.includes(String(definition.type))) {
    fail(path, `Function ${id} has type ${String(definition.type)}; ${role} requires ${allowed.join(' or ')}`)
  }
  return { func: id as Ref<ProcessFunction>, props: object(resolve(entries[0][1], path), path) }
}

/** Serializes through the native grammar when lossless, otherwise uses its supported JSON context form. */
function serialize (context: SelectedContext): string {
  const source = createContext(context)
  return authoringDataEqual(parseContext(source), context) ? source : '$' + JSON.stringify(context)
}

/** Composes registered functions without executing code or assigning guessed parameter semantics. */
export function decodeAuthoringPipeline (
  value: unknown,
  environment: AuthoringOutputEnvironment,
  resolve: Resolve,
  path: string
): string {
  const data = object(value, path, ['from', 'call', 'reduce', 'pipe', 'fallback'])
  if (Object.prototype.hasOwnProperty.call(data, 'from') === Object.prototype.hasOwnProperty.call(data, 'call')) {
    fail(path, 'Use exactly one of from or call')
  }
  let context: SelectedContext
  if (data.call !== undefined) {
    context = { type: 'function', ...stage(data.call, 'call', environment, resolve, `${path}.call`), key: '' }
  } else {
    const from = data.from
    if (
      from !== null &&
      typeof from === 'object' &&
      !Array.isArray(from) &&
      Object.keys(from).length === 1 &&
      Object.prototype.hasOwnProperty.call(from, 'literal')
    ) {
      context = { type: 'const', value: object(from, `${path}.from`).literal, key: '' }
    } else {
      const source = resolve(from, `${path}.from`)
      const parsed = typeof source === 'string' ? parseContext(source) : undefined
      if (parsed === undefined) {
        fail(`${path}.from`, 'Expected a value reference, native context expression or {literal: value}')
      }
      context = parsed
    }
  }
  if (data.reduce !== undefined) {
    if (context.sourceFunction !== undefined) fail(`${path}.reduce`, 'The source already declares a reduction')
    context.sourceFunction = stage(data.reduce, 'reduce', environment, resolve, `${path}.reduce`)
  }
  if (data.pipe !== undefined) {
    context.functions = [
      ...(context.functions ?? []),
      ...list(data.pipe, `${path}.pipe`).map((item, index) =>
        stage(item, 'pipe', environment, resolve, `${path}.pipe[${index}]`)
      )
    ]
  }
  if (Object.prototype.hasOwnProperty.call(data, 'fallback')) context.fallbackValue = data.fallback
  return serialize(context)
}

/** Keeps noncanonical and legacy strings intact; exported YAML must restore the exact stored expression. */
export function encodeAuthoringPipeline (
  source: string,
  resolve: Resolve,
  environment: AuthoringOutputEnvironment = {}
): unknown | undefined {
  const context = parseContext(source)
  if (
    context === undefined ||
    serialize(context) !== source ||
    (context.type !== 'function' &&
      context.sourceFunction === undefined &&
      (context.functions?.length ?? 0) === 0 &&
      context.fallbackValue === undefined)
  ) {
    return undefined
  }
  const { sourceFunction, functions, fallbackValue, ...base } = context
  if (context.type === 'function' && (context.key !== '' || Object.keys(base).length !== 4)) return undefined
  const roleMatches = (func: Func, allowed: string[]): boolean => {
    const definition = authoringOperationContract(func.func, 'functions', environment)
    return definition?.type === undefined || allowed.includes(String(definition.type))
  }
  if (context.type === 'function' && !roleMatches(context, ['context'])) return undefined
  if (sourceFunction !== undefined && !roleMatches(sourceFunction, ['reduce'])) return undefined
  if (functions?.some((func) => !roleMatches(func, ['transform', 'convert'])) === true) return undefined
  const encodedStage = (func: Func): unknown => {
    const name = func.func.replace(/^process:function:/, '')
    return Object.keys(func.props).length === 0 ? name : { [name]: resolve(func.props, 'function') }
  }
  const expression: Record<string, unknown> = {}
  if (context.type === 'function' && context.key === '' && Object.keys(base).length === 4) {
    expression.call = encodedStage(context)
  } else {
    expression.from =
      context.type === 'const' && context.key === '' && Object.keys(base).length === 3
        ? { literal: context.value }
        : resolve(serialize(base), 'from')
  }
  if (sourceFunction !== undefined) expression.reduce = encodedStage(sourceFunction)
  if (functions !== undefined) expression.pipe = functions.map(encodedStage)
  if (Object.prototype.hasOwnProperty.call(context, 'fallbackValue')) expression.fallback = fallbackValue
  return { expr: expression }
}
