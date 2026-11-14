// Copyright © 2026 TraceX SAS.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import card from '@hcengineering/card'
import core, { type Doc, type Ref } from '@hcengineering/core'
import marketplace, {
  createDefinitionPackageRelease,
  prepareDefinitionPackageUpdate,
  type DefinitionPackageDestination,
  type DefinitionPackageInstallation
} from '@hcengineering/marketplace'
import { getClient } from '@hcengineering/presentation'
import process from '@hcengineering/process'
import {
  disconnectDefinitionPackage,
  installDefinitionPackage,
  reviewDefinitionPackageUpdate,
  updateDefinitionPackage
} from '../installations'

jest.mock('@hcengineering/presentation', () => ({ getClient: jest.fn() }))

const source = `version: 2
kind: process
processes:
  review:
    label: Review
    states:
      done: {}
`
const identifierModule = `version: 2
kind: card
cardTypes:
  purchase:
    label: Purchase
    extends: card:class:Card
    fields:
      purchase_id: {name: purchaseId, label: Purchase ID, type: {class: core.TypeIdentifier, of: purchase_sequence}}
sequences:
  purchase_sequence:
    space: core:space:Workspace
    attachedTo: core:class:CustomSequence
    prefix: PO
    sequence: 0
`
const destinations: Record<string, DefinitionPackageDestination> = {
  review: { masterTag: 'destination' as DefinitionPackageDestination['masterTag'], bindings: {} }
}

function workspace (): {
  docs: Doc[]
  createDoc: jest.Mock
  updateDoc: jest.Mock
  removeDoc: jest.Mock
  commit: jest.Mock
  apply: jest.Mock
  findOne: jest.Mock
  findAll: jest.Mock
} {
  const docs = [{ _id: 'destination', _class: card.class.MasterTag }] as unknown as Doc[]
  const createDoc = jest.fn().mockResolvedValue(undefined)
  const updateDoc = jest.fn().mockResolvedValue(undefined)
  const removeDoc = jest.fn().mockResolvedValue(undefined)
  const commit = jest.fn().mockResolvedValue({ result: true })
  const apply = jest.fn(() => ({ createDoc, updateDoc, removeDoc, commit, match: jest.fn(), notMatch: jest.fn() }))
  const findOne = jest.fn()
  const findAll = jest.fn().mockResolvedValue([])
  ;(getClient as jest.Mock).mockReturnValue({
    getHierarchy: () => ({
      isDerived: (actual: string, expected: string) => actual === expected,
      findAttribute: () => undefined
    }),
    getModel: () => ({
      findObject: (id: string) => docs.find((doc) => doc._id === id),
      findAllSync: (clazz: string, query: Record<string, unknown>) =>
        docs.filter(
          (doc) =>
            doc._class === clazz &&
            Object.entries(query).every(([key, value]) => (doc as unknown as Record<string, unknown>)[key] === value)
        )
    }),
    apply,
    findOne,
    findAll
  })
  return { docs, createDoc, updateDoc, removeDoc, commit, apply, findOne, findAll }
}

async function release (value = source, version = '1.0.0'): ReturnType<typeof createDefinitionPackageRelease> {
  return await createDefinitionPackageRelease({
    package: { id: 'acme/review', version, author: 'original-author' },
    source: value
  })
}

