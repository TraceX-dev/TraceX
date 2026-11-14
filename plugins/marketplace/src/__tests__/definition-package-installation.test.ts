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
import core, { type Doc, type Hierarchy, type ModelDb, type Ref } from '@hcengineering/core'
import process from '@hcengineering/process'
import { createDefinitionPackageRelease } from '../definition-package'
import {
  getDefinitionPackageProcessSlots,
  prepareDefinitionPackageInstallation
} from '../definition-package-installation'
import type { Process } from '@hcengineering/process'
import { prepareDefinitionPackageUpdate } from '../definition-package-update'
import type { DefinitionPackageDestination, DefinitionPackageInstallation } from '../types'
import marketplace from '../index'

const bundle = `version: 2
kind: process
processes:
  parent:
    label: Parent
    slots:
      status: {type: string}
      child_process: {kind: process, class: process.Process}
    bindings:
      child_process: child
    start:
      parent_start:
        to: parent_done
        on: OnExecutionStart
        actions:
          set_status:
            method: UpdateCard
            params: {$slots.status: child_done}
          run_child:
            method: RunSubProcess
            params: {_id: $slots.child_process}
    states:
      parent_done: {}
  child:
    label: Child
    start:
      child_start:
        to: child_done
        on: OnExecutionStart
    states:
      child_done: {}
`
const moduleSource = `version: 2
kind: card
cardTypes:
  purchase:
    label: Purchase
    extends: card:class:Card
    kind: 0
    fields:
      amount_field: {name: amount, label: Amount, type: number, isCustom: true}
`
const identifierModule =
  moduleSource +
  `      identifier: {name: purchaseId, label: Purchase ID, type: {class: core.TypeIdentifier, of: purchase_sequence}}
sequences:
  purchase_sequence:
    space: core:space:Workspace
    attachedTo: core:class:CustomSequence
    prefix: PO
    sequence: 0
`

function workspace (): { model: ModelDb, hierarchy: Hierarchy, docs: Doc[] } {
  const docs = [
    { _id: 'destination', _class: card.class.MasterTag },
    { _id: process.trigger.OnExecutionStart, _class: process.class.Trigger },
    { _id: process.method.UpdateCard, _class: process.class.Method, objectClass: card.class.Card },
    { _id: process.method.RunSubProcess, _class: process.class.Method, objectClass: card.class.Card }
  ] as unknown as Doc[]
  const model = {
    findObject: (id: string) => docs.find((doc) => doc._id === id),
    findAllSync: (clazz: string, query: Record<string, unknown>) =>
      docs.filter(
        (doc) =>
          doc._class === clazz &&
          Object.entries(query).every(([key, value]) => (doc as unknown as Record<string, unknown>)[key] === value)
      )
  } as unknown as ModelDb
  const hierarchy = {
    isDerived: (actual: string, expected: string) => actual === expected,
    findAttribute: (_owner: string, name: string) =>
      name === 'status'
        ? {
            name,
            attributeOf: 'destination',
            _class: core.class.Attribute,
            type: { _class: core.class.TypeString }
          }
        : undefined
  } as unknown as Hierarchy
  return { model, hierarchy, docs }
}

const destinations: Record<string, DefinitionPackageDestination> = {
  parent: { masterTag: 'destination' as DefinitionPackageDestination['masterTag'], bindings: { status: 'status' } },
  child: { masterTag: 'destination' as DefinitionPackageDestination['masterTag'], bindings: {} }
}

async function release (source = bundle, version = '1.0.0'): ReturnType<typeof createDefinitionPackageRelease> {
  return await createDefinitionPackageRelease({
    package: { id: 'acme/review', version, author: 'original-author' },
    source
  })
}

