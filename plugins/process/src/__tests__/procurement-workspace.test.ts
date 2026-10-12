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

/* eslint-disable no-template-curly-in-string -- Fixtures intentionally use native process expressions. */

import { load } from 'js-yaml'
import { compileProcessYaml, validateProcessYaml } from '../authoring'
import { exportAuthoringModel } from '../authoring-model'
import { object } from '../authoring-validation'
import { expectEquivalentModel } from './authoring-test-utils'

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const source = readFileSync(`${__dirname}/../../docs/examples/procurement-workspace.card.yaml`, 'utf8')
const compiled = compileProcessYaml(source)
const byClass = (clazz: string): typeof compiled.docs => compiled.docs.filter((doc) => doc._class === clazz)

describe('procurement workspace card module', () => {
  it('contains the documented model and four embedded workflows with concrete owners', () => {
    expect(validateProcessYaml(source, 'card')).toEqual({ valid: true })
    expect(byClass('card:class:MasterTag')).toHaveLength(7)
    expect(byClass('card:class:Tag')).toHaveLength(2)
    expect(byClass('core:class:Enum')).toHaveLength(8)
    expect(byClass('core:class:Attribute')).toHaveLength(63)
    expect(byClass('core:class:Association')).toHaveLength(7)
    expect(byClass('process:class:Process')).toHaveLength(4)
    expect(new Set(compiled.docs.map((doc) => doc._id)).size).toBe(compiled.docs.length)
    expect(JSON.stringify(compiled.docs)).not.toMatch(/__SLOT_|__MASTER_TAG__/)
    for (const process of byClass('process:class:Process')) {
      expect(process.autoStart).toBe(false)
      expect(process.parallelExecutionForbidden).toBe(true)
      expect(byClass('card:class:MasterTag').some((type) => type._id === process.masterTag)).toBe(true)
    }
  })

  it('resolves every local field owner, enum, reference type, inheritance edge and association endpoint', () => {
    const types = [...byClass('card:class:MasterTag'), ...byClass('card:class:Tag')]
    const ids = new Set(types.map((doc) => doc._id))
    const enums = new Set(byClass('core:class:Enum').map((doc) => doc._id))
    const checkType = (value: unknown): void => {
      const type = object(value, 'type')
      if (type._class === 'core:class:ArrOf') checkType(type.of)
      if (type._class === 'core:class:RefTo') {
        expect(ids.has(String(type.to)) || type.to === 'contact:mixin:Employee').toBe(true)
      }
      if (type._class === 'core:class:EnumOf') expect(enums.has(String(type.of))).toBe(true)
    }
    for (const field of byClass('core:class:Attribute')) {
      expect(ids.has(String(field.attributeOf))).toBe(true)
      expect(field.isCustom).toBe(true)
      checkType(field.type)
    }
    for (const type of types) {
      expect(ids.has(String(type.extends)) || type.extends === 'card:class:Card').toBe(true)
      if (type._id !== 'pc_record' && type._class === 'card:class:MasterTag') expect(type.extends).toBe('pc_record')
    }
    for (const relation of byClass('core:class:Association')) {
      expect(ids.has(String(relation.classA))).toBe(true)
      expect(ids.has(String(relation.classB))).toBe(true)
    }
    expect(compiled.docs.find((doc) => doc._id === 'pc_project_requests')).toEqual(expect.objectContaining({
      classA: 'pc_request', classB: 'pc_project', type: '1:N'
    }))
    expect(compiled.docs.find((doc) => doc._id === 'pc_delivery_primary_invoice')?.type).toBe('1:1')
  })

  it('round-trips every native value and ranked order without modifying the compiled model', () => {
    const before = JSON.stringify(compiled.docs)
    const root = object(load(source), 'root')
    const exported = exportAuthoringModel(compiled.docs, 'card', object(root.catalog, 'catalog'))
    expectEquivalentModel(compileProcessYaml(exported).docs, compiled.docs)
    expect(JSON.stringify(compiled.docs)).toBe(before)
  })

  it('keeps task completion modes, typed outputs and their producing transitions explicit', () => {
    const transitions = byClass('process:class:Transition')
    const actions = transitions.flatMap((doc) => doc.actions as Array<Record<string, unknown>>)
    const task = (id: string): Record<string, unknown> => object(actions.find((action) => action._id === id), id)
    expect(object(task('pc_project_create_reviews').params, 'params').completionMode).toBe('all')
    for (const id of ['pc_purchase_collect_quote', 'pc_delivery_create_inspection']) {
      expect(object(task(id).params, 'params')).toEqual(expect.objectContaining({
        completionMode: 'any', withRollback: true, askRequired: true
      }))
    }
    for (const process of byClass('process:class:Process')) {
      for (const [key, value] of Object.entries(object(process.context, 'context'))) {
        const context = object(value, 'context')
        const producer = transitions.find((doc) => doc._id === context.producer)
        expect(producer?.process).toBe(process._id)
        const step = (producer?.actions as Array<Record<string, unknown>>).find((action) => action._id === context.action)
        expect(step).toBeDefined()
        const result = (step?.results as Array<{ _id: string }> | undefined)?.find((result) => result._id === key)
        expect(object(step?.context ?? {}, 'context')._id === key || result !== undefined).toBe(true)
      }
    }
    const inspector = task('pc_delivery_create_inspection').results as Array<Record<string, unknown>>
    expect(inspector.map((result) => object(result.type, 'type')._class)).toEqual([
      'core:class:TypeNumber', 'core:class:TypeBoolean'
    ])
  })

  it('reads invoice snapshots through reference fields and unlocks before writing both approval outcomes', () => {
    const snapshot = (compiled.docs.find((doc) => doc._id === 'pc_invoice_start')?.actions as Array<Record<string, unknown>>)[0]
    expect(snapshot.params).toEqual({
      request_title: '${@purchase_request.title}',
      request_status: '${@purchase_request.status}',
      supplier: '${@purchase_request.supplier}',
      status: 'Checking request'
    })
    for (const id of ['pc_invoice_approval_accepted', 'pc_invoice_approval_rejected']) {
      const actions = compiled.docs.find((doc) => doc._id === id)?.actions as Array<Record<string, unknown>>
      expect(actions.map((action) => action.methodId)).toEqual([
        'process:method:UnlockCard', 'process:method:UpdateCard'
      ])
    }
  })
})
