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

import { expectEquivalentModel } from './authoring-test-utils'
import { load } from 'js-yaml'
import { compileProcessYaml, validateProcessYaml } from '../authoring'
import { exportProcessYaml } from '../authoring-export'

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const example = (name: string): string => readFileSync(`${__dirname}/../../docs/examples/${name}`, 'utf8')

describe('YAML export and editor validation', () => {
  it('preserves explicit enum conversion on a plain number', () => {
    const result = compileProcessYaml(
      'version: 2\nkind: process\nprocesses:\n  numeric_copy:\n    label: Numeric copy\n    slots: {score: {type: number}}\n    start:\n      begin:\n        to: done\n        on: OnExecutionStart\n        actions:\n          copy_score:\n            method: UpdateCard\n            params: {$slots.score: $card.score}\n    states: {done: {}}\n'
    )
    const start = result.docs.find((doc) => doc.from === null)
    ;(start?.actions as Array<{ params: Record<string, string> }>)[0].params.__SLOT_score__ =
      '${@__SLOT_score__=>StringFromEnum()=>NumberFromString()}'
    const yaml = exportProcessYaml(result.docs, 'process')
    expect(compileProcessYaml(yaml).version).toBe(2)
    expectEquivalentModel(compileProcessYaml(yaml).docs, result.docs)
  })

  it.each(['risk-management.card.yaml', 'review-task.process.yaml'])('exports a reimportable DSL for %s', (file) => {
    const original = compileProcessYaml(example(file))
    const source = exportProcessYaml(original.docs, original.kind)
    const result = compileProcessYaml(source)
    expect(result.kind).toBe(original.kind)
    expect(result.docs).toHaveLength(original.docs.length)
    expect(result.version).toBe(2)
    expect(source).toContain(original.kind === 'card' ? 'cardTypes:' : 'processes:')
    expectEquivalentModel(result.docs, original.docs)
    expect(validateProcessYaml(source, original.kind)).toEqual({ valid: true })
    expect(result.docs.filter((doc) => doc._class === 'process:class:Transition').map((doc) => doc.trigger)).toEqual(
      original.docs.filter((doc) => doc._class === 'process:class:Transition').map((doc) => doc.trigger)
    )
  })

  it('exports the existing risk JSON without losing enums, calculations or branch predicates', () => {
    const docs = JSON.parse(example('risk-management.module.json')) as unknown[]
    const source = exportProcessYaml(docs, 'card')
    const result = compileProcessYaml(source)
    expect(result.docs.filter((doc) => doc._class === 'core:class:Enum')).toHaveLength(2)
    expect(source).toContain('Risk scale 1–5')
    expect(source).toContain('Multiply')
    expect(source).toContain('$gte: 9')
    expect(source).toContain('$lte: 16')
    expectEquivalentModel(result.docs, docs as typeof result.docs)
  })

  it('preserves task context labels and explicit execution settings from native JSON', () => {
    const docs = JSON.parse(example('review-task.process.json')) as Array<Record<string, unknown>>
    docs[0].parallelExecutionForbidden = false
    docs[0].automationOnly = true
    const result = compileProcessYaml(exportProcessYaml(docs, 'process'))
    const definition = result.docs.find((doc) => doc._class === 'process:class:Process')
    expect(definition).toEqual(expect.objectContaining({ parallelExecutionForbidden: false, automationOnly: true }))
    expect(Object.values(definition?.context as Record<string, { name: string }>)[0].name).toBe('Review tasks')
  })

  it('preserves branch and action order even if exported documents are shuffled', () => {
    const original = compileProcessYaml(example('review-task.process.yaml'))
    const result = compileProcessYaml(exportProcessYaml([...original.docs].reverse(), 'process'))
    const start = result.docs.find((doc) => doc.from === null)
    expect((start?.actions as Array<{ methodId: string }>).map((action) => action.methodId)).toEqual([
      'process:method:UpdateCard',
      'process:method:CreateToDo'
    ])
  })

  it('preserves all operations and metadata in the full model representation', () => {
    const result = compileProcessYaml(example('review-task.process.yaml'))
    const transition = result.docs.find((doc) => doc.from === null)
    ;(transition?.actions as Array<{ methodId: string }>)[0].methodId = 'process:method:LockCard'
    expectEquivalentModel(compileProcessYaml(exportProcessYaml(result.docs, 'process')).docs, result.docs)
    const risk = compileProcessYaml(example('risk-management.card.yaml'))
    risk.docs.push({ _id: 'permission', _class: 'core:class:ClassPermission', space: 'core:space:Model' })
    expectEquivalentModel(compileProcessYaml(exportProcessYaml(risk.docs, 'card')).docs, risk.docs)
    const simple = compileProcessYaml(example('review-task.process.yaml'))
    simple.docs[0].resultType = { _class: 'core:class:TypeNumber' }
    expectEquivalentModel(compileProcessYaml(exportProcessYaml(simple.docs, 'process')).docs, simple.docs)
  })

  it('does not mutate documents while serializing', () => {
    const result = compileProcessYaml(example('risk-management.card.yaml'))
    const before = JSON.stringify(result.docs)
    exportProcessYaml(result.docs, 'card')
    expect(JSON.stringify(result.docs)).toBe(before)
  })

  it('supports definitions without external slots', () => {
    const source =
      'version: 2\nkind: process\nprocesses:\n  empty:\n    label: Empty\n    slots: {}\n    start: {begin: {to: done, on: OnExecutionStart}}\n    states: {done: {}}\n'
    const result = compileProcessYaml(source)
    expect(compileProcessYaml(exportProcessYaml(result.docs, 'process')).docs).toHaveLength(3)
  })

  it('returns parser positions and semantic paths without throwing', () => {
    expect(validateProcessYaml('version: [')).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostic: expect.objectContaining({ line: expect.any(Number), column: expect.any(Number) })
      })
    )
    expect(
      validateProcessYaml(example('risk-management.card.yaml').replace('to: calculate_score', 'to: missing'))
    ).toEqual(
      expect.objectContaining({
        valid: false,
        diagnostic: expect.objectContaining({ path: 'processes.risk_assessment.start.begin_assessment.to' })
      })
    )
    expect(validateProcessYaml(example('risk-management.card.yaml'), 'process').diagnostic?.path).toBe('kind')
    expect(
      load(exportProcessYaml(compileProcessYaml(example('review-task.process.yaml')).docs, 'process'))
    ).toBeDefined()
  })
})
