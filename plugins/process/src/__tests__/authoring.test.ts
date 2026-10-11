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
import { compileProcessYaml, parseProcessImport, ProcessAuthoringError } from '../authoring'
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

  it.each(['score * 1000000000000000000000', '0.0000001 * score', '1000000000000 * 1000000000 * score'])(
    'rejects native numeric operands that would silently lose their type: %s',
    (calculate) => {
      const source = dump({
        version: 1,
        kind: 'process',
        process: {
          label: 'Numeric encoding',
          slots: { score: { kind: 'attribute', type: 'number' } },
          start: { to: 'done', actions: [{ update: { score: { calculate } } }] },
          states: { done: {} }
        }
      })
      expect(() => compileProcessYaml(source)).toThrow('cannot encode numeric operands')
    }
  )

  it('rejects native context expressions in choices used by predicates', () => {
    const source = dump({
      version: 1,
      kind: 'process',
      process: {
        label: 'Choice guard',
        slots: { status: { kind: 'attribute', choice: ['${@hidden}'] } },
        start: { to: 'waiting' },
        states: {
          waiting: { transitions: [{ on: { matches: { status: { in: ['${@hidden}'] } } }, to: 'done' }] },
          done: {}
        }
      }
    })
    expect(() => compileProcessYaml(source)).toThrow('Raw native context')
  })

  it('compiles a risk module with native fields, dependencies and event-driven waiting', () => {
    const result = compileProcessYaml(risk)
    expect(result.kind).toBe('card')
    expect(new Set(result.docs.map((doc) => doc._id)).size).toBe(result.docs.length)
    const attrs = result.docs.filter((doc) => doc._class === 'core:class:Attribute')
    expect(attrs).toHaveLength(4)
    expect(attrs.find((doc) => doc.name === result.fields.probability)?.defaultValue).toBe('1')
    expect(attrs.find((doc) => doc.name === result.fields.score)?.automationOnly).toBe(true)
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
    const encoded = JSON.stringify(result.docs)
    expect(encoded).toContain('=>Multiply(')
    const actions = transitions.flatMap((doc) => doc.actions as Array<{ params: Record<string, unknown> }>)
    const expression = actions.find((action) => typeof action.params[result.fields.score] === 'string')?.params[
      result.fields.score
    ] as string
    expect(parseDSLContext(expression)?.functions?.map((func) => func.func)).toEqual([
      'process:function:StringFromEnum',
      'process:function:NumberFromString',
      'process:function:Multiply'
    ])
    expect(compileProcessYaml(risk).fields.probability).not.toBe(result.fields.probability)
  })

  it('compiles portable reviewers/status slots and a task group context', () => {
    const result = compileProcessYaml(review)
    const process = result.docs.find((doc) => doc._class === 'process:class:Process')
    expect(process?._id).toBe('__PROCESS__')
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
    expect(done?.triggerParams).toEqual({ _id: '${$context(__CONTEXT_0__)}' })
    expect(process?.context).toEqual(expect.objectContaining({ __CONTEXT_0__: expect.objectContaining({ index: 1 }) }))
  })

  it('uses the same explicit graph grammar for embedded processes', () => {
    const template = load(review) as { process: Record<string, unknown> }
    const { slots, key, ...graph } = template.process
    const source = dump({
      version: 1,
      kind: 'card',
      card: {
        key: 'review-card',
        label: 'Review card',
        fields: {
          reviewers: { type: 'employee', multiple: true },
          status: { type: 'string', readonly: true }
        },
        processes: { review: graph }
      }
    })
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

  it('compiles calculations on portable numeric/choice slots', () => {
    const module = load(risk) as { card: { fields: Record<string, Record<string, unknown>> } }
    const slots: Record<string, unknown> = {}
    const calculations: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(module.card.fields)) {
      const { default: defaultValue, required, calculate, ...field } = value
      slots[key] = { kind: 'attribute', ...field }
      if (calculate !== undefined) calculations[key] = calculate
    }
    const result = compileProcessYaml(
      dump({
        version: 1,
        kind: 'process',
        process: {
          key: 'risk-assessment',
          label: 'Risk assessment',
          slots,
          calculations
        }
      })
    )
    const definition = result.docs.find((doc) => doc._class === 'process:class:Process')
    expect(definition?.requiredSlots).toEqual(
      expect.objectContaining({
        probability: expect.objectContaining({ enumValues: ['1', '2', '3', '4', '5'] })
      })
    )
    expect(JSON.stringify(result.docs)).toContain('${@__SLOT_probability__=>')
    expect(result.docs.some((doc) => doc._class === 'core:class:Attribute')).toBe(false)
  })

  it('rejects a cycle of automatic transitions', () => {
    const source = dump({
      version: 1,
      kind: 'process',
      process: {
        label: 'Loop',
        slots: { score: { kind: 'attribute', type: 'number' } },
        start: { to: 'waiting' },
        states: { waiting: { transitions: [{ on: { matches: 'score > 0' }, to: 'waiting' }] } }
      }
    })
    expect(() => compileProcessYaml(source)).toThrow('Automatic match transitions form a cycle')
  })

  it('encodes equality as a native scalar predicate', () => {
    const result = compileProcessYaml(risk.replace('score > 16', 'score == 16'))
    const transition = result.docs.find(
      (doc) => JSON.stringify(doc.triggerParams) === JSON.stringify({ [result.fields.score]: 16 })
    )
    expect(transition?.trigger).toBe('process:trigger:OnCardUpdate')
    expect(JSON.stringify(result.docs)).not.toContain('$eq')
  })

  it('rejects incompatible copied choice values', () => {
    const source = dump({
      version: 1,
      kind: 'card',
      card: {
        key: 'choices',
        label: 'Choices',
        fields: {
          input: { choice: ['A', 'B'] },
          output: { choice: ['A'], calculate: 'input' }
        }
      }
    })
    expect(() => compileProcessYaml(source)).toThrow('every possible input choice')
  })

  it('rejects a task consumer reachable without its producer', () => {
    const source = dump({
      version: 1,
      kind: 'process',
      process: {
        label: 'Unsafe task context',
        slots: { reviewers: { kind: 'attribute', type: 'employee', multiple: true } },
        start: { to: 'waiting' },
        states: {
          waiting: {
            transitions: [
              {
                on: { changed: 'reviewers' },
                to: 'waiting',
                actions: [
                  { task: { key: 'review', title: 'Review', users: 'reviewers', completion: 'all', rollback: true } }
                ]
              },
              { on: { tasksCompleted: 'review' }, to: 'done' }
            ]
          },
          done: {}
        }
      }
    })
    expect(() => compileProcessYaml(source)).toThrow('without its producing task action')
  })

  it.each([
    ['unsupported version', risk.replace('version: 1', 'version: 3'), 'version'],
    ['unknown property', risk.replace('required: true', 'requred: true'), 'requred'],
    ['unknown expression field', risk.replace('number(probability)', 'number(missing)'), 'Unknown field'],
    ['unsupported arithmetic', risk.replace(' * ', ' + '), 'Supported expressions'],
    ['wrong default', risk.replace('default: 1', 'default: 6'), 'declared choices'],
    ['cycle', risk.replace('number(probability) * number(severity)', 'score'), 'Cyclic calculation'],
    ['unknown task context', review.replace('tasksCompleted: review-tasks', 'tasksCompleted: missing'), 'Task context'],
    ['missing state', review.replace('to: reviewed', 'to: missing'), 'Unknown state'],
    ['implicit completion', review.replace('          completion: all\n', ''), 'completion'],
    ['empty graph', 'version: 1\nkind: process\nprocess:\n  label: Test\n  slots: {}', 'states'],
    ['cyclic YAML alias', 'version: 1\nkind: card\ncard: &cycle\n  fields: *cycle', 'Cyclic YAML aliases'],
    ['reserved key', risk.replace('probability:', 'constructor:'), 'Reserved key'],
    ['prototype lookup', risk.replace('number(probability)', 'number(toString)'), 'Unknown field'],
    ['prototype state lookup', review.replace('to: reviewed', 'to: toString'), 'Unknown state'],
    [
      'slot configuration',
      review.replace('type: string', 'type: string\n      readonly: true'),
      'not field configuration'
    ],
    [
      'native expression injection',
      review.replace('status: Under review', 'status: "${@hidden}"'),
      'Raw native context'
    ],
    ['unreachable state', review + '\n    unreachable:\n      label: Unreachable\n', 'unreachable']
  ])('rejects %s before producing import documents', (_, source, message) => {
    expect(() => compileProcessYaml(source)).toThrow(ProcessAuthoringError)
    expect(() => compileProcessYaml(source)).toThrow(message)
  })
})
