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

import core, { type Doc, type Ref } from '@hcengineering/core'
import type { MasterTag } from '@hcengineering/card'
import { getClient } from '@hcengineering/presentation'
import process, {
  compileProcessYaml,
  exportAuthoringModel,
  type AttributeSlotModel,
  type Process
} from '@hcengineering/process'
import {
  denormalizeIds,
  exportProcessDraft,
  importProcess,
  isYamlSlotBindingCompatible,
  updateProcessYaml
} from '../exporter'
import { bindYamlModelProcess } from '@hcengineering/process'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')
const fixture = (): Doc[] =>
  JSON.parse(readFileSync(`${__dirname}/../../../process/src/__tests__/fixtures/approval-process.json`, 'utf8'))

function setup (): {
  proc: Process
  docs: Doc[]
  bindings: Record<string, string>
  createDoc: jest.Mock
  updateDoc: jest.Mock
  removeDoc: jest.Mock
  commit: jest.Mock
  registry: Array<Record<string, unknown>>
} {
  const bindings = {
    'embedded:embedded:(new) Test Case': 'test-case',
    'Lock steps': 'lock-steps',
    'embedded:embedded:Approved': 'approved-tag',
    slot4: 'owner',
    slot5: 'approvers',
    'Unlock steps': 'unlock-steps'
  }
  const docs = denormalizeIds(fixture(), 'test-case' as Ref<MasterTag>, bindings)
  const proc = docs.find((doc) => doc._class === process.class.Process) as Process
  proc.rank = 'original-rank'
  const registry: Array<Record<string, unknown>> = [
    { _id: 'test-case', _class: 'card:class:MasterTag', label: 'embedded:embedded:Test Case' },
    { _id: 'approved-tag', _class: 'card:class:Tag', label: 'embedded:embedded:Approved' },
    { _id: 'lock-steps', _class: process.class.Process, name: 'Lock steps', masterTag: 'test-case' },
    { _id: 'unlock-steps', _class: process.class.Process, name: 'Unlock steps', masterTag: 'test-case' },
    {
      _id: 'owner-attribute',
      name: 'owner',
      attributeOf: 'test-case',
      _class: core.class.Attribute,
      label: 'embedded:embedded:Owner',
      type: { _class: core.class.RefTo, to: 'contact:mixin:Employee' }
    },
    {
      _id: 'approvers-attribute',
      name: 'approvers',
      attributeOf: 'test-case',
      _class: core.class.Attribute,
      label: 'embedded:embedded:Approvers',
      type: { _class: core.class.ArrOf, of: { _class: core.class.RefTo, to: 'contact:mixin:Employee' } }
    },
    ...Object.values(process.method).map((_id) => ({
      _id,
      _class: process.class.Method,
      requiredParams: [],
      objectClass: 'card:class:Card',
      createdContext: null
    })),
    ...Object.values(process.trigger).map((_id) => ({ _id, _class: process.class.Trigger, requiredParams: [] })),
    ...Object.values(process.function).map((_id) => ({ _id, _class: process.class.ProcessFunction }))
  ]
  const createDoc = jest.fn().mockResolvedValue(undefined)
  const updateDoc = jest.fn().mockResolvedValue(undefined)
  const removeDoc = jest.fn().mockResolvedValue(undefined)
  const commit = jest.fn().mockResolvedValue({ result: true })
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => ({
      isDerived: (actual: string, expected: string) =>
        actual === expected ||
        (expected === core.class.Class && ['card:class:MasterTag', 'card:class:Tag'].includes(actual)),
      findAttribute: (owner: string, name: string) =>
        registry.find((doc) => doc.attributeOf === owner && doc.name === name)
    }),
    getModel: () => ({
      findObject: (id: string) => docs.find((doc) => doc._id === id) ?? registry.find((doc) => doc._id === id),
      findAllSync: (clazz: string, query: Record<string, unknown>) =>
        [...docs, ...registry].filter(
          (doc) =>
            doc._class === clazz &&
            Object.entries(query).every(([key, value]) => (doc as unknown as Record<string, unknown>)[key] === value)
        )
    }),
    apply: () => ({ createDoc, updateDoc, removeDoc, commit })
  })
  return { proc, docs, bindings, createDoc, updateDoc, removeDoc, commit, registry }
}

