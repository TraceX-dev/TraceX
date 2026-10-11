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

import { isFormInputField, type FormField } from '@hcengineering/forms'
import { FormError, validateFields } from '../forms-validation'

const fields: FormField[] = [
  { name: 'title', label: '' as FormField['label'], kind: 'text', required: true },
  { name: 'count', label: '' as FormField['label'], kind: 'number', required: false },
  { name: 'enabled', label: '' as FormField['label'], kind: 'boolean', required: true },
  { name: 'state', label: '' as FormField['label'], kind: 'enum', values: ['new', 'done'], required: false },
  { name: 'details', label: '' as FormField['label'], kind: 'json', required: false }
]
const input = { title: 'Response', enabled: false }

describe('public Forms submission validation', () => {
  it('excludes identifiers and references from public input, including nested arrays', () => {
    const reference: FormField = { name: 'parent', label: '' as FormField['label'], kind: 'reference', required: true }
    const references: FormField = {
      name: 'related',
      label: reference.label,
      kind: 'array',
      required: false,
      item: reference
    }
    const nested: FormField = { ...references, name: 'nested', item: references }
    const excluded = [reference, references, nested, { ...fields[0], name: 'id' }, { ...fields[0], name: '_id' }]
    expect(excluded.filter(isFormInputField)).toEqual([])
    for (const field of excluded) {
      expect(() => validateFields(excluded.filter(isFormInputField), { [field.name]: 'injected' })).toThrow(FormError)
    }
  })

  it('keeps ordinary input fields and arrays of scalar values', () => {
    const allowed: FormField[] = [
      ...fields,
      {
        name: 'numbers',
        label: fields[0].label,
        kind: 'array',
        required: false,
        item: { name: 'item', label: fields[0].label, kind: 'number', required: true }
      }
    ]
    expect(allowed.filter(isFormInputField)).toEqual(allowed)
  })

  it('preserves false and zero, and omits empty optional values', () => {
    expect(validateFields(fields, { ...input, count: 0, state: '' })).toEqual({ ...input, count: 0 })
  })

  it.each(['_class', 'space', 'modifiedBy', 'hiddenField', 'readonlyField', '__proto__'])(
    'rejects fields outside the dynamically generated schema: %s',
    (name) => {
      const request = JSON.parse(JSON.stringify(input).slice(0, -1) + `,"${name}":"injected"}`)
      expect(() => validateFields(fields, request)).toThrow(FormError)
    }
  )

  it.each([undefined, null, '', '   '])('rejects missing required titles: %s', (title) => {
    expect(() => validateFields(fields, { ...input, title })).toThrow(FormError)
  })

  it.each([NaN, Infinity, '5', true])('rejects invalid numeric values: %s', (count) => {
    expect(() => validateFields(fields, { ...input, count })).toThrow(FormError)
  })

  it('rejects values outside the current enum', () => {
    expect(() => validateFields(fields, { ...input, state: 'removed' })).toThrow(FormError)
  })

  it('rejects nested prototype and operator keys', () => {
    for (const details of [JSON.parse('{"__proto__":{"admin":true}}'), { nested: { $set: {} } }, { 'a.b': 1 }]) {
      expect(() => validateFields(fields, { ...input, details })).toThrow(FormError)
    }
  })

  it('limits JSON nesting and array sizes', () => {
    let details: unknown = 'leaf'
    for (let i = 0; i < 10; i++) details = { nested: details }
    expect(() => validateFields(fields, { ...input, details })).toThrow(FormError)
    expect(() => validateFields(fields, { ...input, details: Array(101).fill(0) })).toThrow(FormError)
  })

  it('validates array items using their underlying type', () => {
    const arrayField: FormField = {
      name: 'numbers',
      label: '' as FormField['label'],
      kind: 'array',
      required: false,
      item: { name: 'item', label: '' as FormField['label'], kind: 'number', required: true }
    }
    expect(validateFields([arrayField], { numbers: [0, 1] })).toEqual({ numbers: [0, 1] })
    expect(() => validateFields([arrayField], { numbers: [0, '1'] })).toThrow(FormError)
  })

  it('accepts multiple enum selections and rejects unknown choices', () => {
    const arrayField: FormField = { ...fields[3], name: 'states', kind: 'array', item: fields[3] }
    expect(isFormInputField(arrayField)).toBe(true)
    expect(validateFields([arrayField], { states: ['new', 'done'] })).toEqual({ states: ['new', 'done'] })
    expect(validateFields([arrayField], { states: [] })).toEqual({ states: [] })
    expect(() => validateFields([arrayField], { states: ['new', 'removed'] })).toThrow(FormError)
    expect(() => validateFields([arrayField], { states: '["new"]' })).toThrow(FormError)
  })
})