describe('package workspace writes', () => {
  it('creates identifier counters in Workspace and retains issued numbers on package updates', async () => {
    const ws = workspace()
    await installDefinitionPackage(await release(identifierModule), {})
    let counter: Doc | undefined
    for (const [clazz, space, data, id] of ws.createDoc.mock.calls) {
      const doc: Doc = { ...data, _id: id, _class: clazz, space, modifiedOn: 1, modifiedBy: core.account.System }
      if (clazz === core.class.CustomSequence) counter = doc
      else ws.docs.push(doc)
    }
    expect(counter).toMatchObject({ space: core.space.Workspace, sequence: 0 })
    Object.assign(counter ?? {}, { sequence: 57 })
    ws.findAll.mockResolvedValue([counter])
    const installation = ws.docs.find(
      (doc) => doc._class === marketplace.class.DefinitionPackageInstallation
    ) as DefinitionPackageInstallation
    ws.findOne.mockResolvedValue(installation)
    const incoming = await release(identifierModule.replace('label: Purchase\n', 'label: Updated purchase\n'), '1.0.1')
    const preview = await reviewDefinitionPackageUpdate(installation, incoming, {}, {})
    expect(preview.blocked).toBe(false)
    expect(preview.current).toContain(counter)
    ws.createDoc.mockClear()
    await updateDefinitionPackage(installation, incoming, {}, {}, preview.fingerprint)
    expect(ws.findAll).toHaveBeenCalledWith(core.class.Sequence, {
      _id: { $in: [installation.identities.purchase_sequence] }
    })
    expect(ws.createDoc).not.toHaveBeenCalled()
    expect(ws.updateDoc.mock.calls.some((call) => call[0] === core.class.CustomSequence)).toBe(false)
    expect(counter).toMatchObject({ sequence: 57 })
    expect(ws.updateDoc.mock.calls.map((call) => call[0])).toEqual([
      card.class.MasterTag,
      marketplace.class.DefinitionPackageInstallation
    ])
  })
  it('saves the installation baseline and all definitions through the same workspace batch', async () => {
    const ws = workspace()
    const id = await installDefinitionPackage(await release(), destinations)
    expect(ws.apply).toHaveBeenCalledTimes(1)
    expect(ws.createDoc).toHaveBeenCalledWith(
      marketplace.class.DefinitionPackageInstallation,
      core.space.Configuration,
      expect.objectContaining({
        package: expect.objectContaining({ author: 'original-author' }),
        release: expect.stringContaining('processes:')
      }),
      id
    )
    expect(ws.createDoc.mock.calls.filter((call) => call[0] === process.class.Process)).toHaveLength(1)
    expect(ws.commit).toHaveBeenCalledTimes(1)
  })

  it('performs no writes when a member is missing its destination', async () => {
    const ws = workspace()
    await expect(installDefinitionPackage(await release(), {})).rejects.toThrow('Select a destination')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('rejects changed definitions after preview before staging an update', async () => {
    const ws = workspace()
    await installDefinitionPackage(await release(), destinations)
    for (const [clazz, space, data, id] of ws.createDoc.mock.calls) {
      const doc: Doc = { ...data, _id: id, _class: clazz, space, modifiedOn: 1, modifiedBy: core.account.System }
      ws.docs.push(doc)
    }
    const installation = ws.docs.find(
      (doc) => doc._class === marketplace.class.DefinitionPackageInstallation
    ) as DefinitionPackageInstallation
    ws.findOne.mockResolvedValue(installation)
    const incoming = await release(source.replace('label: Review', 'label: Published review'), '1.0.1')
    const client = getClient()
    const preview = await prepareDefinitionPackageUpdate(
      installation,
      incoming,
      destinations,
      {},
      client.getModel(),
      client.getHierarchy()
    )
    Object.assign(ws.docs.find((doc) => doc._class === process.class.Process) ?? {}, { description: 'Concurrent edit' })
    ws.apply.mockClear()
    await expect(
      updateDefinitionPackage(
        installation,
        incoming,
        destinations,
        { [installation.identities.review]: 'upstream' },
        preview.fingerprint
      )
    ).rejects.toThrow('Local definitions changed')
    expect(ws.apply).not.toHaveBeenCalled()
  })

  it('updates the existing process and release together without rewriting unchanged states', async () => {
    const ws = workspace()
    await installDefinitionPackage(await release(), destinations)
    for (const [clazz, space, data, id] of ws.createDoc.mock.calls) {
      const doc: Doc = { ...data, _id: id, _class: clazz, space, modifiedOn: 1, modifiedBy: core.account.System }
      ws.docs.push(doc)
    }
    const installation = ws.docs.find(
      (doc) => doc._class === marketplace.class.DefinitionPackageInstallation
    ) as DefinitionPackageInstallation
    ws.findOne.mockResolvedValue(installation)
    const incoming = await release(source.replace('label: Review', 'label: Published review'), '1.0.1')
    const client = getClient()
    const preview = await prepareDefinitionPackageUpdate(
      installation,
      incoming,
      destinations,
      {},
      client.getModel(),
      client.getHierarchy()
    )
    ws.createDoc.mockClear()
    ws.commit.mockClear()
    await updateDefinitionPackage(installation, incoming, destinations, {}, preview.fingerprint)
    expect(ws.createDoc).not.toHaveBeenCalled()
    expect(ws.removeDoc).not.toHaveBeenCalled()
    expect(ws.updateDoc.mock.calls.map((call) => call[0])).toEqual([
      process.class.Process,
      marketplace.class.DefinitionPackageInstallation
    ])
    expect(ws.updateDoc).toHaveBeenCalledWith(
      process.class.Process,
      core.space.Model,
      installation.identities.review,
      expect.objectContaining({ name: 'Published review' })
    )
    expect(ws.updateDoc).toHaveBeenCalledWith(
      marketplace.class.DefinitionPackageInstallation,
      core.space.Configuration,
      installation._id,
      expect.objectContaining({ package: expect.objectContaining({ version: '1.0.1' }) })
    )
    expect(ws.commit).toHaveBeenCalledTimes(1)
  })

  it('disconnects the record and matching links without deleting installed definitions', async () => {
    const ws = workspace()
    await installDefinitionPackage(await release(), destinations)
    for (const [clazz, space, data, id] of ws.createDoc.mock.calls) {
      const doc: Doc = { ...data, _id: id, _class: clazz, space, modifiedOn: 1, modifiedBy: core.account.System }
      ws.docs.push(doc)
    }
    const installation = ws.docs.find(
      (doc) => doc._class === marketplace.class.DefinitionPackageInstallation
    ) as DefinitionPackageInstallation
    await disconnectDefinitionPackage(installation)
    expect(ws.removeDoc).toHaveBeenCalledTimes(1)
    expect(ws.removeDoc).toHaveBeenCalledWith(installation._class, installation.space, installation._id)
    expect(ws.updateDoc).toHaveBeenCalledWith(
      process.class.Process,
      core.space.Model,
      installation.identities.review as Ref<Doc>,
      { $unset: { definitionPackageInstallation: true, definitionPackage: true } }
    )
  })
})
