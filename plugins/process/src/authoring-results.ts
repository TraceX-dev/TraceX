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

import { authoringDataEqual, fail, object, text } from './authoring-validation'
import { authoringClassName } from './authoring-references'

const TYPES: Record<string, Record<string, unknown>> = {
  string: { _class: 'core:class:TypeString', label: 'core:string:String' },
  number: { _class: 'core:class:TypeNumber', label: 'core:string:Number' },
  boolean: { _class: 'core:class:TypeBoolean', label: 'core:string:Boolean' },
  date: { _class: 'core:class:TypeDate', label: 'core:string:Date' },
  markup: { _class: 'core:class:TypeMarkup', label: 'core:string:Markup' }
}

/** Uses verified platform type constructors; unknown types retain their full model properties. */
export function decodeAuthoringType (value: unknown, path: string): Record<string, unknown> {
  if (typeof value === 'string') {
    if (!Object.prototype.hasOwnProperty.call(TYPES, value)) {
      fail(path, 'Unknown scalar type; use a full model type for extensions')
    }
    return { ...TYPES[value] }
  }
  const data = object(value, path)
  if (Object.keys(data).length === 1 && data.native !== undefined) {
    const native = object(data.native, `${path}.native`)
    text(native._class, `${path}.native._class`)
    return { ...native }
  }
  if (Object.keys(data).length === 1) {
    if (data.array !== undefined) {
      return {
        _class: 'core:class:ArrOf',
        label: 'core:string:Array',
        of: decodeAuthoringType(data.array, `${path}.array`)
      }
    }
    if (data.ref !== undefined) {
      return {
        _class: 'core:class:RefTo',
        label: 'core:string:Ref',
        to: text(authoringClassName(data.ref, true), `${path}.ref`)
      }
    }
    if (data.enum !== undefined) {
      return { _class: 'core:class:EnumOf', label: 'core:string:Enum', of: text(data.enum, `${path}.enum`) }
    }
  }
  if (data.class !== undefined && data._class !== undefined) fail(path, 'Use either class or _class')
  const { class: clazz, ...result } = data
  result._class = text(data._class ?? authoringClassName(clazz, true), `${path}.class`)
  if (result._class === 'core:class:ArrOf') result.of = decodeAuthoringType(data.of, `${path}.of`)
  if (result._class === 'core:class:RefTo') result.to = text(authoringClassName(data.to, true), `${path}.to`)
  if (result._class === 'core:class:EnumOf') text(data.of, `${path}.of`)
  return result
}

/** A shorthand is emitted only if decoding reproduces every type property. */
export function encodeAuthoringType (value: unknown): unknown {
  const type = object(value, 'type')
  for (const [key, candidate] of Object.entries(TYPES)) if (authoringDataEqual(type, candidate)) return key
  let short: unknown
  if (type._class === 'core:class:ArrOf') short = { array: encodeAuthoringType(type.of) }
  if (type._class === 'core:class:RefTo' && typeof type.to === 'string') {
    short = { ref: authoringClassName(type.to, false) }
  }
  if (type._class === 'core:class:EnumOf') short = { enum: type.of }
  if (short !== undefined && authoringDataEqual(decodeAuthoringType(short, 'type'), type)) return short
  // Extension properties colliding with type syntax remain opaque.
  if (type.class !== undefined || type.native !== undefined) return { native: type }
  const { _class, ...properties } = type
  if (_class === 'core:class:ArrOf') properties.of = encodeAuthoringType(type.of)
  if (_class === 'core:class:RefTo') properties.to = authoringClassName(type.to, false)
  return { class: authoringClassName(_class, false), ...properties }
}

function nextIndex (contexts: Record<string, unknown>): number {
  return Math.max(0, ...Object.values(contexts).map((value) => Number(object(value, 'context').index) || 0)) + 1
}

