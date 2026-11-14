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

import { fail, object, text } from './authoring-validation'
import { createContext } from './dslContext'
import { parseContext } from './utils'
import type { ContextId } from './index'
import { decodeAuthoringPipeline, encodeAuthoringPipeline } from './authoring-pipelines'
import type { AuthoringOutputEnvironment } from './authoring-contracts'

const SYMBOL = /^[A-Za-z_][\w-]*$/
const SELECTOR = /^[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*$/
const PREFIX = /^\$(slots|card|context)\./

export interface AuthoringReferenceScope {
  slots: Record<string, unknown>
  contexts: Record<string, unknown>
  environment?: AuthoringOutputEnvironment
}

/** Short class names are structural; literal dotted model ids use an explicit ref. */
export function authoringClassName (value: unknown, decode: boolean): unknown {
  if (decode && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return text(object(value, 'class', ['ref']).ref, 'class.ref')
  }
  if (typeof value !== 'string') return value
  if (decode) {
    return value.replace(/^([\w-]+)\.mixin\.([\w-]+)$/, '$1:mixin:$2').replace(/^([\w-]+)\.([\w-]+)$/, '$1:class:$2')
  }
  const short = value.replace(/^([\w-]+):class:([\w-]+)$/, '$1.$2').replace(/^([\w-]+):mixin:([\w-]+)$/, '$1.mixin.$2')
  return short === value && /^[\w-]+\.(?:mixin\.)?[\w-]+$/.test(value) ? { ref: value } : short
}

/** Resolves named references with explicit value/identity semantics, never parameter-name heuristics. */
export function decodeAuthoringReference (value: string, scope: AuthoringReferenceScope, path: string): string {
  const match = PREFIX.exec(value)
  if (match === null) return value
  const selector = value.slice(match[0].length)
  if (!SELECTOR.test(selector)) fail(path, 'Expected a named reference and optional field selector')
  const [name, ...parts] = selector.split('.')
  const key = parts.join('.')
  if (match[1] === 'context') {
    if (!Object.prototype.hasOwnProperty.call(scope.contexts, name)) fail(path, `Unknown output ${name}`)
    return createContext({ type: 'context', id: name as ContextId, key })
  }
  const slot = Object.prototype.hasOwnProperty.call(scope.slots, name) ? scope.slots[name] : undefined
  if (match[1] === 'slots' && slot === undefined) fail(path, `Unknown slot ${name}`)
  if (match[1] === 'card' && slot !== undefined && object(slot, path).slotKind !== 'attribute') {
    fail(path, 'A card value reference needs an attribute slot')
  }
  const field = slot === undefined ? name : `__SLOT_${name}__`
  const reference = key === '' ? field : `${field}.${key}`
  return match[1] === 'slots'
    ? reference
    : key === ''
      ? createContext({ type: 'attribute', key: field })
      : createContext({ type: 'nested', path: field, key })
}

/** Uses shorthand only when it restores the original native expression exactly. */
function encodeReference (value: string): string {
  const slot = /^__SLOT_(.+)__$/.exec(value)?.[1]
  if (slot !== undefined && SYMBOL.test(slot)) return `$slots.${slot}`
  if (!value.startsWith('${') || !value.endsWith('}')) return value
  const context = parseContext(value)
  if (
    context === undefined ||
    createContext(context) !== value ||
    context.sourceFunction !== undefined ||
    (context.functions?.length ?? 0) > 0 ||
    context.fallbackValue !== undefined
  ) {
    return value
  }
  if (context.type === 'context' && SYMBOL.test(context.id) && (context.key === '' || SELECTOR.test(context.key))) {
    return `$context.${context.id}${context.key === '' ? '' : '.' + context.key}`
  }
  if (context.type !== 'attribute' && context.type !== 'nested') return value
  const field = context.type === 'nested' ? context.path : context.key
  const name = /^__SLOT_(.+)__$/.exec(field)?.[1] ?? field
  if (!SYMBOL.test(name) || (context.type === 'nested' && !SELECTOR.test(context.key))) return value
  return `$card.${name}${context.type === 'nested' ? '.' + context.key : ''}`
}

/** Translates params/query values, preserving literal reference-looking strings and objects. */
export function authoringReferenceValues (
  value: unknown,
  decode: boolean,
  scope: AuthoringReferenceScope,
  path: string
): unknown {
  if (typeof value === 'string') {
    if (decode) return decodeAuthoringReference(value, scope, path)
    if (PREFIX.test(value)) return { literal: value }
    return (
      encodeAuthoringPipeline(
        value,
        (value, at) => authoringReferenceValues(value, false, scope, at),
        scope.environment
      ) ?? encodeReference(value)
    )
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => authoringReferenceValues(item, decode, scope, `${path}[${index}]`))
  }
  if (value === null || typeof value !== 'object') return value
  const data = object(value, path)
  if (Object.keys(data).length === 1 && Object.prototype.hasOwnProperty.call(data, 'literal')) {
    return decode ? data.literal : { literal: data }
  }
  if (Object.keys(data).length === 1 && Object.prototype.hasOwnProperty.call(data, 'expr')) {
    return decode
      ? decodeAuthoringPipeline(
          data.expr,
          scope.environment ?? {},
          (value, at) => authoringReferenceValues(value, true, scope, at),
          `${path}.expr`
        )
      : { literal: data }
  }
  return Object.fromEntries(
    Object.entries(data).map(([key, child]) => {
      const name = decode
        ? key.startsWith('$literal:')
          ? key.slice(9)
          : decodeAuthoringReference(key, scope, `${path}.${key}`)
        : PREFIX.test(key) || key.startsWith('$literal:')
          ? '$literal:' + key
          : encodeReference(key)
      return [name, authoringReferenceValues(child, decode, scope, `${path}.${key}`)]
    })
  )
}

/** Structural class/slot ownership references do not interpret ordinary text or expressions. */
export function authoringSlotReferences (
  value: unknown,
  decode: boolean,
  scope: AuthoringReferenceScope,
  path: string
): unknown {
  if (typeof value === 'string') {
    return decode
      ? value.startsWith('$slots.')
        ? decodeAuthoringReference(value, scope, path)
        : value
      : /^__SLOT_.+__$/.test(value)
        ? encodeReference(value)
        : value
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => authoringSlotReferences(item, decode, scope, `${path}[${index}]`))
  }
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      ['label', 'name', 'description', 'enumValues', 'defaultValue', 'value', 'native'].includes(key)
        ? child
        : authoringSlotReferences(child, decode, scope, `${path}.${key}`)
    ])
  )
}
