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
import { authoringClassName } from './authoring-references'
import { authoringOperationContract, type AuthoringOutputEnvironment } from './authoring-contracts'
import { parseContext } from './utils'

export type { AuthoringOutputEnvironment } from './authoring-contracts'

function outputName (action: Record<string, unknown>, definition: Record<string, unknown> | undefined): string {
  const created = definition?.createdContext
  if (created === null || created === undefined) return ''
  const field = object(created, 'createdContext').nameField
  const value = typeof field === 'string' ? object(action.params, 'params')[field] : undefined
  return typeof value === 'string' && parseContext(value) === undefined ? value : ''
}

function outputClass (created: unknown, path: string): unknown {
  const data = object(created, path)
  return data._class ?? authoringClassName(data.class, true)
}

/** Generates the same wiring used by native action contexts; no operation-specific handlers. */
export function publishAuthoringOutput (
  value: unknown,
  action: Record<string, unknown>,
  producer: string,
  contexts: Record<string, unknown>,
  environment: AuthoringOutputEnvironment,
  path: string
): void {
  const data =
    typeof value === 'string' ? { key: value } : object(value, path, ['key', 'class', 'label', 'order', 'native'])
  const id = text(data.key, `${path}.key`)
  if (['__proto__', 'prototype', 'constructor'].includes(id)) fail(`${path}.key`, 'Reserved output name')
  if (Object.prototype.hasOwnProperty.call(contexts, id)) fail(path, `Duplicate output ${id}`)
  const method = authoringOperationContract(String(action.methodId), 'methods', environment)
  if (environment.model !== undefined && method === undefined) {
    fail(path, `Method ${String(action.methodId)} is not registered in the destination model`)
  }
  const created = method?.createdContext
  if (created === null) {
    fail(
      path,
      `Method ${String(action.methodId)} does not declare an output; use an explicit native context for existing data`
    )
  }
  const clazz = data.class ?? (created === undefined ? undefined : outputClass(created, path))
  if (clazz === undefined) {
    fail(
      path,
      `Missing output contract for ${String(action.methodId)}; supply the installed model, catalog or an explicit output class`
    )
  }
  text(clazz, `${path}.class`)
  const next =
    Math.max(
      0,
      ...Object.values(contexts).map((value) => {
        const index = object(value, path).index
        return typeof index === 'number' && Number.isFinite(index) ? index : 0
      })
    ) + 1
  const index = data.order ?? next
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    fail(`${path}.order`, 'Expected a nonnegative integer')
  }
  const native = object(data.native ?? {}, `${path}.native`)
  for (const key of ['name', '_class', 'action', 'producer', 'index', 'value']) {
    if (Object.prototype.hasOwnProperty.call(native, key)) {
      fail(`${path}.native.${key}`, 'Output wiring is generated; use label, class or order for overrides')
    }
  }
  action.context = { _id: id, _class: clazz }
  contexts[id] = {
    ...native,
    name:
      data.label === undefined
        ? outputName(action, method)
        : typeof data.label === 'string'
          ? data.label
          : fail(`${path}.label`, 'Expected a string'),
    _class: clazz,
    action: action._id,
    producer,
    index,
    value: { type: 'context', id, key: '' }
  }
}

/** Compacts only faithfully reproducible contexts; unusual native metadata remains explicit. */
export function compactAuthoringOutput (
  action: Record<string, unknown>,
  producer: string,
  contexts: Record<string, unknown>,
  environment: AuthoringOutputEnvironment,
  remaining: Record<string, unknown>
): unknown | undefined {
  if (action.context === null || action.context === undefined) return undefined
  const context = object(action.context, 'context')
  if (Object.keys(context).some((key) => !['_id', '_class'].includes(key))) return undefined
  if (typeof context._class !== 'string' || context._class === '') return undefined
  const id = text(context._id, 'context._id')
  if (Array.isArray(action.results) && action.results.some((value: unknown) => object(value, 'result')._id === id)) {
    return undefined
  }
  const value = contexts[id]
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const published = object(value, 'context')
  if (published.value === null || typeof published.value !== 'object' || Array.isArray(published.value)) {
    return undefined
  }
  const selected = object(published.value, 'context.value')
  if (
    published.action !== action._id ||
    published.producer !== producer ||
    published._class !== context._class ||
    selected.id !== id ||
    selected.type !== 'context' ||
    selected.key !== '' ||
    Object.keys(selected).length !== 3
  ) {
    return undefined
  }
  if (
    typeof published.name !== 'string' ||
    typeof published.index !== 'number' ||
    !Number.isInteger(published.index) ||
    published.index < 0
  ) {
    return undefined
  }
  const method = authoringOperationContract(String(action.methodId), 'methods', environment)
  if (method === undefined || method.createdContext === undefined || method.createdContext === null) return undefined
  // Export only this output's type and label so offline imports need no operation catalog.
  const result: Record<string, unknown> = { key: id, class: context._class }
  if (published.name !== '') result.label = published.name
  // Preserve exported presentation order without exposing producer/action/value wiring.
  result.order = published.index
  const { name, _class, action: _action, producer: _producer, index, value: _value, ...native } = published
  if (Object.keys(native).length > 0) result.native = native
  Reflect.deleteProperty(remaining, id)
  return result
}
