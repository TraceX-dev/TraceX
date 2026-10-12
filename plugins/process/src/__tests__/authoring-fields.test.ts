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

import { dump, load } from 'js-yaml'
import { compileProcessYaml, validateProcessYaml } from '../authoring'
import { exportAuthoringModel } from '../authoring-model'
import { object } from '../authoring-validation'
import { expectEquivalentModel } from './authoring-test-utils'

function moduleSource (): Record<string, unknown> {
  return {
    version: 2,
    kind: 'card',
    cardTypes: {
      record: {
        label: 'Record', extends: 'card:class:Card', kind: 0, baseType: true,
        fields: {
          record_owner: { name: 'owner', label: 'Owner', type: { ref: 'contact.mixin.Employee' }, isCustom: true }
        }
      },
      purchase: {
        label: 'Purchase', extends: 'record', kind: 0,
        fields: {
          purchase_amount: { name: 'amount', label: 'Amount', type: 'number', isCustom: true, defaultValue: 0 },
          purchase_products: { name: 'products', type: { array: { ref: 'product' } }, isCustom: true }
        }
      },
      product: { label: 'Product', extends: 'record', kind: 0 }
    },
    tags: {
      audit: {
        label: 'Audit', extends: 'record', kind: 2,
        fields: { audit_passed: { name: 'passed', type: 'boolean', isCustom: true, defaultValue: false } }
      }
    }
  }
}

describe('fields nested in their card types and tags', () => {
  it('infers ownership without storing the YAML fields map on a type or copying inherited fields', () => {
    const { docs } = compileProcessYaml(dump(moduleSource()))
    const fields = docs.filter((doc) => doc._class === 'core:class:Attribute')
    expect(fields.map((doc) => [doc._id, doc.attributeOf, doc.name])).toEqual([
      ['record_owner', 'record', 'owner'],
      ['purchase_amount', 'purchase', 'amount'],
      ['purchase_products', 'purchase', 'products'],
      ['audit_passed', 'audit', 'passed']
    ])
    expect(fields.find((doc) => doc._id === 'purchase_amount')?.defaultValue).toBe(0)
    expect(fields.find((doc) => doc._id === 'audit_passed')?.defaultValue).toBe(false)
    expect(fields.find((doc) => doc._id === 'purchase_products')?.type).toEqual(expect.objectContaining({
      _class: 'core:class:ArrOf', of: expect.objectContaining({ _class: 'core:class:RefTo', to: 'product' })
    }))
    for (const doc of docs.filter((doc) => doc._class !== 'core:class:Attribute')) {
      expect(doc.fields).toBeUndefined()
    }
  })

  it('exports local fields under their owners and preserves native values, ids and field order', () => {
    const { docs } = compileProcessYaml(dump(moduleSource()))
    const before = JSON.stringify(docs)
    const source = exportAuthoringModel([...docs].reverse(), 'card')
    const layout = object(load(source), 'root')
    expect(layout.fields).toBeUndefined()
    const purchase = object(object(layout.cardTypes, 'cardTypes').purchase, 'purchase')
    const fields = object(purchase.fields, 'fields')
    expect(Object.keys(fields)).toEqual(['purchase_amount', 'purchase_products'])
    expect(object(fields.purchase_amount, 'amount').attributeOf).toBeUndefined()
    const audit = object(object(layout.tags, 'tags').audit, 'audit')
    expect(Object.keys(object(audit.fields, 'fields'))).toEqual(['audit_passed'])
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
    expect(JSON.stringify(docs)).toBe(before)
  })

  it('keeps externally owned attributes at the root when their class is outside the module', () => {
    const { docs } = compileProcessYaml(dump(moduleSource()))
    docs.push({
      _id: 'external_field', _class: 'core:class:Attribute', space: 'core:space:Model',
      attributeOf: 'external:class:Card', name: 'externalKey', type: { _class: 'core:class:TypeString' }
    })
    const source = exportAuthoringModel(docs, 'card')
    const layout = object(load(source), 'root')
    expect(Object.keys(object(layout.fields, 'fields'))).toEqual(['external_field'])
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
  })

  it('imports flat declarations and exports their local fields inside the owner', () => {
    const module = moduleSource()
    const owners = object(module.cardTypes, 'cardTypes')
    const purchase = object(owners.purchase, 'purchase')
    module.fields = Object.fromEntries(Object.entries(object(purchase.fields, 'fields')).map(([key, value]) => [
      key, { ...object(value, key), attributeOf: 'purchase' }
    ]))
    delete purchase.fields
    const { docs } = compileProcessYaml(dump(module))
    const source = exportAuthoringModel(docs, 'card')
    expect(object(load(source), 'root').fields).toBeUndefined()
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
  })

  it('preserves a native type property named fields separately from its owned attributes', () => {
    const { docs } = compileProcessYaml(dump(moduleSource()))
    const purchase = docs.find((doc) => doc._id === 'purchase')
    Object.assign(purchase ?? {}, { fields: { extensionOption: ['arbitrary', false] } })
    const source = exportAuthoringModel(docs, 'card')
    const layout = object(load(source), 'root')
    const owner = object(object(layout.cardTypes, 'cardTypes').purchase, 'purchase')
    expect(object(owner.native, 'native').fields).toEqual(purchase?.fields)
    expect(Object.keys(object(owner.fields, 'fields'))).toHaveLength(2)
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
  })

  it('reports invalid nested types at their authored path with a source location', () => {
    const source = dump(moduleSource()).replace('type: number', 'type: unsupported')
    const result = validateProcessYaml(source)
    expect(result).toEqual(expect.objectContaining({
      valid: false,
      diagnostic: expect.objectContaining({
        path: 'cardTypes.purchase.fields.purchase_amount.type', line: expect.any(Number), column: expect.any(Number)
      })
    }))
  })

  it.each(['explicit owner', 'escaped owner', 'duplicate identity', 'malformed fields'])(
    'rejects %s in nested field declarations',
    (problem) => {
      const module = moduleSource()
      const owners = object(module.cardTypes, 'cardTypes')
      const purchase = object(owners.purchase, 'purchase')
      const fields = object(purchase.fields, 'fields')
      if (problem === 'explicit owner') object(fields.purchase_amount, 'amount').attributeOf = 'record'
      if (problem === 'escaped owner') object(fields.purchase_amount, 'amount').native = { attributeOf: 'record' }
      if (problem === 'duplicate identity') fields.record_owner = { name: 'other', type: 'string' }
      if (problem === 'malformed fields') purchase.fields = []
      const result = validateProcessYaml(dump(module))
      expect(result.valid).toBe(false)
      expect(result.diagnostic?.path).toMatch(/^cardTypes\.purchase\.fields/)
    }
  )
})
