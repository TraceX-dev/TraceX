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
import { dump, JSON_SCHEMA } from 'js-yaml'
import core, { type Class, type Doc, type Hierarchy, type ModelDb, type Ref } from '@hcengineering/core'
import process, {
  authoringDataEqual,
  exportAuthoringModel,
  validateAuthoringModelOperations,
  type AuthoringNativeDocument,
  type Process,
  type ProcessAuthoringResult
} from '@hcengineering/process'
import {
  compareDefinitionPackageVersions,
  createDefinitionPackageRelease,
  DefinitionPackageError,
  parseDefinitionPackageRelease
} from './definition-package'
import {
  prepareDefinitionPackageInstallation,
  type PreparedDefinitionPackageInstallation
} from './definition-package-installation'
import {
  compareDefinitionPackageDefinitions,
  definitionPackageComponents,
  definitionPackageDifferencePaths,
  definitionPackageImpact
} from './definition-package-model'
import { planDefinitionPackageUpgrade } from './definition-package-plan'
import type { DefinitionPackageChange, DefinitionPackageRelease } from './definition-package-types'
import {
  stripDefinitionPackageInfo,
  type DefinitionPackageDestination,
  type DefinitionPackageInstallation,
  type DefinitionPackageOwner
} from './types'

export interface PreparedDefinitionPackageUpdate extends PreparedDefinitionPackageInstallation {
  changes: DefinitionPackageChange[]
  current: Doc[]
  removed: Doc[]
  fingerprint: string
  blocked: boolean
  reviews: Record<string, { baseline: string, local: string, incoming: string }>
  missingDependencies: boolean
}

