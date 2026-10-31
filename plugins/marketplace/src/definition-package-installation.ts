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
import core, { generateId, type Doc, type Hierarchy, type ModelDb, type Ref } from '@hcengineering/core'
import process, {
  authoringDataEqual,
  bindYamlModelProcess,
  compileProcessYaml,
  cloneAuthoringModule,
  getAuthoringProcessIdentities,
  isAuthoringSlotBindingCompatible,
  validateAuthoringModelOperations,
  type Process,
  type SlotModel
} from '@hcengineering/process'
import {
  createDefinitionPackageRelease,
  DefinitionPackageError,
  serializeDefinitionPackageRelease
} from './definition-package'
import type { DefinitionPackageRelease } from './definition-package-types'
import type { DefinitionPackageDestination, DefinitionPackageInstallation, DefinitionPackageOwner } from './types'

export interface PreparedDefinitionPackageInstallation {
  documents: Doc[]
  installation: Omit<DefinitionPackageInstallation, keyof Doc>
}

/** Lists bindings supplied by the workspace; typed references to bundled processes are resolved internally. */
export function getDefinitionPackageProcessSlots (
  definition: Process,
  members: readonly Process[]
): Record<string, SlotModel> {
  return Object.fromEntries(
    Object.entries(definition.requiredSlots ?? {}).filter(
      ([key, slot]) =>
        slot.slotKind !== 'process' || !members.some((member) => member._id === definition.bindings?.[key])
    )
  )
}