describe('workspace package installations', () => {
  it('installs identifier sequences in their workspace space and remaps the field reference', async () => {
    const { model, hierarchy } = workspace()
    const prepared = await prepareDefinitionPackageInstallation(
      await release(identifierModule),
      {},
      'id' as Ref<DefinitionPackageInstallation>,
      model,
      hierarchy
    )
    expect(prepared.documents.find((doc) => doc._class === core.class.CustomSequence)).toMatchObject({
      space: core.space.Workspace,
      prefix: 'PO',
      sequence: 0
    })
    expect(prepared.documents.find((doc) => doc._id === prepared.installation.identities.identifier)).toMatchObject({
      type: { _class: core.class.TypeIdentifier, of: prepared.installation.identities.purchase_sequence }
    })
  })

  it('starts a fresh identifier counter instead of copying issued numbers from the source', async () => {
    const { model, hierarchy } = workspace()
    const prepared = await prepareDefinitionPackageInstallation(
      await release(identifierModule.replace('sequence: 0', 'sequence: 91')),
      {},
      'id' as Ref<DefinitionPackageInstallation>,
      model,
      hierarchy
    )
    expect(prepared.documents.find((doc) => doc._class === core.class.CustomSequence)).toMatchObject({ sequence: 0 })
  })

  it('rejects other non-model documents and counters stored in an unsupported space', async () => {
    const { model, hierarchy } = workspace()
    await expect(
      prepareDefinitionPackageInstallation(
        await release(
          moduleSource.replace('    label: Purchase', '    space: core:space:Workspace\n    label: Purchase')
        ),
        {},
        'id' as Ref<DefinitionPackageInstallation>,
        model,
        hierarchy
      )
    ).rejects.toThrow('documents.purchase.space')
    await expect(
      prepareDefinitionPackageInstallation(
        await release(identifierModule.replace('core:space:Workspace', 'core:space:Configuration')),
        {},
        'id' as Ref<DefinitionPackageInstallation>,
        model,
        hierarchy
      )
    ).rejects.toThrow('documents.purchase_sequence.space')
  })
  it('binds internal calls within one installation, preserves literals and creates independent instances', async () => {
    const { model, hierarchy } = workspace()
    const artifact = await release()
    const members = artifact.definition.docs.filter(
      (doc) => doc._class === process.class.Process
    ) as unknown as Process[]
    expect(Object.keys(getDefinitionPackageProcessSlots(members[0], members))).toEqual(['status'])
    const first = await prepareDefinitionPackageInstallation(
      artifact,
      destinations,
      'first' as Ref<DefinitionPackageInstallation>,
      model,
      hierarchy
    )
    const second = await prepareDefinitionPackageInstallation(
      artifact,
      destinations,
      'second' as Ref<DefinitionPackageInstallation>,
      model,
      hierarchy
    )
    expect(first.installation.package.author).toBe('original-author')
    expect(first.installation.release).toContain('processes:')
    const transition = first.documents.find(
      (doc) => doc._id === first.installation.identities.parent_start
    ) as unknown as {
      actions: Array<{ params: Record<string, string> }>
    }
    expect(transition.actions[0].params.status).toBe('child_done')
    expect(transition.actions[1].params._id).toBe(first.installation.identities.child)
    const allIds = new Set(first.documents.map((doc) => doc._id))
    expect(second.documents.every((doc) => !allIds.has(doc._id))).toBe(true)
    expect(first.documents.find((doc) => doc._id === first.installation.identities.parent)).toMatchObject({
      masterTag: 'destination',
      definitionPackage: { author: 'original-author' },
      definitionPackageInstallation: { id: 'first', member: 'parent' }
    })
  })

  it('validates every destination and slot instead of returning a partially installable bundle', async () => {
    const { model, hierarchy } = workspace()
    const artifact = await release()
    await expect(
      prepareDefinitionPackageInstallation(
        artifact,
        { parent: destinations.parent },
        'id' as Ref<DefinitionPackageInstallation>,
        model,
        hierarchy
      )
    ).rejects.toThrow('Select a destination')
    await expect(
      prepareDefinitionPackageInstallation(
        artifact,
        { ...destinations, parent: { ...destinations.parent, bindings: { status: 'missing' } } },
        'id' as Ref<DefinitionPackageInstallation>,
        model,
        hierarchy
      )
    ).rejects.toThrow('compatible slot')
    const otherType = { _id: 'other-type', _class: card.class.MasterTag } as unknown as Doc
    const other = workspace()
    other.docs.push(otherType)
    await expect(
      prepareDefinitionPackageInstallation(
        artifact,
        {
          ...destinations,
          child: { masterTag: otherType._id as DefinitionPackageDestination['masterTag'], bindings: {} }
        },
        'id' as Ref<DefinitionPackageInstallation>,
        other.model,
        other.hierarchy
      )
    ).rejects.toThrow('compatible slot')
  })

  it('creates card module identities without taking over existing workspace definitions', async () => {
    const { model, hierarchy, docs } = workspace()
    docs.push({ _id: 'purchase', _class: card.class.MasterTag, name: 'Unrelated local type' } as unknown as Doc)
    const prepared = await prepareDefinitionPackageInstallation(
      await release(moduleSource),
      {},
      'id' as Ref<DefinitionPackageInstallation>,
      model,
      hierarchy
    )
    expect(prepared.installation.identities.purchase).not.toBe('purchase')
    const field = prepared.documents.find((doc) => doc._class === core.class.Attribute) as unknown as {
      attributeOf: string
      name: string
    }
    expect(field.attributeOf).toBe(prepared.installation.identities.purchase)
    expect(field.name).toBe('amount')
  })
})

