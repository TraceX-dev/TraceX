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

/* eslint-disable no-template-curly-in-string -- Fixtures intentionally use native process expressions. */

import type { ModelDb } from '@hcengineering/core'
import { dump, load } from 'js-yaml'
import { compileProcessYaml, validateProcessYaml } from '../authoring'
import { exportAuthoringModel } from '../authoring-model'
import { parseContext } from '../utils'
import { expectEquivalentModel } from './authoring-test-utils'
import { decodeAuthoringType, encodeAuthoringType } from '../authoring-results'
import { authoringDataEqual } from '../authoring-validation'

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const example = (): string => readFileSync(`${__dirname}/../../docs/examples/estimate-review.process.yaml`, 'utf8')
interface Action {
  _id: string
  params: Record<string, unknown>
  context: unknown
  results?: Array<Record<string, unknown>>
}
function definition (): Record<string, unknown> {
  return load(example()) as Record<string, unknown>
}
function compute (root: Record<string, unknown>): Record<string, unknown> {
  return (
    root.processes as {
      estimate_review: {
        states: {
          waiting_for_estimate: {
            transitions: { estimate_received: { actions: { calculate_cost: Record<string, unknown> } } }
          }
        }
      }
    }
  ).estimate_review.states.waiting_for_estimate.transitions.estimate_received.actions.calculate_cost
}
function roundTrip (root: Record<string, unknown>): void {
  const compiled = compileProcessYaml(dump(root))
  expectEquivalentModel(
    compileProcessYaml(exportAuthoringModel(compiled.docs, 'process', root.catalog as Record<string, unknown>)).docs,
    compiled.docs
  )
}