/** Validates a complete package and resolves every identity before any workspace write. */
export async function prepareDefinitionPackageInstallation (
  release: DefinitionPackageRelease,
  destinations: Record<string, DefinitionPackageDestination>,
  installationId: Ref<DefinitionPackageInstallation>,
  model: ModelDb,
  hierarchy: Hierarchy,
  existingIdentities: Readonly<Record<string, string>> = {}
): Promise<PreparedDefinitionPackageInstallation> {
  const previousIdentities = new Map(Object.entries(existingIdentities))
  const verified = await createDefinitionPackageRelease({
    package: release.package,
    source: release.source,
    contentHash: release.contentHash
  })
  const definition = compileProcessYaml(verified.source, model)
  for (const doc of definition.docs) {
    if (doc._class === process.class.Process || doc._class === card.class.MasterTag || doc._class === card.class.Tag) {
      Reflect.deleteProperty(doc, 'definitionPackage')
      Reflect.deleteProperty(doc, 'definitionPackageInstallation')
    }
  }
  for (const doc of definition.docs) {
    const sequence = doc._class === core.class.Sequence || doc._class === core.class.CustomSequence
    if (sequence && definition.kind === 'card' && doc.space === core.space.Workspace) {
      doc.sequence = 0
      continue
    }
    if (doc.space !== core.space.Model || sequence) {
      throw new DefinitionPackageError(
        `documents.${doc._id}.space`,
        `Unsupported package document ${doc._class} in ${doc.space}; expected model definitions or workspace identifier sequences`
      )
    }
  }
  validateAuthoringModelOperations(definition.docs, model, hierarchy)
  const name = definition.docs
    .filter(
      (doc) =>
        doc._class === (definition.kind === 'process' ? process.class.Process : card.class.MasterTag) ||
        (definition.kind === 'card' && doc._class === card.class.Tag)
    )
    .map((doc) => String(doc.name ?? doc.label ?? doc._id).replace(/^embedded:embedded:/, ''))
    .join(', ')
  const roots = definition.docs.filter((doc) => doc._class === process.class.Process)
  const shared = definition.docs.filter(
    (doc) =>
      ![String(process.class.Process), String(process.class.State), String(process.class.Transition)].includes(
        doc._class
      )
  )
  if (previousIdentities.size > 0) {
    for (const doc of definition.docs) {
      if (doc._class === process.class.State || doc._class === process.class.Transition) continue
      if (!previousIdentities.has(doc._id) && model.findObject(doc._id as Ref<Doc>) !== undefined) {
        throw new DefinitionPackageError(
          'identities',
          'A new package component matches an unmanaged local definition; resolve its ownership before updating'
        )
      }
    }
  }
  const identities = new Map(
    [...new Set([...definition.docs.map((doc) => doc._id), ...getAuthoringProcessIdentities(definition.docs)])].map(
      (id) => [id, previousIdentities.get(id) ?? String(generateId())]
    )
  )
  const documents = new Map<string, Doc>()
  if (definition.kind === 'card') {
    if (Object.keys(destinations).length !== 0) {
      throw new DefinitionPackageError('processes', 'Card modules create their own destination types')
    }
    const cloned = cloneAuthoringModule(definition.docs, model, hierarchy, identities)
    const owners = cloned.filter((doc) => doc._class === card.class.MasterTag || doc._class === card.class.Tag)
    for (const owner of owners) {
      const member: DefinitionPackageOwner = owner
      const original = definition.docs.find((doc) => identities.get(doc._id) === owner._id)
      if (original === undefined) throw new DefinitionPackageError('cardTypes', 'Missing package identity')
      member.definitionPackageInstallation = { id: installationId, member: original._id }
      if (verified.package.author !== undefined) {
        member.definitionPackage = {
          ...verified.package,
          author: verified.package.author,
          members: owners.map((doc) => doc._id)
        }
      }
    }
    return {
      documents: cloned,
      installation: {
        name,
        package: verified.package,
        release: serializeDefinitionPackageRelease(verified),
        identities: Object.fromEntries(identities),
        destinations: {}
      }
    }
  }
  if (shared.some((doc) => doc._class !== core.class.Enum)) {
    throw new DefinitionPackageError(
      'documents',
      'Process packages support process graphs and enum dependencies; use a card module for other model definitions'
    )
  }
  for (const root of roots) {
    if (!Object.hasOwn(destinations, root._id)) {
      throw new DefinitionPackageError(`processes.${root._id}`, 'Select a destination card type')
    }
  }
  const localMembers = roots.map((root) => ({
    ...root,
    _id: identities.get(root._id),
    masterTag: destinations[root._id]?.masterTag
  })) as unknown as Doc[]
  for (const root of roots) {
    const target = destinations[root._id]
    if (target === undefined) {
      throw new DefinitionPackageError(`processes.${root._id}`, 'Select a destination card type')
    }
    const owner = model.findObject(target.masterTag)
    if (owner === undefined || (owner._class !== card.class.MasterTag && owner._class !== card.class.Tag)) {
      throw new DefinitionPackageError(`processes.${root._id}`, 'The destination card type is unavailable')
    }
    const native = [root, ...definition.docs.filter((doc) => doc.process === root._id), ...shared]
    const proc = root as unknown as Process
    const bindings = { ...target.bindings }
    for (const [key, slot] of Object.entries(proc.requiredSlots ?? {})) {
      const internal = proc.bindings?.[key]
      if (slot.slotKind === 'process' && internal !== undefined && roots.some((root) => root._id === internal)) {
        bindings[key] = identities.get(internal) as string
      }
    }
    for (const [key, slot] of Object.entries(proc.requiredSlots ?? {})) {
      const value = bindings[key]
      if (
        value === undefined ||
        !isAuthoringSlotBindingCompatible(target.masterTag, slot, value, bindings, model, hierarchy, proc, [
          ...(native as unknown as Doc[]),
          ...localMembers
        ])
      ) {
        throw new DefinitionPackageError(`processes.${root._id}.slots.${key}`, 'Choose a compatible slot binding')
      }
    }
    const rebound = bindYamlModelProcess(
      native,
      target.masterTag,
      bindings,
      model,
      hierarchy,
      identities.get(root._id),
      identities
    )
    for (const doc of rebound) {
      if (doc._class === process.class.Process) {
        const member: DefinitionPackageOwner = doc
        member.definitionPackageInstallation = { id: installationId, member: root._id }
        if (verified.package.author !== undefined) {
          member.definitionPackage = {
            ...verified.package,
            author: verified.package.author,
            members: roots.map((item) => identities.get(item._id) as Ref<Doc>)
          }
        }
      }
      const previous = documents.get(doc._id)
      if (previous !== undefined && !authoringDataEqual(previous, doc)) {
        throw new DefinitionPackageError('documents', `Conflicting package dependency ${doc._id}`)
      }
      documents.set(doc._id, doc)
    }
  }
  for (const key of Object.keys(destinations)) {
    if (!roots.some((root) => root._id === key)) throw new DefinitionPackageError('processes', 'Unknown package member')
  }
  return {
    documents: [...documents.values()],
    installation: {
      name,
      package: verified.package,
      release: serializeDefinitionPackageRelease(verified),
      identities: Object.fromEntries(identities),
      destinations: structuredClone(destinations)
    }
  }
}
