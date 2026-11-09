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
import { decodeAuthoringType, encodeAuthoringType } from '../authoring-results'
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
          excludedClasses: [contact.mixin.Employee]
      related_records:
        name: relatedRecords
        type:
          array:
            class: core.RefTo
            to: record
            excludedClasses: [internal_record]
  internal_record:
    label: Internal record
    extends: record
    kind: 0
`

describe('reference selection constraints in authoring', () => {
  it('expands class and mixin names and preserves exclusions in YAML and native JSON round trips', () => {
    const compiled = compileProcessYaml(source)
    expect(compiled.docs.find((doc) => doc._id === 'key_contact')?.type).toEqual({
      _class: 'core:class:RefTo',
      to: 'contact:class:Person',
      excludedClasses: ['contact:mixin:Employee']
    })
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(compiled.docs, 'card')).docs, compiled.docs)
    const native = JSON.parse(JSON.stringify(compiled.docs)) as unknown[]
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(native, 'card')).docs, compiled.docs)
  })

  it('rebinds exclusions referencing local classes when a module is cloned', () => {
    const compiled = compileProcessYaml(source)
    const mapping = new Map([
      ['record', 'new_record'],
      ['internal_record', 'new_internal_record']
    ])
    const docs = remapAuthoringReferences(compiled.docs, mapping)
    expect(docs.find((doc) => doc._id === 'related_records')?.type).toEqual({
      _class: 'core:class:ArrOf',
      label: 'core:string:Array',
      of: { _class: 'core:class:RefTo', to: 'new_record', excludedClasses: ['new_internal_record'] }
    })
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(docs, 'card')).docs, docs)
  })

  it('rejects malformed exclusions at their type property path', () => {
    const type: Record<string, unknown> = { class: 'core.RefTo', to: 'contact.Person', excludedClasses: 'Employee' }
    expect(() => decodeAuthoringType(type, 'type')).toThrow('type.excludedClasses')
    type.excludedClasses = [42]
    expect(() => decodeAuthoringType(type, 'type')).toThrow('type.excludedClasses[0]')
  })

  it('retains explicit dotted class identities in exclusions', () => {
    const type: Record<string, unknown> = {
      _class: 'core:class:RefTo',
      to: 'contact:class:Person',
      excludedClasses: ['custom.Employee']
    }
    expect(decodeAuthoringType(encodeAuthoringType(type), 'type')).toEqual(type)
  })
})
