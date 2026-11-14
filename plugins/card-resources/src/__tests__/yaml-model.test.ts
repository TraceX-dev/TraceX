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

import core from '@hcengineering/core'
import { getClient } from '@hcengineering/presentation'
import process, { compileProcessYaml, exportAuthoringModel, type AuthoringNativeDocument } from '@hcengineering/process'
import { importModule } from '../exporter'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))
// eslint-disable-next-line @typescript-eslint/naming-convention -- Standard CommonJS runtime global.
declare const __dirname: string
const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs')

function setup (): {
  docs: AuthoringNativeDocument[]
  createDoc: jest.Mock
  addCollection: jest.Mock
  updateDoc: jest.Mock
  commit: jest.Mock
} {
  const docs = compileProcessYaml(
    readFileSync(`${__dirname}/../../../process/docs/examples/risk-management.card.yaml`, 'utf8')
  ).docs
  const owner = docs.find((doc) => doc._class === 'card:class:MasterTag')?._id
  const attribute = docs.find((doc) => doc._class === core.class.Attribute)
  Object.assign(docs.find((doc) => doc._id === owner) ?? {}, { 'core:mixin:VersionableClass': { enabled: true } })
  docs.push({
    _id: 'child',
    _class: 'card:class:MasterTag',
    space: core.space.Model,
    extends: owner,
    label: 'embedded:embedded:Child',
    kind: 0
  })
  docs.push({
    _id: 'viewlet',
    _class: 'view:class:Viewlet',
    space: core.space.Model,
    attachTo: owner,
    config: [attribute?.name, `${String(attribute?.name)}.value`]
  })
  docs.push({
    _id: 'permission',
    _class: core.class.ClassPermission,
    space: core.space.Model,
    targetClass: owner,
    futureOptions: { limit: 4 }
  })
  docs.push({
    _id: 'role',
    _class: 'card:class:Role',
    space: core.space.Model,
    attachedTo: 'card:spaceType:SpaceType',
    attachedToClass: core.class.SpaceType,
    collection: 'roles',
    name: 'Reviewer',
    types: [owner],
    permissions: []
  })
  docs.push({ _id: 'sequence', _class: core.class.Sequence, space: core.space.Workspace, prefix: 'RISK', sequence: 0 })
  docs.push({
    _id: 'identifier',
    _class: core.class.Attribute,
    space: core.space.Model,
    attributeOf: owner,
    name: 'riskId',
    type: { _class: core.class.TypeIdentifier, of: 'sequence' }
  })
  docs.push({
    _id: 'association',
    _class: core.class.Association,
    space: core.space.Model,
    classA: owner,
    classB: 'child',
    nameA: 'Parent',
    nameB: 'Children',
    type: '1:N'
  })
  const registry = [
    ...Object.values(process.method).map((_id) => ({ _id, _class: process.class.Method })),
    ...Object.values(process.trigger).map((_id) => ({ _id, _class: process.class.Trigger })),
    ...Object.values(process.function).map((_id) => ({ _id, _class: process.class.ProcessFunction }))
  ]
  const createDoc = jest.fn().mockResolvedValue(undefined)
  const addCollection = jest.fn().mockResolvedValue(undefined)
  const updateDoc = jest.fn().mockResolvedValue(undefined)
  const commit = jest.fn().mockResolvedValue({ result: true })
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => ({
      isDerived: (clazz: string, parent: string) => clazz === 'card:class:Role' && parent === core.class.AttachedDoc,
      findAttribute: () => undefined
    }),
    getModel: () => ({ findObject: (id: string) => registry.find((doc) => doc._id === id) }),
    apply: () => ({ createDoc, addCollection, updateDoc, commit })
  })
  return { docs, createDoc, addCollection, updateDoc, commit }
}

