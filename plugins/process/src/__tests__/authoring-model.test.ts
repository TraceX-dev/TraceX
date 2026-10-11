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
import core, { type Hierarchy, type ModelDb } from '@hcengineering/core'
import { dump, load } from 'js-yaml'
import process from '../index'
import { compileProcessYaml, validateProcessYaml } from '../authoring'
import { exportProcessYaml, exportProcessYamlDraft } from '../authoring-export'
import {
  exportAuthoringModel,
  getAuthoringCatalog,
  remapAuthoringReferences,
  validateAuthoringModelOperations
} from '../authoring-model'
import type { AuthoringNativeDocument } from '../authoring'

// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const approval = (): AuthoringNativeDocument[] =>
  JSON.parse(readFileSync(`${__dirname}/fixtures/approval-process.json`, 'utf8'))
const simple = (): AuthoringNativeDocument[] =>
  compileProcessYaml(readFileSync(`${__dirname}/../../docs/examples/review-task.process.yaml`, 'utf8')).docs

describe('full model YAML', () => {
  it('exports readable nested blocks without model storage properties', () => {
    const source = exportAuthoringModel(approval(), 'process')
    expect(source).not.toMatch(/^\s*(space: core:space:Model|rank:|_class:|methodId:|process:|from:)/m)
    expect(source).toContain('processes:')
    expect(source).toContain('states:')
    expect(source).toContain('transitions:')
    expect(source).toContain('method: RequestApproval')
    expect(source).toContain('on: OnExecutionStart')
    expect(source).not.toContain('model:')
  })

  it('accepts the previous native-list format for existing YAML files', () => {
    const docs = approval()
    expect(compileProcessYaml(dump({ version: 2, kind: 'process', model: docs })).docs).toEqual(docs)
  })

  it('retains future document classes, non-model spaces and properties colliding with DSL names', () => {
    const docs = simple()
    Object.assign(docs[0], {
      label: 'native label',
      states: { arbitrary: true },
      start: false,
      native: { arbitrary: 'data' }
    })
    const transition = docs.find((doc) => doc.from === null)
    Object.assign(transition ?? {}, { on: 'native on' })
    ;(transition?.actions as Array<Record<string, unknown>>)[0].method = 'native method'
    const context = (transition?.actions as Array<Record<string, unknown>>).find((action) => action.context !== null)
      ?.context as Record<string, unknown>
    Object.assign(context, { id: 'native id', class: 'literal class' })
    docs[0].resultType = { _class: 'custom.Type', label: 'plugin:string:Type' }
    docs.push({
      _id: 'extension',
      _class: 'extension:class:FutureDocument',
      space: core.space.Workspace,
      rank: 'custom rank',
      context: 'literal context',
      type: { _class: 'literal.text' },
      options: { _class: 'literal text', id: 'literal id' }
    })
    const source = exportAuthoringModel(docs, 'process')
    expect(source).toContain('documents:')
    expect(source).toContain('native:')
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
  })

  it('reports malformed readable graphs using their block paths', () => {
    const source = readFileSync(`${__dirname}/../../docs/examples/approval.process.yaml`, 'utf8')
    const invalid = source.replace('to: waiting_for_approval', 'to: missing')
    expect(validateProcessYaml(invalid).diagnostic?.path).toBe('processes.approval_process.start.start_approval.to')
    expect(
      validateProcessYaml(source.replace('method: LockCard', 'method: LockCard\n            _id: unexpected')).valid
    ).toBe(false)
  })

  it('uses YAML branch order as priority and keeps action order independent of names', () => {
    const docs = approval()
    const source = exportAuthoringModel([...docs].reverse(), 'process')
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
    const layout = load(readFileSync(`${__dirname}/../../docs/examples/approval.process.yaml`, 'utf8')) as {
      processes: { approval_process: { states: { waiting_for_approval: { transitions: Record<string, unknown> } } } }
    }
    const state = layout.processes.approval_process.states.waiting_for_approval
    state.transitions = Object.fromEntries(Object.entries(state.transitions).reverse())
    const compiled = compileProcessYaml(dump(layout))
    const branches = compiled.docs.filter((doc) => doc.from === 'waiting_for_approval')
    expect(branches.map((doc) => doc._id)).toEqual(['approval_rejected', 'approval_accepted'])
    expect(String(branches[0].rank) < String(branches[1].rank)).toBe(true)
  })

  it('round trips the real approval export with every slot, context, result, trigger and action', () => {
    const docs = approval()
    const before = JSON.stringify(docs)
    const draft = exportProcessYamlDraft(docs)
    const compiled = compileProcessYaml(draft.source)
    expect(compiled.version).toBe(2)
    expectEquivalentModel(compiled.docs, docs)
    expect(JSON.stringify(docs)).toBe(before)
    expect(draft.bindings).toEqual(docs[0].bindings)
    expect(validateProcessYaml(draft.source, 'process')).toEqual({ valid: true })
  })

  it.each(Object.entries(process.method))(
    'preserves the registered method %s without a converter',
    (_name, methodId) => {
      const docs = simple()
      const transition = docs.find((doc) => doc.from === null)
      ;(transition?.actions as Array<Record<string, unknown>>)[0] = {
        _id: 'named-action',
        methodId,
        context: null,
        params: { futureOption: { values: [false, null, 3] } },
        futureMetadata: true
      }
      expectEquivalentModel(compileProcessYaml(exportProcessYaml(docs, 'process')).docs, docs)
    }
  )

  it.each(Object.entries(process.trigger))(
    'preserves the registered trigger %s and its native query',
    (_name, trigger) => {
      const docs = simple()
      Object.assign(docs.find((doc) => doc.from === null) ?? {}, {
        trigger,
        triggerParams: { values: { $size: { $gt: 0 } }, futureFilter: { $all: ['a', 'b'] } }
      })
      expectEquivalentModel(compileProcessYaml(exportProcessYaml(docs, 'process')).docs, docs)
    }
  )

  it('preserves dependent card types, permissions, mixins, arbitrary types and new properties', () => {
    const docs = compileProcessYaml(
      readFileSync(`${__dirname}/../../docs/examples/risk-management.card.yaml`, 'utf8')
    ).docs
    const owner = docs.find((doc) => doc._class === 'card:class:MasterTag')
    Object.assign(owner ?? {}, { 'core:mixin:VersionableClass': { enabled: true } })
    docs.push({
      _id: 'child',
      _class: 'card:class:MasterTag',
      space: core.space.Model,
      extends: owner?._id,
      label: 'plugin:string:LocalizedLabel',
      kind: 0
    })
    docs.push({
      _id: 'permission',
      _class: 'core:class:ClassPermission',
      space: core.space.Model,
      targetClass: 'child'
    })
    docs.push({
      _id: 'new-attribute',
      _class: 'core:class:Attribute',
      space: core.space.Model,
      name: 'pluginField',
      attributeOf: 'child',
      type: { _class: 'plugin:class:NewType', futureProperty: [1, 2] }
    })
    expectEquivalentModel(compileProcessYaml(exportProcessYaml(docs, 'card')).docs, docs)
  })

  it('accepts readable symbolic identities in the native graph', () => {
    const docs = simple()
    const ids = new Map(
      docs.map((doc, index) => [doc._id, ['review', 'waiting', 'done', 'start', 'finish'][index] ?? `block${index}`])
    )
    const named = remapAuthoringReferences(docs, ids)
    expectEquivalentModel(compileProcessYaml(exportAuthoringModel(named, 'process')).docs, named)
  })

  it('compiles the documented approval blocks and named contexts', () => {
    const result = compileProcessYaml(readFileSync(`${__dirname}/../../docs/examples/approval.process.yaml`, 'utf8'))
    expect(result.version).toBe(2)
    expect(result.docs.filter((doc) => doc._class === process.class.State).map((doc) => doc._id)).toEqual([
      'waiting_for_approval',
      'approved',
      'rejected'
    ])
    expect(result.docs.find((doc) => doc._id === 'start_approval')?.actions).toEqual([
      expect.objectContaining({ methodId: process.method.RequestApproval }),
      expect.objectContaining({ methodId: process.method.LockCard })
    ])
    expectEquivalentModel(compileProcessYaml(exportProcessYaml(result.docs, 'process')).docs, result.docs)
  })

  it('rejects expansive alias graphs before serialization or applying', () => {
    const docs = simple()
    let alias: unknown = { value: 'shared' }
    for (let index = 0; index < 4; index++) alias = Array.from({ length: 100 }, () => alias)
    docs[0].metadata = alias
    const source = dump({ version: 2, kind: 'process', model: docs })
    expect(() => compileProcessYaml(source)).toThrow('Expanded model exceeds')
    expect(() => exportAuthoringModel(docs, 'process')).toThrow('Expanded model exceeds')
  })

  it('rebinds all native expression sources and keeps constants and transform text intact', () => {
    const docs: AuthoringNativeDocument[] = [
      {
        _id: 'transition',
        _class: 'process:class:Transition',
        space: core.space.Model,
        title: 'old-context',
        relation: '${$relation(old-association,B,old-field,Steps)=>SOURCE(All)}',
        count: '${=>RelationCount(association="old-association",direction="B",name="old-context")}',
        role: '${=>RoleContext(role="old-role")}',
        nested: '${@old-field.old-result}',
        request: '${$userRequest(old-context,old-field,old-class)}',
        value: '${@old-field=>Multiply(value="${$context(old-context)}")=>FALLBACK("old-context")}',
        constant: '${#"old-context",}',
        choices: { enumValues: ['old-context'] },
        plain: { 'old-field': 'old-context' }
      }
    ]
    const ids = new Map([
      ['old-context', 'new-context'],
      ['old-field', 'new-field'],
      ['old-result', 'new-result'],
      ['old-association', 'new-association'],
      ['old-class', 'new-class'],
      ['old-role', 'new-role']
    ])
    const result = remapAuthoringReferences(docs, ids, (_doc, path) => path.join('.') === 'plain.old-field')[0]
    expect(result.title).toBe('old-context')
    expect(result.constant).toBe('${#"old-context",}')
    expect(result.choices).toEqual({ enumValues: ['old-context'] })
    expect(result.plain).toEqual({ 'new-field': 'old-context' })
    expect(result.relation).toBe('${$relation(new-association,B,new-field,Steps)=>SOURCE(All)}')
    expect(result.count).toBe('${=>RelationCount(association="new-association",direction="B",name="old-context")}')
    expect(result.role).toBe('${=>RoleContext(role="new-role")}')
    expect(result.nested).toBe('${@new-field.new-result}')
    expect(result.request).toBe('${$userRequest(new-context,new-field,new-class)}')
    expect(result.value).toContain('$context(new-context)')
    expect(result.value).toContain('FALLBACK("old-context")')
  })

  it('discovers and validates future operations through the installed model', () => {
    const docs = simple()
    const transition = docs.find((doc) => doc.from === null)
    ;(transition?.actions as Array<Record<string, unknown>>)[0].methodId = 'extension:method:NewOperation'
    ;((transition?.actions as Array<Record<string, unknown>>)[0].params as Record<string, unknown>).target =
      'destination'
    const registry = [
      {
        _id: 'extension:method:NewOperation',
        _class: 'process:class:Method',
        requiredParams: ['target'],
        defaultParams: { enabled: true },
        createdContext: null,
        futureContract: { options: ['new'] }
      },
      ...Object.values(process.method).map((_id) => ({ _id, _class: 'process:class:Method' })),
      ...Object.values(process.trigger).map((_id) => ({ _id, _class: 'process:class:Trigger' }))
    ]
    const model = {
      findObject: (id: string) => registry.find((doc) => doc._id === id),
      findAllSync: (clazz: string) => registry.filter((doc) => doc._class === clazz)
    } as unknown as ModelDb
    const hierarchy = { isDerived: () => false } as unknown as Hierarchy
    expect(() => {
      validateAuthoringModelOperations(docs, model, hierarchy)
    }).not.toThrow()
    const catalog = getAuthoringCatalog(model)
    expect(catalog.methods).toEqual(
      expect.objectContaining({
        'extension:method:NewOperation': expect.objectContaining({
          requiredParams: ['target'],
          defaultParams: { enabled: true },
          futureContract: { options: ['new'] }
        })
      })
    )
    const source = exportAuthoringModel(docs, 'process', catalog)
    expectEquivalentModel(compileProcessYaml(source).docs, docs)
    registry.splice(0, 1)
    expect(() => {
      validateAuthoringModelOperations(docs, model, hierarchy)
    }).toThrow('not registered')
  })

  it.each(['duplicate', 'destination', 'owner', 'number', 'reserved'])(
    'rejects invalid %s data with a model path',
    (problem) => {
      const docs = simple()
      if (problem === 'duplicate') docs.push({ ...docs[0] })
      if (problem === 'destination') Object.assign(docs.find((doc) => doc.from === null) ?? {}, { to: 'missing' })
      if (problem === 'owner') {
        Object.assign(docs.find((doc) => doc._class === 'process:class:State') ?? {}, { process: 'missing' })
      }
      if (problem === 'number') docs[0].invalid = NaN
      if (problem === 'reserved') docs[0].invalid = { constructor: true }
      const source = dump({ version: 2, kind: 'process', model: docs })
      expect(validateProcessYaml(source).valid).toBe(false)
      expect(validateProcessYaml(source).diagnostic?.message).toMatch(/model|Reserved/)
    }
  )
})