describe('reviewed workspace package updates', () => {
  async function installed (
    source = bundle
  ): Promise<ReturnType<typeof workspace> & { installation: DefinitionPackageInstallation }> {
    const ws = workspace()
    const prepared = await prepareDefinitionPackageInstallation(
      await release(source),
      source === bundle ? destinations : {},
      'installation' as Ref<DefinitionPackageInstallation>,
      ws.model,
      ws.hierarchy
    )
    ws.docs.push(...prepared.documents)
    const installation: DefinitionPackageInstallation = {
      _id: 'installation' as Ref<DefinitionPackageInstallation>,
      _class: marketplace.class.DefinitionPackageInstallation,
      space: core.space.Configuration,
      modifiedOn: 0,
      modifiedBy: core.account.System,
      ...prepared.installation
    }
    return { ...ws, installation }
  }

  it('preserves issued identifier numbers loaded outside ModelDb during a display update', async () => {
    const { model, hierarchy, docs, installation } = await installed(identifierModule)
    const index = docs.findIndex((doc) => doc._class === core.class.CustomSequence)
    const [counter] = docs.splice(index, 1)
    Object.assign(counter, { sequence: 73 })
    const incoming = await release(identifierModule.replace('label: Purchase\n', 'label: Updated purchase\n'), '1.0.1')
    const plan = await prepareDefinitionPackageUpdate(installation, incoming, {}, {}, model, hierarchy, [counter])
    expect(plan.blocked).toBe(false)
    expect(plan.changes.some((change) => change.key === counter._id)).toBe(false)
    expect(plan.documents.find((doc) => doc._id === counter._id)).toMatchObject({
      sequence: 73,
      space: core.space.Workspace
    })
    expect(plan.current).toContain(counter)
    expect(plan.removed).not.toContain(counter)
  })

  it('updates one process in place while preserving an independent local edit on another member', async () => {
    const { model, hierarchy, docs, installation } = await installed()
    const parent = docs.find((doc) => doc._id === installation.identities.parent)
    Object.assign(parent ?? {}, { description: 'Local parent change' })
    Object.assign(docs.find((doc) => doc._id === installation.identities.child) ?? {}, { rank: 'custom-rank' })
    const incoming = await release(bundle.replace('label: Child', 'label: Updated child'), '1.0.1')
    const plan = await prepareDefinitionPackageUpdate(installation, incoming, destinations, {}, model, hierarchy)
    expect(plan.blocked).toBe(false)
    expect(plan.documents.find((doc) => doc._id === installation.identities.parent)).toMatchObject({
      description: 'Local parent change'
    })
    expect(plan.documents.find((doc) => doc._id === installation.identities.child)).toMatchObject({
      name: 'Updated child',
      rank: 'custom-rank'
    })
    expect(plan.installation.identities.parent).toBe(installation.identities.parent)
    expect(plan.installation.package.version).toBe('1.0.1')
  })

  it('requires explicit conflict resolution and preserves or replaces the whole selected process graph', async () => {
    const { model, hierarchy, docs, installation } = await installed()
    Object.assign(docs.find((doc) => doc._id === installation.identities.child) ?? {}, { description: 'Local child' })
    const incoming = await release(bundle.replace('label: Child', 'label: Published child'), '1.0.1')
    const unresolved = await prepareDefinitionPackageUpdate(installation, incoming, destinations, {}, model, hierarchy)
    const key = installation.identities.child
    expect(unresolved.blocked).toBe(true)
    expect(unresolved.changes.find((change) => change.key === key)?.resolution).toBe('conflict')
    expect(unresolved.reviews[key].local).toContain('Local child')
    expect(unresolved.reviews[key].incoming).toContain('Published child')
    const local = await prepareDefinitionPackageUpdate(
      installation,
      incoming,
      destinations,
      { [key]: 'local' },
      model,
      hierarchy
    )
    expect(local.blocked).toBe(false)
    expect(local.documents.find((doc) => doc._id === key)).toMatchObject({ description: 'Local child', name: 'Child' })
    const upstream = await prepareDefinitionPackageUpdate(
      installation,
      incoming,
      destinations,
      { [key]: 'upstream' },
      model,
      hierarchy
    )
    expect(upstream.blocked).toBe(false)
    expect(upstream.documents.find((doc) => doc._id === key)).toMatchObject({ name: 'Published child' })
    expect(upstream.documents.find((doc) => doc._id === key)).not.toHaveProperty('description', 'Local child')
  })

  it('keeps schema identities for display updates and blocks destructive field changes', async () => {
    const { model, hierarchy, installation } = await installed(moduleSource)
    const cosmetic = await prepareDefinitionPackageUpdate(
      installation,
      await release(moduleSource.replace('label: Amount', 'label: Total amount'), '1.0.1'),
      {},
      {},
      model,
      hierarchy
    )
    expect(cosmetic.blocked).toBe(false)
    expect(cosmetic.documents.find((doc) => doc._class === core.class.Attribute)?._id).toBe(
      installation.identities.amount_field
    )
    const destructive = await prepareDefinitionPackageUpdate(
      installation,
      await release(moduleSource.replace('type: number', 'type: string'), '1.0.1'),
      {},
      {},
      model,
      hierarchy
    )
    expect(destructive.blocked).toBe(true)
    expect(destructive.changes.some((change) => change.impact === 'destructive')).toBe(true)
  })

  it('blocks a destructive transition from the local schema even when the published change is cosmetic', async () => {
    const { model, hierarchy, docs, installation } = await installed(moduleSource)
    Object.assign(docs.find((doc) => doc._class === core.class.Attribute) ?? {}, {
      type: { _class: core.class.TypeString }
    })
    const incoming = await release(moduleSource.replace('label: Amount', 'label: Total amount'), '1.0.1')
    const key = installation.identities.amount_field
    const upstream = await prepareDefinitionPackageUpdate(
      installation,
      incoming,
      {},
      { [key]: 'upstream' },
      model,
      hierarchy
    )
    expect(upstream.blocked).toBe(true)
    expect(upstream.changes.find((change) => change.key === key)?.impact).toBe('destructive')
    const local = await prepareDefinitionPackageUpdate(installation, incoming, {}, { [key]: 'local' }, model, hierarchy)
    expect(local.blocked).toBe(false)
    expect(local.documents.find((doc) => doc._class === core.class.Attribute)).toMatchObject({
      type: { _class: core.class.TypeString }
    })
  })

  it('requires restoring a locally deleted member that an incoming process depends on', async () => {
    const { model, hierarchy, docs, installation } = await installed()
    const child = installation.identities.child
    docs.splice(
      docs.findIndex((doc) => doc._id === child),
      1
    )
    const incoming = await release(bundle.replace('label: Parent', 'label: Updated parent'), '1.0.1')
    const unresolved = await prepareDefinitionPackageUpdate(installation, incoming, destinations, {}, model, hierarchy)
    expect(unresolved.blocked).toBe(true)
    expect(unresolved.missingDependencies).toBe(true)
    const forged = { ...incoming, definition: { ...incoming.definition, docs: [] } }
    expect(
      (await prepareDefinitionPackageUpdate(installation, forged, destinations, {}, model, hierarchy))
        .missingDependencies
    ).toBe(true)
    const restored = await prepareDefinitionPackageUpdate(
      installation,
      incoming,
      destinations,
      { [child]: 'upstream' },
      model,
      hierarchy
    )
    expect(restored.blocked).toBe(false)
    expect(restored.missingDependencies).toBe(false)
    expect(restored.documents.some((doc) => doc._id === child)).toBe(true)
  })

  it('rejects unmanaged local identity collisions instead of creating parallel schema definitions', async () => {
    const { model, hierarchy, docs, installation } = await installed(moduleSource)
    docs.push({
      _id: 'local_field',
      _class: core.class.Attribute,
      space: core.space.Model,
      attributeOf: installation.identities.purchase,
      name: 'local',
      type: { _class: core.class.TypeString }
    } as unknown as Doc)
    const incoming = await release(
      moduleSource + '      local_field: {name: local, label: Local, type: string}\n',
      '1.0.1'
    )
    await expect(prepareDefinitionPackageUpdate(installation, incoming, {}, {}, model, hierarchy)).rejects.toThrow(
      'unmanaged local definition'
    )
  })
})