/** Compares definitions and separately loaded workspace counters with the baseline and verified incoming release. */
export async function prepareDefinitionPackageUpdate (
  installed: DefinitionPackageInstallation,
  incoming: DefinitionPackageRelease,
  destinations: Record<string, DefinitionPackageDestination>,
  resolutions: Readonly<Record<string, 'local' | 'upstream'>>,
  model: ModelDb,
  hierarchy: Hierarchy,
  supplementaryDocuments: readonly Doc[] = []
): Promise<PreparedDefinitionPackageUpdate> {
  const baseline = await parseDefinitionPackageRelease(installed.release)
  const verifiedIncoming = await createDefinitionPackageRelease({
    package: incoming.package,
    source: incoming.source,
    contentHash: incoming.contentHash
  })
  if (!authoringDataEqual(baseline.package, installed.package)) {
    throw new DefinitionPackageError('package', 'The saved installation baseline does not match its metadata')
  }
  await planDefinitionPackageUpgrade(baseline, verifiedIncoming)
  if (compareDefinitionPackageVersions(verifiedIncoming.package.version, baseline.package.version) === 0) {
    throw new DefinitionPackageError('package.version', 'This package release is already installed')
  }
  const base = await prepareDefinitionPackageInstallation(
    baseline,
    installed.destinations,
    installed._id,
    model,
    hierarchy,
    installed.identities
  )
  const next = await prepareDefinitionPackageInstallation(
    verifiedIncoming,
    destinations,
    installed._id,
    model,
    hierarchy,
    installed.identities
  )
  const current = new Map<string, Doc>()
  const supplementary = new Map(supplementaryDocuments.map((doc) => [doc._id, doc]))
  for (const doc of base.documents) {
    const actual = model.findObject(doc._id) ?? supplementary.get(doc._id)
    if (actual !== undefined) current.set(actual._id, actual)
    if (doc._class === process.class.Process) {
      for (const clazz of [process.class.State, process.class.Transition]) {
        for (const member of model.findAllSync(clazz, { process: doc._id as Ref<Process> }))
          {current.set(member._id, member)}
      }
    }
    if (doc._class === card.class.MasterTag || doc._class === card.class.Tag) {
      for (const attribute of model.findAllSync(core.class.Attribute, { attributeOf: doc._id as Ref<Class<Doc>> })) {
        current.set(attribute._id, attribute)
      }
    }
    if ((doc as DefinitionPackageOwner).definitionPackageInstallation !== undefined && actual !== undefined) {
      const owner: DefinitionPackageOwner = actual
      if (
        owner.definitionPackageInstallation?.id !== installed._id ||
        (owner.definitionPackage !== undefined && owner.definitionPackage.id !== installed.package.id)
      ) {
        throw new DefinitionPackageError('package', 'Definition membership changed; refresh the installed package')
      }
    }
  }
  // Graph documents replaced by a local YAML save are discovered through their owner, not only the old mapping.
  const asDefinition = (docs: readonly Doc[]): ProcessAuthoringResult => ({
    kind: baseline.definition.kind,
    version: 2,
    docs: docs.map(stripDefinitionPackageInfo) as unknown as AuthoringNativeDocument[]
  })
  const baseDefinition = asDefinition(base.documents)
  const liveProcesses = new Set(
    [...current.values()].filter((doc) => doc._class === process.class.Process).map((doc) => String(doc._id))
  )
  const localDefinition = asDefinition(
    [...current.values()].filter(
      (doc) =>
        (doc._class !== process.class.State && doc._class !== process.class.Transition) ||
        liveProcesses.has(String((doc as unknown as { process: string }).process))
    )
  )
  const nextDefinition = asDefinition(next.documents)
  const changes = compareDefinitionPackageDefinitions(baseDefinition, localDefinition, nextDefinition)
  const baselineComponents = definitionPackageComponents(baseDefinition)
  const localComponents = definitionPackageComponents(localDefinition)
  const incomingComponents = definitionPackageComponents(nextDefinition)
  const findings = new Map(changes.map((change) => [change.key, change]))
  const reviewSource = (components: ReturnType<typeof definitionPackageComponents>, key: string): string =>
    dump(
      Object.fromEntries(
        Object.entries(components.get(key)?.documents ?? {}).map(([id, value]) => [
          id,
          {
            ...value.document,
            ...(value.order !== undefined ? { $order: value.order } : {})
          }
        ])
      ),
      { noRefs: true, noCompatMode: true, lineWidth: 120, schema: JSON_SCHEMA }
    )
  const reviews = Object.fromEntries(
    changes.map((change) => [
      change.key,
      {
        baseline: reviewSource(baselineComponents, change.key),
        local: reviewSource(localComponents, change.key),
        incoming: reviewSource(incomingComponents, change.key)
      }
    ])
  )
  const target = new Map<string, Doc>()
  const nextById = new Map(next.documents.map((doc) => [String(doc._id), doc]))
  let blocked = false
  for (const key of new Set([...localComponents.keys(), ...incomingComponents.keys(), ...findings.keys()])) {
    const change = findings.get(key)
    const conflict = change?.resolution === 'conflict'
    if (conflict && resolutions[key] === undefined) blocked = true
    const upstream =
      change?.resolution === 'upstream' ||
      ((conflict || change?.resolution === 'local') && resolutions[key] === 'upstream')
    if (change !== undefined && change.resolution !== 'local' && ['destructive', 'unknown'].includes(change.impact)) {
      blocked = true
    }
    if (upstream && change !== undefined) {
      const impact = definitionPackageImpact(localComponents.get(key), incomingComponents.get(key))
      if (impact.impact === 'destructive' || impact.impact === 'unknown') {
        blocked = true
        changes[changes.indexOf(change)] = {
          ...change,
          ...impact,
          paths: [
            ...new Set([
              ...change.paths,
              ...definitionPackageDifferencePaths(localComponents.get(key), incomingComponents.get(key))
            ])
          ].sort()
        }
      }
    }
    const component = upstream ? incomingComponents.get(key) : localComponents.get(key)
    const source = upstream ? nextById : current
    for (const id of Object.keys(component?.documents ?? {})) {
      const doc = source.get(id)
      if (doc !== undefined) target.set(id, structuredClone(doc))
    }
  }
  for (const doc of target.values()) {
    const actual: (Doc & { rank?: string }) | undefined = current.get(doc._id)
    if (doc._class === process.class.Process && actual?.rank !== undefined) {
      Reflect.set(doc, 'rank', actual.rank)
    }
    const nextDoc: DefinitionPackageOwner | undefined = nextById.get(doc._id)
    if (nextDoc?.definitionPackageInstallation !== undefined) {
      const member: DefinitionPackageOwner = doc
      member.definitionPackageInstallation = nextDoc.definitionPackageInstallation
      if (nextDoc.definitionPackage !== undefined) member.definitionPackage = nextDoc.definitionPackage
    }
  }
  let missingDependencies = false
  const incomingRoots = verifiedIncoming.definition.docs.filter((doc) => doc._class === process.class.Process)
  for (const source of incomingRoots) {
    const rootId = next.installation.identities[source._id]
    const change = findings.get(rootId)
    if (
      !target.has(rootId) ||
      ((change?.resolution === 'local' || change?.resolution === 'conflict') && resolutions[rootId] !== 'upstream')
    )
      {continue}
    const proc = source as unknown as Process
    for (const [key, slot] of Object.entries(proc.requiredSlots ?? {})) {
      const dependency = proc.bindings?.[key]
      if (
        slot.slotKind === 'process' &&
        dependency !== undefined &&
        incomingRoots.some((root) => root._id === dependency) &&
        !target.has(next.installation.identities[dependency])
      ) {
        missingDependencies = true
        blocked = true
      }
    }
  }
  if (!blocked) {
    const checked = asDefinition([...target.values()])
    exportAuthoringModel(checked.docs, checked.kind)
    validateAuthoringModelOperations(checked.docs, model, hierarchy)
    const fields = new Map<string, string>()
    for (const doc of checked.docs) {
      if (doc._class !== core.class.Attribute) continue
      const key = JSON.stringify([doc.attributeOf, doc.name])
      const previous = fields.get(key)
      if (previous !== undefined && previous !== doc._id) {
        throw new DefinitionPackageError('fields', `A local field already uses the stored name ${String(doc.name)}`)
      }
      fields.set(key, doc._id)
    }
  }
  const snapshot = [...current.values()].sort((a, b) => String(a._id).localeCompare(String(b._id)))
  return {
    ...next,
    documents: [...target.values()],
    changes,
    current: snapshot,
    removed: snapshot.filter((doc) => !target.has(doc._id)),
    fingerprint: JSON.stringify(snapshot),
    blocked,
    reviews,
    missingDependencies
  }
}