describe('typed results and declarative pipelines', () => {
  it('generates task and computation result wiring without an explicit context map', () => {
    const compiled = compileProcessYaml(example())
    const contexts = compiled.docs[0].context as Record<string, Record<string, unknown>>
    expect(Object.keys(contexts)).toEqual(['review_tasks', 'effort', 'rate', 'total_cost'])
    expect(Object.values(contexts).map((value) => value.index)).toEqual([1, 2, 3, 4])
    expect(contexts.total_cost).toEqual({
      name: 'Total cost',
      isResult: true,
      type: { _class: 'core:class:TypeNumber', label: 'core:string:Number' },
      _class: 'core:class:TypeNumber',
      action: 'calculate_cost',
      producer: 'estimate_received',
      index: 4,
      value: { type: 'context', id: 'total_cost', key: '' }
    })
    const action = (compiled.docs.find((doc) => doc._id === 'estimate_received')?.actions as Action[])[0]
    expect(action.context).toBeNull()
    expect(action.params.value).toBe('${$context(effort)=>Multiply(value="${$context(rate)}")}')
    const source = exportAuthoringModel(compiled.docs, 'process', definition().catalog as Record<string, unknown>)
    expect(source).toContain('results:')
    expect(source).toContain('expr:')
    expect(source).not.toMatch(/^\s*(context:|producer:|index:|order:|isResult:)/m)
    expectEquivalentModel(compileProcessYaml(source).docs, compiled.docs)
  })

  it('does not infer a display label from a dynamic task title', () => {
    const source = example().replace('title: Provide an estimate', 'title: $card.title')
    const compiled = compileProcessYaml(source)
    expect((compiled.docs[0].context as Record<string, { name: string }>).review_tasks.name).toBe('')
    expectEquivalentModel(
      compileProcessYaml(
        exportAuthoringModel(compiled.docs, 'process', definition().catalog as Record<string, unknown>)
      ).docs,
      compiled.docs
    )
  })

  it.each([
    'string',
    'number',
    'boolean',
    'date',
    'markup',
    { array: 'number' },
    { ref: 'contact.mixin.Employee' },
    { enum: 'decision_enum' },
    { array: { ref: 'contact.mixin.Employee' } },
    { class: 'extension.NewType', label: 'extension:string:Type', futureOptions: { input: [true, 3] } }
  ])('preserves the type %p', (type) => {
    const root = definition()
    compute(root).results = { total_cost: { type } }
    roundTrip(root)
    const decoded = decodeAuthoringType(type, 'type')
    expect(authoringDataEqual(decodeAuthoringType(encodeAuthoringType(decoded), 'type'), decoded)).toBe(true)
  })

  it('preserves constraints, result extensions, type collisions and presentation order', () => {
    const root = definition()
    compute(root).results = {
      total_cost: {
        label: '',
        field: '$slots.cost',
        type: { array: { ref: 'contact.mixin.Employee' } },
        order: 8,
        selectionSpace: '$card._id',
        excludeRelation: { association: 'association', direction: 'B', versions: 'latest' },
        native: {
          field: 'native extension',
          label: 'native label',
          order: 'native order',
          custom: { expr: { from: '$card.literal' } }
        }
      }
    }
    roundTrip(root)
    const compiled = compileProcessYaml(dump(root))
    const result = (compiled.docs.find((doc) => doc._id === 'estimate_received')?.actions as Action[])[0].results?.[0]
    expect(result?.key).toBe('__SLOT_cost__')
    expect(result?.selectionSpace).toBe('${@_id}')
    const context = compiled.docs[0].context as Record<string, Record<string, unknown>>
    expect(context.total_cost._class).toBe('contact:mixin:Employee')
    result!.type = { _class: 'extension:class:NewType', class: 'native class', native: { custom: true } }
    context.total_cost.type = result!.type
    context.total_cost._class = 'extension:class:NewType'
    expectEquivalentModel(
      compileProcessYaml(exportAuthoringModel(compiled.docs, 'process', root.catalog as Record<string, unknown>)).docs,
      compiled.docs
    )
  })

  it('retains original arrays and explicit unusual context definitions', () => {
    const root = definition()
    const compiled = compileProcessYaml(dump(root))
    const contexts = compiled.docs[0].context as Record<string, Record<string, unknown>>
    contexts.total_cost.futureMetadata = true
    const source = exportAuthoringModel(compiled.docs, 'process', root.catalog as Record<string, unknown>)
    expect(source).toContain('futureMetadata: true')
    expect(source).toContain('id: total_cost')
    expectEquivalentModel(compileProcessYaml(source).docs, compiled.docs)
  })

  it.each([
    [{ from: '$context.missing' }, 'Unknown output'],
    [{ from: '$context.effort', call: 'Today' }, 'exactly one'],
    [{ from: 3 }, 'value reference'],
    [{ from: '$context.effort', pipe: [{ Multiply: {}, Extra: {} }] }, 'exactly one function'],
    [{ from: '$context.effort', pipe: ['All'] }, 'requires transform'],
    [{ from: '$context.effort', reduce: 'Multiply' }, 'requires reduce'],
    [{ call: 'Multiply' }, 'requires context']
  ])('rejects invalid expression %p', (expr, message) => {
    const root = definition()
    ;(root.catalog as { functions: Record<string, unknown> }).functions.All = { type: 'reduce' }
    compute(root).params = { value: { expr } }
    const result = validateProcessYaml(dump(root))
    expect(result.valid).toBe(false)
    expect(result.diagnostic?.message).toContain(message)
    expect(result.diagnostic?.path).toContain('calculate_cost.params.value.expr')
  })

  it('supports future context functions and conversions without compiler handlers', () => {
    const root = definition()
    ;(root.catalog as { functions: Record<string, unknown> }).functions = {
      'extension:function:Source': { type: 'context' },
      'extension:function:Count': { type: 'reduce' },
      'extension:function:Convert': { type: 'convert' }
    }
    compute(root).params = {
      value: {
        expr: {
          call: { 'extension:function:Source': { role: '$slots.reviewers' } },
          reduce: 'extension:function:Count',
          pipe: [{ 'extension:function:Convert': { value: '$context.rate' } }],
          fallback: 0
        }
      }
    }
    const action = (
      compileProcessYaml(dump(root)).docs.find((doc) => doc._id === 'estimate_received')?.actions as Action[]
    )[0]
    expect(parseContext(action.params.value)).toEqual(
      expect.objectContaining({
        type: 'function',
        func: 'extension:function:Source',
        sourceFunction: { func: 'extension:function:Count', props: {} },
        functions: [{ func: 'extension:function:Convert', props: { value: '${$context(rate)}' } }],
        fallbackValue: 0
      })
    )
    roundTrip(root)
  })

  it('preserves quotes, newlines, exponent numbers and reference-looking constants', () => {
    const root = definition()
    compute(root).params = {
      value: {
        expr: {
          from: { literal: { quote: 'A "quoted"\nvalue', number: 1e-20, reference: '$context.literal' } },
          pipe: [{ Multiply: { value: { literal: '$slots.literal' } } }],
          fallback: '$card.literal'
        }
      },
      object: { literal: { expr: { from: '$context.literal' } } }
    }
    const action = (
      compileProcessYaml(dump(root)).docs.find((doc) => doc._id === 'estimate_received')?.actions as Action[]
    )[0]
    expect(parseContext(action.params.value)).toEqual(
      expect.objectContaining({
        value: { quote: 'A "quoted"\nvalue', number: 1e-20, reference: '$context.literal' },
        fallbackValue: '$card.literal'
      })
    )
    expect(action.params.object).toEqual({ expr: { from: '$context.literal' } })
    roundTrip(root)
  })

  it('uses installed function roles before catalog claims and reports absent functions', () => {
    const root = definition()
    // Remove ordinary output inference so this test isolates the function contract.
    const action = (
      root.processes as {
        estimate_review: { start: { request_estimate: { actions: { request_review: Record<string, unknown> } } } }
      }
    ).estimate_review.start.request_estimate.actions.request_review
    action.as = { key: 'review_tasks', class: 'process.ProcessToDo' }
    const registry = (type?: string): ModelDb =>
      ({
        findObject: (id: string) =>
          id === 'process:function:Multiply'
            ? type === undefined
              ? undefined
              : { type }
            : { createdContext: { _class: 'process:class:ProcessToDo' } }
      }) as unknown as ModelDb
    expect(validateProcessYaml(dump(root), 'process', registry('reduce')).diagnostic?.message).toContain(
      'requires transform'
    )
    expect(validateProcessYaml(dump(root), 'process', registry()).diagnostic?.message).toContain('not registered')
  })

  it('keeps native expressions whose old function placement does not fit the new declarative roles', () => {
    const root = definition()
    const compiled = compileProcessYaml(dump(root))
    const action = (compiled.docs.find((doc) => doc._id === 'estimate_received')?.actions as Action[])[0]
    action.params.value = '${$context(effort)=>All()}'
    ;(root.catalog as { functions: Record<string, unknown> }).functions.All = { type: 'reduce' }
    const source = exportAuthoringModel(compiled.docs, 'process', root.catalog as Record<string, unknown>)
    expect(source).toContain('${$context(effort)=>All()}')
    expectEquivalentModel(compileProcessYaml(source).docs, compiled.docs)
  })

  it.each([
    [{ total_cost: { type: 'unknown' } }, 'Unknown scalar type'],
    [{ effort: { type: 'number' } }, 'Duplicate output'],
    [{ total_cost: { type: 'number', field: '$card.cost' } }, 'field identity'],
    [{ total_cost: { type: 'number', order: -1 } }, 'nonnegative integer'],
    [{ total_cost: { type: { array: {} } } }, 'nonempty string']
  ])('rejects invalid result declarations %p', (results, message) => {
    const root = definition()
    compute(root).results = results
    expect(validateProcessYaml(dump(root)).diagnostic?.message).toContain(message)
  })

  it('reports missing required parameters without inserting model defaults', () => {
    const root = definition()
    compute(root).params = {}
    expect(validateProcessYaml(dump(root)).diagnostic?.path).toContain('calculate_cost.params.value')
    compute(root).params = { value: 0 }
    expect(validateProcessYaml(dump(root)).valid).toBe(true)
    roundTrip(root)
  })

  it('points semantic diagnostics to the authored block using YAML parser positions', () => {
    const source = example().replace('from: $context.effort', 'from: $context.missing')
    const diagnostic = validateProcessYaml(source).diagnostic
    expect(diagnostic?.line).toBeDefined()
    expect(source.split('\n')[diagnostic!.line! - 1]).toContain('from: $context.missing')
    expect(diagnostic?.column).toBeGreaterThan(1)
  })

  it('uses short types in fields and embedded processes with the same result/expression grammar', () => {
    const root = definition()
    root.kind = 'card'
    root.cardTypes = { estimate_card: { label: 'embedded:embedded:Estimate', extends: 'card:class:Card', kind: 0 } }
    root.fields = {
      cost: { attributeOf: 'estimate_card', name: 'cost', label: 'embedded:embedded:Cost', type: 'number' },
      status: { attributeOf: 'estimate_card', name: 'status', label: 'embedded:embedded:Status', type: 'string' },
      reviewers: {
        attributeOf: 'estimate_card',
        name: 'reviewers',
        label: 'embedded:embedded:Reviewers',
        type: { array: { ref: 'contact.mixin.Employee' } }
      }
    }
    const proc = (root.processes as { estimate_review: Record<string, unknown> }).estimate_review
    proc.masterTag = 'estimate_card'
    delete proc.slots
    const source = dump(root)
      .replace(/\$slots.cost/g, 'cost')
      .replace(/\$slots.status/g, 'status')
    const compiled = compileProcessYaml(source)
    const exported = exportAuthoringModel(compiled.docs, 'card', root.catalog as Record<string, unknown>)
    expectEquivalentModel(compileProcessYaml(exported).docs, compiled.docs)
    expect(exported).toContain('type: number')
  })
})