describe('full model YAML process editing', () => {
  it.each(['new', 'current'])('keeps the exported graph attached to the %s process', async (mode) => {
    const { proc, createDoc, updateDoc, registry } = setup()
    Object.assign(registry.find((doc) => doc._id === process.method.RunSubProcess) ?? {}, {
      createdContext: { _class: process.class.Execution }
    })
    Object.assign(registry.find((doc) => doc._id === process.method.CreateToDo) ?? {}, {
      createdContext: { _class: process.class.ProcessToDo, nameField: 'title' }
    })
    const source = readFileSync(`${__dirname}/fixtures/linked-card.process.yaml`, 'utf8')
    const bindings = { slot_create_step: 'lock-steps', slot_owner: 'owner' }
    if (mode === 'new') await importProcess(proc.masterTag, source, bindings)
    else await updateProcessYaml(proc, source, bindings)
    const created = createDoc.mock.calls.map(([clazz, _space, values, id]) => ({ _class: clazz, _id: id, ...values }))
    const processId = mode === 'new' ? created.find((doc) => doc._class === process.class.Process)._id : proc._id
    const states = created.filter((doc) => doc._class === process.class.State)
    const transitions = created.filter((doc) => doc._class === process.class.Transition)
    expect(states).toHaveLength(3)
    expect(transitions).toHaveLength(4)
    expect([...states, ...transitions].every((doc) => doc.process === processId)).toBe(true)
    const stateIds = states.map((doc) => doc._id)
    for (const transition of transitions) {
      expect(stateIds).toContain(transition.to)
      if (transition.from !== null) expect(stateIds).toContain(transition.from)
    }
    const stop = transitions
      .flatMap((doc) => doc.actions)
      .find((action) => action.methodId === process.method.CreateToDo)
    const definition =
      mode === 'new' ? created.find((doc) => doc._class === process.class.Process) : updateDoc.mock.calls[0][3]
    expect(definition.context[stop.context._id]).toEqual(expect.objectContaining({ action: stop._id }))
    expect(transitions.find((doc) => doc.trigger === process.trigger.OnToDoClose).triggerParams._id).toBe(
      '${$context(' + stop.context._id + ')}'
    )
    expect(stop.params.user).toBe('${@owner}')
    expect(stop.params.field).toBe('owner')
  })

  it.each(['new', 'current'])('rebinds typed results and pipeline dependencies in the %s process', async (mode) => {
    const { proc, registry, createDoc, updateDoc } = setup()
    Object.assign(registry.find((doc) => doc._id === process.method.CreateToDo) ?? {}, {
      createdContext: { _class: process.class.ProcessToDo, nameField: 'title' }
    })
    for (const [name, clazz] of [
      ['cost', core.class.TypeNumber],
      ['status', core.class.TypeString]
    ]) {
      registry.push({
        _id: `${name}-attribute`,
        name,
        attributeOf: proc.masterTag,
        _class: core.class.Attribute,
        type: { _class: clazz }
      })
    }
    const source = readFileSync(`${__dirname}/../../../process/docs/examples/estimate-review.process.yaml`, 'utf8')
    const bindings = { reviewers: 'approvers', cost: 'cost', status: 'status' }
    if (mode === 'new') await importProcess(proc.masterTag, source, bindings)
    else await updateProcessYaml(proc, source, bindings)
    const created = createDoc.mock.calls.map(([clazz, _space, values, id]) => ({ _class: clazz, _id: id, ...values }))
    const definition =
      mode === 'new' ? created.find((doc) => doc._class === process.class.Process) : updateDoc.mock.calls[0][3]
    const transitions = created.filter((doc) => doc._class === process.class.Transition)
    const task = transitions
      .flatMap((doc) => doc.actions)
      .find((action) => action.methodId === process.method.CreateToDo)
    const computation = transitions
      .flatMap((doc) => doc.actions)
      .find((action) => action.methodId === process.method.SetContext)
    expect(task.params.user).toBe('${@approvers}')
    expect(task.results.map((result: { _id: string }) => result._id)).not.toEqual(['effort', 'rate'])
    expect(computation.params.value).toBe(
      '${$context(' + task.results[0]._id + ')=>Multiply(value="${$context(' + task.results[1]._id + ')}")}'
    )
    const resultId = computation.results[0]._id
    expect(definition.context[resultId]).toEqual(
      expect.objectContaining({ isResult: true, action: computation._id, _class: core.class.TypeNumber })
    )
    expect(Object.keys(definition.context)).toHaveLength(4)
    if (mode === 'current') expect(updateDoc.mock.calls[0][2]).toBe(proc._id)
  })

  it.each(['new', 'current'])('applies readable as outputs and slot references to the %s process', async (mode) => {
    const { proc, registry, createDoc, updateDoc } = setup()
    Object.assign(registry.find((doc) => doc._id === process.method.RequestApproval) ?? {}, {
      createdContext: { _class: process.class.ApproveRequest }
    })
    const source = readFileSync(`${__dirname}/../../../process/docs/examples/approval.process.yaml`, 'utf8')
    const bindings = { approvers: 'approvers', approved_tag: 'approved-tag' }
    if (mode === 'new') await importProcess(proc.masterTag, source, bindings)
    else await updateProcessYaml(proc, source, bindings)
    const created = createDoc.mock.calls.map(([clazz, _space, values, id]) => ({ _class: clazz, _id: id, ...values }))
    const definition =
      mode === 'new' ? created.find((doc) => doc._class === process.class.Process) : updateDoc.mock.calls[0][3]
    const start = created.find((doc) => doc._class === process.class.Transition && doc.from === null)
    const request = start.actions.find(
      (action: { methodId: string }) => action.methodId === process.method.RequestApproval
    )
    expect(request.params).toEqual({ user: '${@approvers}', field: 'approvers' })
    expect(request.context._id).not.toBe('approval_request')
    expect(definition.context[request.context._id]).toEqual(
      expect.objectContaining({ action: request._id, producer: start._id, _class: process.class.ApproveRequest })
    )
    const accepted = created.find((doc) => doc.trigger === process.trigger.OnApproveRequestApproved)
    expect(accepted.triggerParams._id).toBe('${$context(' + request.context._id + ')}')
    if (mode === 'current') expect(updateDoc.mock.calls[0][2]).toBe(proc._id)
    expect(JSON.stringify(created)).not.toContain('$slots.')
    expect(JSON.stringify(created)).not.toContain('$card.')
  })

  it('discovers slots and compacts outputs using the installed method model', () => {
    const { proc, registry } = setup()
    Object.assign(registry.find((doc) => doc._id === process.method.RequestApproval) ?? {}, {
      createdContext: { _class: process.class.ApproveRequest }
    })
    const draft = exportProcessDraft(proc)
    expect(draft.source).toContain('as:')
    expect(compileProcessYaml(draft.source).docs[0].context).toBeDefined()
  })

  it('exports the real approval graph with readable contracts and every binding prefilled', () => {
    const { proc } = setup()
    const draft = exportProcessDraft(proc)
    const compiled = compileProcessYaml(draft.source)
    expect(compiled.version).toBe(2)
    expect(draft.source).not.toContain('catalog:')
    expect(draft.source).toContain('method: RequestApproval')
    expect(draft.source).toContain('state_waiting:')
    expect(draft.source).toContain('$slots.slot_owner')
    expect(Object.values(draft.bindings).sort()).toEqual(
      ['approved-tag', 'approvers', 'lock-steps', 'owner', 'test-case', 'unlock-steps'].sort()
    )
    const definition = compiled.docs.find((doc) => doc._class === process.class.Process) as unknown as Process
    for (const [key, slot] of Object.entries(definition.requiredSlots ?? {})) {
      expect({
        key,
        slot,
        compatible: isYamlSlotBindingCompatible(proc.masterTag, slot, draft.bindings[key], draft.bindings, proc)
      }).toEqual({ key, slot, compatible: true })
    }
  })

  it('imports its own readable full model export with the prefilled bindings', async () => {
    const { proc, createDoc } = setup()
    const draft = exportProcessDraft(proc)
    await importProcess(proc.masterTag, draft.source, draft.bindings)
    const created = createDoc.mock.calls.map(([clazz, _space, values, id]) => ({ _class: clazz, _id: id, ...values }))
    expect(created).toHaveLength(16)
    const definition = created.find((doc) => doc._class === process.class.Process)
    expect(definition.name).toBe(proc.name)
    expect(
      created
        .filter((doc) => doc._class === process.class.State || doc._class === process.class.Transition)
        .every((doc) => doc.process === definition._id)
    ).toBe(true)
    expect(JSON.stringify(created)).not.toContain('__SLOT_')
    const methods = created
      .filter((doc) => doc._class === process.class.Transition)
      .flatMap((doc) => doc.actions.map((action: { methodId: string }) => action.methodId))
    expect(methods).toContain(process.method.RequestApproval)
    expect(methods).toContain(process.method.RunSubProcess)
    expect(methods).toContain(process.method.LockSection)
  })

  it('detects fields referenced only by task result assignments', async () => {
    const { proc, docs, registry, createDoc } = setup()
    const type = { _class: core.class.ArrOf, of: { _class: core.class.RefTo, to: 'contact:mixin:Employee' } }
    registry.push({
      _id: 'result-only-attribute',
      _class: core.class.Attribute,
      name: 'resultOnly',
      attributeOf: proc.masterTag,
      label: 'embedded:embedded:Only result',
      type
    })
    const producer = docs.find(
      (doc) =>
        doc._class === process.class.Transition &&
        (doc as unknown as { actions: Array<{ results?: unknown[] }> }).actions.some(
          (action) => action.results !== undefined
        )
    )
    const action = (producer as unknown as { actions: Array<{ results?: Array<{ key: string }> }> }).actions.find(
      (action) => action.results !== undefined
    )
    if (action?.results !== undefined) action.results[0].key = 'resultOnly'
    const draft = exportProcessDraft(proc)
    expect(Object.values(draft.bindings)).toContain('resultOnly')
    await importProcess(proc.masterTag, draft.source, draft.bindings)
    const result = createDoc.mock.calls
      .filter((call) => call[0] === process.class.Transition)
      .flatMap((call) =>
        call[2].actions.flatMap((action: { results?: Array<{ key: string }> }) => action.results ?? [])
      )
    expect(result).toEqual([expect.objectContaining({ key: 'resultOnly' })])
  })

  it('keeps platform classes and inherited standard fields as fixed references', () => {
    const { proc, docs, registry } = setup()
    registry.push({ _id: core.class.Doc, _class: core.class.Class, label: 'embedded:embedded:Document' })
    const standard = {
      name: '_id',
      _class: core.class.Attribute,
      attributeOf: core.class.Doc,
      label: core.string.Id,
      type: { _class: core.class.RefTo, to: core.class.Doc }
    }
    registry.push({ _id: 'standard-id-attribute', ...standard })
    const client = (getClient as jest.Mock)()
    const previous = client.getHierarchy()
    client.getHierarchy = () => ({
      ...previous,
      findAttribute: (owner: string, key: string) => (key === '_id' ? standard : previous.findAttribute(owner, key))
    })
    const transition = docs.find((doc) => doc._class === process.class.Transition) as unknown as {
      actions: Array<Record<string, unknown>>
    }
    transition.actions.push({
      _id: 'standard-action',
      methodId: process.method.SetContext,
      context: null,
      params: { value: '${@_id}' }
    })
    const draft = exportProcessDraft(proc)
    expect(Object.values(draft.bindings)).not.toContain(core.class.Doc)
    expect(Object.values(draft.bindings)).not.toContain('_id')
    expect(draft.source).toContain('$card._id')
  })

  it('imports the portable approval process with fresh graph, action, result and context identities', async () => {
    const { docs, bindings, createDoc, commit } = setup()
    const source = exportAuthoringModel(fixture(), 'process')
    await importProcess('test-case' as Ref<MasterTag>, source, bindings)
    const created = createDoc.mock.calls.map(([clazz, _space, values, id]) => ({ _id: id, _class: clazz, ...values }))
    const proc = created.find((doc) => doc._class === process.class.Process) as Process
    const transitions = created.filter((doc) => doc._class === process.class.Transition)
    expect(created).toHaveLength(16)
    expect(proc._id).not.toBe(docs[0]._id)
    expect(proc.masterTag).toBe('test-case')
    expect(transitions.every((transition) => transition.process === proc._id)).toBe(true)
    for (const [key, context] of Object.entries(proc.context)) {
      const producer = transitions.find((transition) => transition._id === context.producer)
      const action = producer.actions.find((action: { _id: string }) => action._id === context.action)
      expect(action).toBeDefined()
      expect(context.value.id).toBe(key)
      expect(action.context?._id === key || action.results?.some((result: { _id: string }) => result._id === key)).toBe(
        true
      )
    }
    expect(JSON.stringify(created)).not.toContain('__SLOT_')
    expect(
      transitions.some((transition) =>
        transition.actions.some((action: { params: Record<string, unknown> }) => action.params._id === 'lock-steps')
      )
    ).toBe(true)
    expect(commit).toHaveBeenCalledWith(true)
  })

  it('saves the current process while preserving identity, rank, native parameters and literal names', async () => {
    const { proc, bindings, docs, updateDoc, removeDoc, createDoc } = setup()
    proc.resultType = { _class: core.class.TypeString, label: core.string.String }
    const portable = fixture()
    ;(portable[0] as Process).name = '__PROCESS__'
    const source = exportAuthoringModel(portable, 'process')
    await updateProcessYaml(proc, source, bindings)
    expect(updateDoc).toHaveBeenCalledWith(
      proc._class,
      proc.space,
      proc._id,
      expect.objectContaining({
        name: '__PROCESS__',
        rank: 'original-rank',
        masterTag: 'test-case',
        $unset: expect.objectContaining({ resultType: true, requiredSlots: true })
      })
    )
    expect(removeDoc).toHaveBeenCalledTimes(15)
    expect(createDoc).toHaveBeenCalledTimes(15)
    expect(
      createDoc.mock.calls
        .filter((call) => call[0] === process.class.State || call[0] === process.class.Transition)
        .every((call) => call[2].process === proc._id)
    ).toBe(true)
    expect(docs).toHaveLength(16)
  })

  it('preserves literal values equal to structural identities while rebinding native expressions', () => {
    const { proc, docs } = setup()
    const client = (getClient as jest.Mock)()
    const transition = docs.find((doc) => doc._class === process.class.Transition) as unknown as {
      actions: Array<Record<string, unknown>>
    }
    transition.actions.push({
      _id: 'extra-action',
      methodId: process.method.UpdateCard,
      context: null,
      params: { status: proc._id, calculated: '${$context(' + Object.keys(proc.context)[0] + ')}' }
    })
    const originalFind = client.getHierarchy().findAttribute
    client.getHierarchy = () => ({
      isDerived: () => false,
      findAttribute: (owner: string, key: string) =>
        key === 'status' ? { type: { _class: core.class.TypeString } } : originalFind(owner, key)
    })
    const rebound = bindYamlModelProcess(docs, proc.masterTag, {}, client.getModel(), client.getHierarchy())
    const action = (
      rebound.find((doc) => doc._class === process.class.Transition) as unknown as {
        actions: Array<{ params: Record<string, string> }>
      }
    ).actions.at(-1)
    expect(action?.params.status).toBe(proc._id)
    expect(action?.params.calculated).not.toContain(Object.keys(proc.context)[0])
  })

  it.each(['missing', 'wrong class', 'wrong process owner', 'wrong field', 'unknown operation', 'unknown function'])(
    'rejects %s before writing',
    async (problem) => {
      const { bindings, createDoc, commit, registry } = setup()
      const portable = fixture()
      if (problem === 'missing') delete bindings['Lock steps']
      if (problem === 'wrong class') bindings['embedded:embedded:Approved'] = 'lock-steps'
      if (problem === 'wrong process owner') {
        Object.assign(registry.find((doc) => doc._id === 'lock-steps') ?? {}, { masterTag: 'foreign' })
      }
      if (problem === 'wrong field') bindings.slot4 = 'approvers'
      if (problem === 'unknown operation') {
        ;(
          portable.find((doc) => doc._class === process.class.Transition) as unknown as {
            actions: Array<{ methodId: string }>
          }
        ).actions[0].methodId = 'missing:method:Operation'
      }
      if (problem === 'unknown function') {
        ;(
          portable.find((doc) => doc._class === process.class.Transition) as unknown as {
            triggerParams: Record<string, string>
          }
        ).triggerParams._id = '${=>MissingFunction()}'
      }
      const log = jest.spyOn(console, 'error').mockImplementation(() => {})
      try {
        await expect(
          importProcess('test-case' as Ref<MasterTag>, exportAuthoringModel(portable, 'process'), bindings)
        ).rejects.toThrow()
        expect(createDoc).not.toHaveBeenCalled()
        expect(commit).not.toHaveBeenCalled()
      } finally {
        log.mockRestore()
      }
    }
  )

  it('binds association and foreign attribute slots against their selected owner', () => {
    const { registry } = setup()
    registry.push({ _id: 'other-class', _class: 'card:class:MasterTag' })
    registry.push({ _id: 'relation', _class: core.class.Association, classA: 'test-case', classB: 'other-class' })
    registry.push({
      _id: 'foreign-field',
      _class: core.class.Attribute,
      name: 'foreignStatus',
      attributeOf: 'other-class',
      type: { _class: core.class.TypeString }
    })
    const master = 'test-case' as Ref<MasterTag>
    const bindings = { foreign: 'other-class' }
    expect(
      isYamlSlotBindingCompatible(
        master,
        { slotKind: 'association', _class: core.class.Association, memberOf: '__SLOT_foreign__' },
        'relation',
        bindings
      )
    ).toBe(true)
    const attribute: AttributeSlotModel = {
      slotKind: 'attribute',
      _class: core.class.Attribute,
      memberOf: '__SLOT_foreign__',
      type: { _class: core.class.TypeString, label: core.string.String }
    }
    expect(isYamlSlotBindingCompatible(master, attribute, 'foreignStatus', bindings)).toBe(true)
    expect(isYamlSlotBindingCompatible(master, attribute, 'owner', bindings)).toBe(false)
  })
})
