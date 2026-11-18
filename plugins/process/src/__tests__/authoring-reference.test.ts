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

import { compileProcessYaml } from '../authoring'
import { exportAuthoringModel, remapAuthoringReferences } from '../authoring-model'
import { decodeAuthoringType } from '../authoring-results'
import { expectEquivalentModel } from './authoring-test-utils'

const source = `version: 2
kind: card
cardTypes:
  record:
    label: Record
    extends: card:class:Card
    kind: 0
    fields:
      key_contact:
        name: keyContact
        type:
          class: core.RefTo
          to: contact.Person
          filters:
            - key: {_class: 'contact:class:Person', key: _class, component: 'view:component:ClassFilter'}
              mode: 'view:filter:FilterObjectNin'
              modes: ['view:filter:FilterObjectNin']
              value: ['contact:mixin:Employee']
              index: 0
      related_records:
        name: relatedRecords
        type:
          array:
            class: core.RefTo
            to: record
            filters:
              - key: {_class: record, key: _class, component: 'view:component:ClassFilter'}
                mode: 'view:filter:FilterObjectNin'
                modes: ['view:filter:FilterObjectNin']
                value: [internal_record]
                index: 0
  internal_record:
    label: Internal record
    extends: record
    kind: 0
`

const nativeArrayTypes: Array<Record<string, unknown>> = [
  {
    _class: 'core:class:ArrOf',
    label: 'custom:label:Array',
    futureOptions: { levels: [1, 2] },
    of: { _class: 'core:class:TypeNumber', label: 'core:string:Number', min: 0, digits: 2 }
  },
  {
    _class: 'core:class:ArrOf',
    label: 'core:string:Array',
    of: {
      _class: 'core:class:ArrOf',
      label: 'custom:label:NestedArray',
      of: { _class: 'core:class:RefTo', label: 'custom:label:Reference', to: 'record', futureOptions: [true] }
    }
  },
  {
    _class: 'core:class:ArrOf',
    label: 'core:string:Array',
    native: { futureValue: 'opaque' },
    of: { _class: 'core:class:TypeString', label: 'core:string:String' }
  },
  {
    _class: 'core:class:ArrOf',
    label: 'core:string:Array',
    of: {
      _class: 'extension:class:Type',
      label: 'extension:string:Type',
      class: 'literal class',
      native: { value: 'opaque' }
    }
  }
]

describe('reference selection constraints in authoring', () => {
  it('expands class and mixin names and preserves filters in YAML and native JSON round trips', () => {
    const compiled = compileProcessYaml(source)
    expect(compiled.docs.find((doc) => doc._id === 'key_contact')?.type).toEqual({
      _class: 'core:class:RefTo',
      to: 'contact:class:Person',
      filters: expect.any(String)
    })
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(compiled.docs, 'card')).docs, compiled.docs)
    const native = JSON.parse(JSON.stringify(compiled.docs)) as unknown[]
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(native, 'card')).docs, compiled.docs)
  })

  it('rebinds filters referencing local classes when a module is cloned', () => {
    const compiled = compileProcessYaml(source)
    const mapping = new Map([
      ['record', 'new_record'],
      ['internal_record', 'new_internal_record']
    ])
    const docs = remapAuthoringReferences(compiled.docs, mapping)
    expect(docs.find((doc) => doc._id === 'related_records')?.type).toEqual({
      _class: 'core:class:ArrOf',
      label: 'core:string:Array',
      of: { _class: 'core:class:RefTo', to: 'new_record', filters: expect.stringContaining('new_internal_record') }
    })
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(docs, 'card')).docs, docs)
  })

  it.each(nativeArrayTypes)('preserves arrays without filters and their native extensions: %j', (type) => {
    const compiled = compileProcessYaml(source)
    const field = compiled.docs.find((doc) => doc._id === 'related_records')
    if (field === undefined) throw new Error('The reference field fixture is missing')
    field.type = type
    const before = JSON.stringify(compiled.docs)
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(compiled.docs, 'card')).docs, compiled.docs)
    expect(JSON.stringify(compiled.docs)).toBe(before)
  })

  it('rejects malformed condition lists', () => {
    const type: Record<string, unknown> = { class: 'core.RefTo', to: 'contact.Person', filters: '{}' }
    expect(() => decodeAuthoringType(type, 'type')).toThrow('type.filters')
  })
})