/** Generates the same typed context metadata as the engine's result synchronization. */
export function publishAuthoringResults (
  value: unknown,
  action: Record<string, unknown>,
  producer: string,
  contexts: Record<string, unknown>,
  path: string,
  resolve: (value: unknown, path: string) => unknown
): void {
  action.results = Object.entries(object(value, path)).map(([id, value]) => {
    const at = `${path}.${id}`
    if (Object.prototype.hasOwnProperty.call(contexts, id)) fail(at, `Duplicate output ${id}`)
    const data = object(value, at, ['type', 'label', 'field', 'order', 'selectionSpace', 'excludeRelation', 'native'])
    const native = object(data.native ?? {}, `${at}.native`)
    for (const key of ['_id', 'name', 'type', 'key', 'selectionSpace', 'excludeRelation']) {
      if (Object.prototype.hasOwnProperty.call(native, key)) {
        fail(`${at}.native.${key}`, 'Result wiring is generated; use the corresponding result property')
      }
    }
    const type = decodeAuthoringType(data.type, `${at}.type`)
    const name = data.label === undefined ? id : data.label
    if (typeof name !== 'string') fail(`${at}.label`, 'Expected a string')
    const parent = type._class === 'core:class:ArrOf' ? object(type.of, `${at}.type.of`) : type
    const clazz = parent._class === 'core:class:RefTo' ? parent.to : parent._class
    const index = data.order === undefined ? nextIndex(contexts) : data.order
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      fail(`${at}.order`, 'Expected a nonnegative integer')
    }
    const result: Record<string, unknown> = { ...native, _id: id, name, type }
    if (data.field !== undefined) {
      result.key = text(resolve(data.field, `${at}.field`), `${at}.field`)
      if (String(result.key).startsWith('${')) {
        fail(`${at}.field`, 'Expected a field identity, not a card/context value')
      }
    }
    if (data.selectionSpace !== undefined) result.selectionSpace = resolve(data.selectionSpace, `${at}.selectionSpace`)
    if (data.excludeRelation !== undefined) {
      result.excludeRelation = resolve(data.excludeRelation, `${at}.excludeRelation`)
    }
    contexts[id] = {
      name,
      isResult: true,
      type,
      action: action._id,
      _class: clazz,
      index,
      producer,
      value: { type: 'context', id, key: '' }
    }
    return result
  })
}

/** Returns named results only when every associated context can be reconstructed exactly. */
export function compactAuthoringResults (
  action: Record<string, unknown>,
  producer: string,
  contexts: Record<string, unknown>,
  remaining: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!Array.isArray(action.results) || action.results.length === 0) return undefined
  const result: Record<string, unknown> = {}
  for (const value of action.results) {
    const item = object(value, 'result')
    if (typeof item._id !== 'string' || Object.prototype.hasOwnProperty.call(result, item._id)) return undefined
    if (
      item.key !== undefined &&
      (typeof item.key !== 'string' || item.key.trim() === '' || item.key.startsWith('${'))
    ) {
      return undefined
    }
    const context = contexts[item._id]
    if (context === null || context === undefined || typeof context !== 'object' || Array.isArray(context)) {
      return undefined
    }
    const data = object(context, 'context')
    const type = object(item.type, 'type')
    const parent = type._class === 'core:class:ArrOf' ? object(type.of, 'type.of') : type
    const clazz = parent._class === 'core:class:RefTo' ? parent.to : parent._class
    const expected = {
      name: item.name,
      isResult: true,
      type,
      action: action._id,
      _class: clazz,
      index: data.index,
      producer,
      value: { type: 'context', id: item._id, key: '' }
    }
    if (
      !authoringDataEqual(data, expected) ||
      typeof data.index !== 'number' ||
      !Number.isInteger(data.index) ||
      data.index < 0 ||
      typeof item.name !== 'string'
    ) {
      return undefined
    }
    const named: Record<string, unknown> = { type: encodeAuthoringType(type) }
    if (item.name !== item._id) named.label = item.name
    if (item.key !== undefined) named.field = item.key
    named.order = data.index
    if (item.selectionSpace !== undefined) named.selectionSpace = item.selectionSpace
    if (item.excludeRelation !== undefined) named.excludeRelation = item.excludeRelation
    const { _id, name, type: _type, key, selectionSpace, excludeRelation, ...native } = item
    if (Object.keys(native).length > 0) named.native = native
    result[item._id] = named
  }
  for (const id of Object.keys(result)) Reflect.deleteProperty(remaining, id)
  return result
}
