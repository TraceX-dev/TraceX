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

import { dump, load } from 'js-yaml'
import { compileProcessYaml, parseProcessImport, ProcessAuthoringError, validateProcessYaml } from '../authoring'
import { assertTree } from '../authoring-validation'
import { parseDSLContext } from '../dslContext'

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const example = (name: string): string => readFileSync(`${__dirname}/../../docs/examples/${name}`, 'utf8')
const risk = example('risk-management.card.yaml')
const review = example('review-task.process.yaml')

describe('YAML authoring', () => {
  it('does not repeatedly traverse shared YAML aliases', () => {
    let reads = 0
    const shared = {
      get value (): string {
        reads++
        return 'shared'
      }
    }
    assertTree({ first: shared, second: shared, third: shared })
    expect(reads).toBe(1)
  })

  it('checks the full nesting depth when an alias is reused deeper in the tree', () => {
    let shared: unknown = 'value'
    for (let i = 0; i < 20; i++) shared = { child: shared }
    let nested = shared
    for (let i = 0; i < 20; i++) nested = { child: nested }
    expect(() => {
      assertTree({ shared, nested })
    }).toThrow('Maximum nesting depth')
  })

  it('enforces the file limit in UTF-8 bytes', () => {
    expect(() => compileProcessYaml('#' + 'é'.repeat(600000))).toThrow('exceeds 1 MiB')
  })

  it.each([1, 3, undefined])('rejects unsupported schema revision %p with a version diagnostic', (version) => {
    const result = validateProcessYaml(dump({ version, kind: 'process', processes: {} }))
    expect(result.valid).toBe(false)
    expect(result.diagnostic?.path).toBe('version')
    expect(result.diagnostic?.message).toContain('Only version: 2 is supported')
  })

  it('rejects the removed single-process grammar', () => {
    expect(() => compileProcessYaml('version: 2\nkind: process\nprocess: {label: Old syntax}\n')).toThrow('process')
  })

  it('compiles the risk module with native fields, guarded calculations and event-driven waiting', () => {
    const result = compileProcessYaml(risk)
    expect(result.version).toBe(2)
    expect(result.kind).toBe('card')
    expect(new Set(result.docs.map((doc) => doc._id)).size).toBe(result.docs.length)
    const attrs = result.docs.filter((doc) => doc._class === 'core:class:Attribute')
    expect(attrs).toHaveLength(4)
    expect(attrs.find((doc) => doc.name === 'probability')?.defaultValue).toBe('1')
    expect(attrs.find((doc) => doc.name === 'score')?.automationOnly).toBe(true)
    const states = result.docs.filter((doc) => doc._class === 'process:class:State')
    const wait = states.find((doc) => doc.title === 'Wait for input changes')
    const transitions = result.docs.filter((doc) => doc._class === 'process:class:Transition')
    expect(transitions.filter((doc) => doc.from === wait?._id).map((doc) => doc.trigger)).toEqual([
      'process:trigger:WhenFieldChanges',
      'process:trigger:WhenFieldChanges'
    ])
    for (const transition of transitions) {
      expect(states.some((state) => state._id === transition.to)).toBe(true)
      if (transition.from !== null) expect(states.some((state) => state._id === transition.from)).toBe(true)
    }
    const actions = transitions.flatMap((doc) => doc.actions as Array<{ params: Record<string, unknown> }>)
    const expression = actions.find((action) => typeof action.params.score === 'string')?.params.score as string
    expect(parseDSLContext(expression)?.functions?.map((func) => func.func)).toEqual([
      'process:function:StringFromEnum',
      'process:function:NumberFromString',
      'process:function:Multiply'
    ])
    expect(transitions.find((doc) => doc._id === 'valid_inputs')?.triggerParams).toEqual({
      probability: { $in: ['1', '2', '3', '4', '5'] },
      severity: { $in: ['1', '2', '3', '4', '5'] }
    })
  })

  it('compiles reviewers/status slots and a named task group context', () => {
    const result = compileProcessYaml(review)
    const process = result.docs.find((doc) => doc._class === 'process:class:Process')
    expect(process?._id).toBe('review_card')
    expect(process?.masterTag).toBe('__MASTER_TAG__')
    expect(process?.requiredSlots).toEqual(
      expect.objectContaining({
        reviewers: expect.objectContaining({
          slotKind: 'attribute',
          type: expect.objectContaining({ _class: 'core:class:ArrOf' })
        }),
        status: expect.objectContaining({ type: expect.objectContaining({ _class: 'core:class:TypeString' }) })
      })
    )
    expect(JSON.stringify(result.docs)).toContain('${@__SLOT_reviewers__}')
    const done = result.docs.find((doc) => doc.trigger === 'process:trigger:OnToDoClose')
    expect(done?.triggerParams).toEqual({ _id: '${$context(review_tasks)}' })
    expect(process?.context).toEqual(expect.objectContaining({ review_tasks: expect.objectContaining({ index: 1 }) }))
  })

  it('uses the same named graph grammar for embedded processes', () => {
    const template = load(review) as {
      processes: { review_card: Record<string, unknown> }
      catalog: Record<string, unknown>
    }
    const { slots, ...graph } = template.processes.review_card
    const source = dump({
      version: 2,
      kind: 'card',
      cardTypes: { review_type: { label: 'Review card', extends: 'card:class:Card', kind: 0 } },
      fields: {
        reviewers: {
          attributeOf: 'review_type',
          name: 'reviewers',
          type: { array: { ref: 'contact.mixin.Employee' } }
        },
        status: { attributeOf: 'review_type', name: 'status', type: 'string', readonly: true, automationOnly: true }
      },
      processes: { review_card: { ...graph, masterTag: 'review_type' } },
      catalog: template.catalog
    }).replace(/\$slots\.status/g, 'status')
    const compiled = compileProcessYaml(source)
    expect(JSON.stringify(compiled.docs)).not.toContain('__SLOT_')
    expect(compiled.docs.some((doc) => doc._class === 'process:class:Process')).toBe(true)
  })

  it('keeps native JSON input unchanged and rejects the wrong YAML import route', () => {
    const docs = [{ _id: 'existing', _class: 'process:class:Process', space: 'core:space:Model' }]
    expect(parseProcessImport(JSON.stringify(docs), 'process')).toEqual(docs)
    expect(() => parseProcessImport(risk, 'process')).toThrow('card module importer')
    expect(() => parseProcessImport(review, 'card')).toThrow('process importer')
  })

  it.each([
    ['missing state', review.replace('to: reviewed', 'to: missing'), 'Expected a state'],
    ['unknown task context', review.replace('$context.review_tasks', '$context.missing'), 'Unknown output'],
    ['cyclic YAML alias', 'version: 2\nkind: card\ncardTypes: &cycle\n  child: *cycle', 'Cyclic YAML aliases'],
    ['reserved key', risk.replace('  probability:', '  constructor:'), 'Reserved key'],
    ['prototype state lookup', review.replace('to: reviewed', 'to: toString'), 'Expected a state']
  ])('rejects %s before producing import documents', (_, source, message) => {
    expect(() => compileProcessYaml(source)).toThrow(ProcessAuthoringError)
    expect(() => compileProcessYaml(source)).toThrow(message)
  })
})
