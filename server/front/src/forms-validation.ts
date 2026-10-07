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

import type { FormField } from '@hcengineering/forms'

export class FormError extends Error {
  constructor (
    readonly status: number,
    readonly code: string
  ) {
    super(code)
    this.name = 'FormError'
  }
}

export function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function validateField (field: FormField, value: unknown): unknown {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (field.required && field.defaultValue === undefined) throw new FormError(400, 'required')
    return undefined
  }
  switch (field.kind) {
    case 'boolean':
      if (typeof value !== 'boolean') throw new FormError(400, 'invalid_field')
      break
    case 'number':
    case 'date':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new FormError(400, 'invalid_field')
      break
    case 'enum':
      if (typeof value !== 'string' || !field.values?.includes(value)) throw new FormError(400, 'invalid_field')
      break
    case 'array': {
      if (!Array.isArray(value) || value.length > 100 || field.item === undefined) {
        throw new FormError(400, 'invalid_field')
      }
      const itemField = field.item
      return value.map((item) => validateField({ ...itemField, required: true }, item))
    }
    case 'json':
      validateJson(value)
      break
    default:
      if (typeof value !== 'string' || value.length > 100000) throw new FormError(400, 'invalid_field')
  }
  return value
}

export function validateJson (value: unknown, depth: number = 0): void {
  if (depth > 8) throw new FormError(400, 'invalid_field')
  if (typeof value === 'number' && !Number.isFinite(value)) throw new FormError(400, 'invalid_field')
  if (typeof value === 'string' && value.length > 100000) throw new FormError(400, 'invalid_field')
  if (Array.isArray(value)) {
    if (value.length > 100) throw new FormError(400, 'invalid_field')
    for (const item of value) validateJson(item, depth + 1)
  } else if (isRecord(value)) {
    if (Object.keys(value).length > 100) throw new FormError(400, 'invalid_field')
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key) || key.startsWith('$') || key.includes('.')) {
        throw new FormError(400, 'invalid_field')
      }
      validateJson(item, depth + 1)
    }
  } else if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
    throw new FormError(400, 'invalid_field')
  }
}

export function validateFields (fields: FormField[], input: unknown): Record<string, unknown> {
  if (!isRecord(input)) throw new FormError(400, 'invalid_field')
  const allowed = new Set(fields.map((field) => field.name))
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new FormError(400, 'invalid_field')
  const result: Record<string, unknown> = {}
  for (const field of fields) {
    const value = validateField(field, input[field.name])
    if (value !== undefined) result[field.name] = value
  }
  return result
}
