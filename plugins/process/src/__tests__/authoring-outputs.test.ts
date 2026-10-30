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

import type { ModelDb } from '@hcengineering/core'
import { dump, load } from 'js-yaml'
import { compileProcessYaml, validateProcessYaml } from '../authoring'
import { exportAuthoringModel } from '../authoring-model'
import { expectEquivalentModel } from './authoring-test-utils'
import type { AuthoringNativeDocument } from '../authoring'

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
// Exercise inferred outputs using test contracts; portable examples carry their output types explicitly.
const example = (): string =>
  readFileSync(`${__dirname}/../../docs/examples/approval.process.yaml`, 'utf8').replace(
    'as: {key: approval_request, class: process.ApproveRequest}',
    'as: approval_request'
  ) + dump({ catalog })
const catalog = {
  methods: {
    RequestApproval: { createdContext: { _class: 'process:class:ApproveRequest' } },
    CreateToDo: { createdContext: { _class: 'process:class:ProcessToDo', nameField: 'title' } },
    RunSubProcess: { createdContext: { _class: 'process:class:Execution' } },
    AddTag: { createdContext: { _class: 'card:class:Card' } }
  }
}
const registry = (methods: Record<string, unknown>): ModelDb =>
  ({
    findObject: (id: string) => methods[id]
  }) as unknown as ModelDb

function layout (): Record<string, unknown> {
  return load(example()) as Record<string, unknown>
}