describe('full card model import', () => {
  it('clones embedded typed results and pipelines while rebinding locally declared card fields', async () => {
    const { createDoc } = setup()
    const client = (getClient as jest.Mock)()
    const previous = client.getModel()
    client.getModel = () => ({
      ...previous,
      findObject: (id: string) =>
        id === process.method.CreateToDo
          ? { ...previous.findObject(id), createdContext: { _class: process.class.ProcessToDo, nameField: 'title' } }
          : previous.findObject(id)
    })
    const source =
      readFileSync(`${__dirname}/../../../process/docs/examples/estimate-review.process.yaml`, 'utf8')
        .replace('kind: process', 'kind: card')
        .replace('    label: Review an estimate', '    masterTag: estimate_card\n    label: Review an estimate')
        .replace(/ {4}slots:[\s\S]*? {4}start:/, '    start:')
        .replace(/\$slots\.cost/g, 'cost')
        .replace(/\$slots\.status/g, 'status') +
      `
cardTypes:
  estimate_card: {label: 'embedded:embedded:Estimate', extends: 'card:class:Card', kind: 0}
fields:
  reviewers: {attributeOf: estimate_card, name: reviewers, type: {array: {ref: contact.mixin.Employee}}}
  cost: {attributeOf: estimate_card, name: cost, type: number}
  status: {attributeOf: estimate_card, name: status, type: string}
`
    await importModule(source, true)
    const copied = createDoc.mock.calls.map(([clazz, space, values, id]) => ({
      _id: id,
      _class: clazz,
      space,
      ...values
    }))
    const definition = copied.find((doc) => doc._class === process.class.Process)
    const transitions = copied.filter((doc) => doc._class === process.class.Transition)
    const task = transitions
      .flatMap((doc) => doc.actions)
      .find((action) => action.methodId === process.method.CreateToDo)
    const calculation = transitions
      .flatMap((doc) => doc.actions)
      .find((action) => action.methodId === process.method.SetContext)
    expect(Object.keys(definition.context)).toHaveLength(4)
    expect(calculation.params.value).toContain('$context(' + task.results[0]._id + ')')
    expect(definition.context[calculation.results[0]._id]).toEqual(
      expect.objectContaining({ isResult: true, action: calculation._id })
    )
    const reviewerField = copied.find(
      (doc) => doc._class === core.class.Attribute && doc.type._class === core.class.ArrOf
    )
    expect(task.params.user).toBe('${@' + reviewerField.name + '}')
    expect(definition.masterTag).toBe(copied.find((doc) => doc._class === 'card:class:MasterTag')._id)
  })

  it('imports an embedded as output using the installed contract without a file catalog', async () => {
    const { createDoc } = setup()
    const client = (getClient as jest.Mock)()
    const previous = client.getModel()
    client.getModel = () => ({
      ...previous,
      findObject: (id: string) =>
        id === process.method.RequestApproval
          ? { ...previous.findObject(id), createdContext: { _class: process.class.ApproveRequest } }
          : previous.findObject(id)
    })
    const source = `version: 2
kind: card
cardTypes:
  approval_card: {label: 'embedded:embedded:Approval card', extends: 'card:class:Card', kind: 0}
fields:
  approvers_field:
    attributeOf: approval_card
    name: approvers
    label: embedded:embedded:Approvers
    type:
      class: core.ArrOf
      of: {class: core.RefTo, to: 'contact:mixin:Employee'}
processes:
  approval:
    label: Approval
    masterTag: approval_card
    start:
      begin:
        to: waiting
        on: OnExecutionStart
        actions:
          request:
            method: RequestApproval
            params: {user: $card.approvers}
            as: approval_request
    states:
      waiting: {label: Waiting}
`
    await importModule(source, true)
    const copied = createDoc.mock.calls.map(([clazz, space, values, id]) => ({
      _id: id,
      _class: clazz,
      space,
      ...values
    }))
    const definition = copied.find((doc) => doc._class === process.class.Process)
    const start = copied.find((doc) => doc._class === process.class.Transition && doc.from === null)
    const output = start.actions[0].context._id
    expect(definition.context[output]).toEqual(
      expect.objectContaining({
        _class: process.class.ApproveRequest,
        action: start.actions[0]._id,
        producer: start._id
      })
    )
    expect(definition.masterTag).toBe(copied.find((doc) => doc._class === 'card:class:MasterTag')._id)
  })

  it('retains native document identities, attachments, mixins and custom data on file import', async () => {
    const { docs, createDoc, addCollection, commit } = setup()
    await importModule(exportAuthoringModel(docs, 'card'))
    expect(createDoc).toHaveBeenCalledTimes(docs.length - 1)
    expect(addCollection).toHaveBeenCalledWith(
      'card:class:Role',
      core.space.Model,
      'card:spaceType:SpaceType',
      core.class.SpaceType,
      'roles',
      expect.objectContaining({ name: 'Reviewer' }),
      'role'
    )
    const original = docs.find((doc) => doc._class === 'card:class:MasterTag')
    expect(createDoc).toHaveBeenCalledWith(
      original?._class,
      core.space.Model,
      expect.objectContaining({ 'core:mixin:VersionableClass': { enabled: true } }),
      original?._id
    )
    expect(createDoc.mock.calls.find((call) => call[3] === 'permission')[2].futureOptions).toEqual({ limit: 4 })
    expect(commit).toHaveBeenCalledWith(true)
  })

  it('creates a fresh module from the editor and rebinds dependent types, attributes, roles and graph references', async () => {
    const { docs, createDoc, addCollection, updateDoc } = setup()
    const before = JSON.stringify(docs)
    await importModule(exportAuthoringModel(docs, 'card'), true)
    const copied = createDoc.mock.calls.map(([clazz, space, values, id]) => ({
      _id: id,
      _class: clazz,
      space,
      ...values
    }))
    const owner = copied.find((doc) => doc._class === 'card:class:MasterTag' && doc.label !== 'embedded:embedded:Child')
    const child = copied.find((doc) => doc.label === 'embedded:embedded:Child')
    expect(copied.every((doc) => !docs.some((original) => original._id === doc._id))).toBe(true)
    expect(child.extends).toBe(owner._id)
    expect(
      copied.filter((doc) => doc._class === core.class.Attribute).every((doc) => doc.attributeOf === owner._id)
    ).toBe(true)
    expect(copied.find((doc) => doc._class === core.class.Association)).toEqual(
      expect.objectContaining({ classA: owner._id, classB: child._id })
    )
    expect(addCollection.mock.calls[0][5].types).toEqual([owner._id])
    const definition = copied.find((doc) => doc._class === process.class.Process)
    expect(definition.masterTag).toBe(owner._id)
    expect(
      copied
        .filter((doc) => doc._class === process.class.State || doc._class === process.class.Transition)
        .every((doc) => doc.process === definition._id)
    ).toBe(true)
    expect(copied.find((doc) => doc.name === 'riskId').type.of).toBe(
      copied.find((doc) => doc._class === core.class.Sequence)._id
    )
    expect(updateDoc).not.toHaveBeenCalled()
    expect(JSON.stringify(docs)).toBe(before)
  })

  it('reports unavailable operations before opening an apply transaction', async () => {
    const { docs, createDoc, commit } = setup()
    const transition = docs.find(
      (doc) => doc._class === process.class.Transition && (doc.actions as unknown[]).length > 0
    )
    ;(transition?.actions as Array<Record<string, unknown>>)[0].methodId = 'missing:method:Operation'
    const log = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(importModule(exportAuthoringModel(docs, 'card'))).rejects.toThrow('not registered')
      expect(createDoc).not.toHaveBeenCalled()
      expect(commit).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})