describe('named YAML outputs and references', () => {
  it('generates approval wiring from one as declaration and resolves values versus field identities', () => {
    const result = compileProcessYaml(example())
    const proc = result.docs.find((doc) => doc._class === 'process:class:Process')
    const start = result.docs.find((doc) => doc.from === null)
    const action = (start?.actions as Array<Record<string, unknown>>)[0]
    expect(action).toEqual(
      expect.objectContaining({
        _id: 'request_approval',
        params: { user: '${@__SLOT_approvers__}', field: '__SLOT_approvers__' },
        context: { _id: 'approval_request', _class: 'process:class:ApproveRequest' }
      })
    )
    expect(proc?.context).toEqual({
      approval_request: {
        name: '',
        _class: 'process:class:ApproveRequest',
        action: action._id,
        producer: start?._id,
        index: 1,
        value: { type: 'context', id: 'approval_request', key: '' }
      }
    })
    expect(result.docs.find((doc) => doc._id === 'approval_accepted')?.triggerParams).toEqual({
      _id: '${$context(approval_request)}'
    })
  })

  it('uses installed method contracts before catalog entries', () => {
    const source = layout()
    delete source.catalog
    const model = registry({
      'process:method:RequestApproval': { createdContext: { _class: 'extension:class:Review' } }
    })
    expect(compileProcessYaml(dump(source), model).docs[0].context).toEqual(
      expect.objectContaining({
        approval_request: expect.objectContaining({ _class: 'extension:class:Review' })
      })
    )
    const forged = registry({ 'process:method:RequestApproval': { createdContext: null } })
    expect(validateProcessYaml(example(), 'process', forged).diagnostic?.message).toContain(
      'does not declare an output'
    )
  })

  it('uses the same output grammar for a process embedded in a card module', () => {
    const source = example()
      .replace('kind: process', 'kind: card')
      .replace('    label: Approve card', '    label: Approve card\n    masterTag: approval_card')
    const root = load(source) as Record<string, unknown>
    root.cardTypes = {
      approval_card: { label: 'embedded:embedded:Approval card', extends: 'card:class:Card', kind: 0 }
    }
    const result = compileProcessYaml(dump(root))
    expect(result.kind).toBe('card')
    const proc = result.docs.find((doc) => doc._class === 'process:class:Process')
    expect(proc?.masterTag).toBe('approval_card')
    expect(proc?.context).toEqual(
      expect.objectContaining({ approval_request: expect.objectContaining({ _class: 'process:class:ApproveRequest' }) })
    )
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(result.docs, 'card', catalog)).docs, result.docs)
  })

  it('supports future methods and nameField without adding a converter', () => {
    const source = example()
      .replace('method: RequestApproval', 'method: extension:method:Review')
      .replace('user: $card.approvers', 'title: Review risk\n              user: $card.approvers')
    const model = registry({
      'extension:method:Review': { createdContext: { _class: 'extension:class:Review', nameField: 'title' } }
    })
    const result = compileProcessYaml(source, model)
    expect(result.docs[0].context).toEqual(
      expect.objectContaining({ approval_request: expect.objectContaining({ name: 'Review risk' }) })
    )
  })

  it('retains every native output, result, label, index and special type from the real approval export', () => {
    const docs = JSON.parse(
      readFileSync(`${__dirname}/fixtures/approval-process.json`, 'utf8')
    ) as AuthoringNativeDocument[]
    const source = exportAuthoringModel(docs, 'process', catalog)
    expect(source).toContain('as:')
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
    const compiled = compileProcessYaml(source)
    const exported = load(source) as { processes: { __PROCESS__: { context: Record<string, unknown> } } }
    expect(exported.processes.__PROCESS__.context).toBeUndefined()
    expect((compiled.docs[0].context as Record<string, unknown>).__CONTEXT_7__).toBeDefined()
    const before = JSON.stringify(docs)
    exportAuthoringModel(docs, 'process', catalog)
    expect(JSON.stringify(docs)).toBe(before)
  })

  it('exports typed outputs without depending on an embedded catalog', () => {
    const docs = compileProcessYaml(example()).docs
    const source = exportAuthoringModel(docs, 'process', catalog)
    expect((load(source) as Record<string, unknown>).catalog).toBeUndefined()
    expect(source).toContain('key: approval_request')
    expect(source).toContain('class: process.ApproveRequest')
    expect(source).not.toMatch(/^\s*context:/m)
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
  })

  it.each([
    ['unknown slot', '$slots.approvers', '$slots.missing', 'Unknown slot'],
    ['inherited slot name', '$slots.approvers', '$slots.toString', 'Unknown slot'],
    ['unknown output', '$context.approval_request', '$context.missing', 'Unknown output'],
    ['wrong slot kind', '$card.approvers', '$card.approved_tag', 'attribute slot'],
    ['malformed reference', '$card.approvers', '$card.', 'named reference']
  ])('rejects %s at the authored parameter path', (_name, from, to, message) => {
    const result = validateProcessYaml(example().replace(from, to))
    expect(result.valid).toBe(false)
    expect(result.diagnostic?.path).toMatch(/processes.approval_process./)
    expect(result.diagnostic?.message).toContain(message)
  })

  it('reports missing offline contracts without guessing a class', () => {
    const source = layout()
    delete source.catalog
    expect(validateProcessYaml(dump(source)).diagnostic?.message).toContain('Missing output contract')
    expect(validateProcessYaml(example(), 'process', registry({})).diagnostic?.message).toContain('not registered')
  })

  it('rejects duplicate outputs and conflicting explicit contexts', () => {
    expect(
      validateProcessYaml(example().replace('method: LockCard', 'method: LockCard\n            as: approval_request'))
        .diagnostic?.message
    ).toContain('Duplicate output')
    expect(
      validateProcessYaml(
        example().replace(
          'as: approval_request',
          'as: approval_request\n            context: {id: existing, class: process.ApproveRequest}'
        )
      ).diagnostic?.message
    ).toContain('either as')
    expect(validateProcessYaml(example().replace('as: approval_request', 'as: __proto__')).valid).toBe(false)
  })

  it('resolves nested selectors and update keys while keeping escaped text literal', () => {
    const source = example().replace(
      'method: LockCard',
      `method: LockCard
            params:
              $slots.approvers: $card.approvers.name
              value: $context.approval_request._id
              title: {literal: '$context.missing'}
              object: {literal: {literal: '$slots.missing'}}`
    )
    const result = compileProcessYaml(source)
    const params = (
      result.docs.find((doc) => doc.from === null)?.actions as Array<{ params: Record<string, unknown> }>
    )[1].params
    expect(params).toEqual({
      __SLOT_approvers__: '${@__SLOT_approvers__.name}',
      value: '${$context(approval_request,_id)}',
      title: '$context.missing',
      object: { literal: '$slots.missing' }
    })
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(result.docs, 'process', catalog)).docs, result.docs)
  })

  it('preserves native action extensions named as and unusual process context metadata', () => {
    const docs = compileProcessYaml(example()).docs
    const start = docs.find((doc) => doc.from === null)
    ;(start?.actions as Array<Record<string, unknown>>)[0].as = 'extension value'
    const contexts = docs[0].context as Record<string, Record<string, unknown>>
    contexts.approval_request.futureMetadata = { raw: '$slots.missing' }
    const source = exportAuthoringModel(docs, 'process', catalog)
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
    contexts.approval_request.value = { type: 'context', id: 'approval_request', key: 'name' }
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(docs, 'process', catalog)).docs, docs)
  })

  it('retains literal-looking parameter keys and advanced native expressions exactly', () => {
    const docs = compileProcessYaml(example()).docs
    const start = docs.find((doc) => doc.from === null)
    const params = (start?.actions as Array<Record<string, unknown>>)[0].params as Record<string, unknown>
    Object.assign(params, {
      '$slots.missing': '$context.literal',
      '$literal:original': ['plain', '$card.text'],
      transformed: '${@__SLOT_approvers__=>First()=>FALLBACK("$context.literal")}',
      legacy: '${{"type":"context","id":"approval_request","key":""}}'
    })
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(docs, 'process', catalog)).docs, docs)
  })
})
