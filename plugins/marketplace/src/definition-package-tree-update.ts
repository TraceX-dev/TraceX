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

import { generateId, type Doc, type Hierarchy, type ModelDb, type Ref } from '@hcengineering/core'
import { authoringDataEqual, type AuthoringNativeDocument, type ProcessAuthoringResult } from '@hcengineering/process'
import { DefinitionPackageError, parseDefinitionPackageRelease } from './definition-package'
import {
  prepareDefinitionPackageTreeInstallation,
  resolveDefinitionPackageDestinations,
  withDefinitionPackageModel,
  validateResolvedDefinitionPackage,
  type PreparedDefinitionPackageRecord,
  type ResolvedDefinitionPackage
} from './definition-package-dependencies'
import {
  compareDefinitionPackageDefinitions,
  definitionPackageComponents,
  type DefinitionPackageComponent
} from './definition-package-model'
import { prepareDefinitionPackageUpdate, type PreparedDefinitionPackageUpdate } from './definition-package-update'
import type { DefinitionPackageDependency } from './definition-package-types'
import type { DefinitionPackageDestination, DefinitionPackageInstallation } from './types'

export interface PreparedDefinitionPackageTreeUpdate extends PreparedDefinitionPackageUpdate {
  installations: PreparedDefinitionPackageRecord[]
}

/** Plans parent and dependency updates together, preserving independent identities and conflict choices. */
export async function prepareDefinitionPackageTreeUpdate (
  installed: DefinitionPackageInstallation,
  incoming: ResolvedDefinitionPackage,
  destinations: Record<string, DefinitionPackageDestination>,
  resolutions: Readonly<Record<string, 'local' | 'upstream'>>,
  installations: ReadonlyMap<string, DefinitionPackageInstallation>,
  model: ModelDb,
  hierarchy: Hierarchy,
  supplementary: readonly Doc[] = [],
  nested = false
): Promise<PreparedDefinitionPackageTreeUpdate> {
  validateResolvedDefinitionPackage(incoming)
  const plan = await prepareDefinitionPackageUpdate(
    installed,
    incoming.release,
    destinations,
    resolutions,
    model,
    hierarchy,
    supplementary,
    nested,
    true
  )
  const records: PreparedDefinitionPackageRecord[] = [
    { id: installed._id, installation: plan.installation, current: installed }
  ]
  const baseline = await parseDefinitionPackageRelease(installed.release)
  const links: Record<string, Ref<DefinitionPackageInstallation>> = {}
  for (const [alias, child] of Object.entries(incoming.dependencies)) {
    const lock = incoming.release.dependencies?.[alias]
    if (lock === undefined) throw new DefinitionPackageError(`dependencies.${alias}`, 'Missing dependency lock')
    const previous = baseline.dependencies?.[alias]
    if (previous !== undefined && (previous.id !== lock.id || previous.author !== lock.author)) {
      throw new DefinitionPackageError(
        `dependencies.${alias}`,
        'Replacing a dependency identity requires a new alias; removing the old alias retains its installed definitions'
      )
    }
    const id = installed.dependencies?.[alias]
    const current = id === undefined ? undefined : installations.get(id)
    if (previous !== undefined && current === undefined) {
      throw new DefinitionPackageError(
        `dependencies.${alias}`,
        'The dependency installation is unavailable; restore or explicitly remove this dependency'
      )
    }
    const overlay = withDefinitionPackageModel(model, hierarchy, plan.documents)
    const target = resolveDefinitionPackageDestinations(
      lock,
      plan.installation.identities,
      incoming.release,
      child.release,
      plan.documents
    )
    if (current === undefined) {
      const newId = generateId<DefinitionPackageInstallation>()
      const added = await prepareDefinitionPackageTreeInstallation(
        child,
        target,
        newId,
        overlay.model,
        overlay.hierarchy
      )
      plan.documents.push(...added.documents)
      records.push(...added.installations)
      links[alias] = newId
      const definition: ProcessAuthoringResult = {
        version: 2,
        kind: child.release.definition.kind,
        docs: added.documents as unknown as AuthoringNativeDocument[]
      }
      const empty: ProcessAuthoringResult = { ...definition, docs: [] }
      const components = definitionPackageComponents(definition)
      for (const change of compareDefinitionPackageDefinitions(empty, empty, definition)) {
        plan.changes.push(change)
        plan.reviewComponents[change.key] = { incoming: components.get(change.key), target: components.get(change.key) }
      }
    } else {
      if (current.package.id !== lock.id || current.package.author !== lock.author) {
        throw new DefinitionPackageError(`dependencies.${alias}`, 'The dependency installation identity changed')
      }
      const childPlan = await prepareDefinitionPackageTreeUpdate(
        current,
        child,
        target,
        resolutions,
        installations,
        overlay.model,
        overlay.hierarchy,
        supplementary,
        true
      )
      plan.documents.push(...childPlan.documents)
      plan.current.push(...childPlan.current)
      plan.removed.push(...childPlan.removed)
      plan.changes.push(...childPlan.changes)
      plan.blockedChanges.push(...childPlan.blockedChanges)
      Object.assign(plan.reviewComponents, childPlan.reviewComponents)
      Object.assign(plan.reviews, childPlan.reviews)
      plan.blocked ||= childPlan.blocked
      plan.missingDependencies ||= childPlan.missingDependencies
      records.push(...childPlan.installations)
      links[alias] = current._id
    }
  }
  const component = (
    key: string,
    alias: string,
    lock: DefinitionPackageDependency | undefined
  ): DefinitionPackageComponent | undefined => {
    if (lock === undefined) return undefined
    return {
      key,
      class: installed._class,
      documents: { [key]: { document: { _id: key, _class: installed._class, name: alias, dependency: lock } } }
    }
  }
  for (const alias of new Set([...Object.keys(baseline.dependencies ?? {}), ...Object.keys(incoming.dependencies)])) {
    const before = baseline.dependencies?.[alias]
    const after = incoming.release.dependencies?.[alias]
    if (authoringDataEqual(before, after)) continue
    const key = `dependency:${installed._id}:${alias}`
    plan.changes.push({
      key,
      class: installed._class,
      operation: before === undefined ? 'added' : after === undefined ? 'removed' : 'modified',
      resolution: 'upstream',
      impact: 'behavioral',
      paths: ['$.dependency'],
      reason:
        after === undefined
          ? 'The dependency link is removed; its installed definitions and active executions are retained'
          : 'The locked dependency and its destination bindings will be applied'
    })
    const local = component(key, alias, before)
    const target = component(key, alias, after)
    plan.reviewComponents[key] = { baseline: local, local, incoming: target, target }
  }
  if (Object.keys(links).length > 0 || installed.dependencies !== undefined) plan.installation.dependencies = links
  const snapshot = [
    ...plan.current,
    ...records.flatMap((record) => (record.current === undefined ? [] : [record.current]))
  ].sort((left, right) => String(left._id).localeCompare(String(right._id)))
  const composite =
    Object.keys(baseline.dependencies ?? {}).length > 0 ||
    Object.keys(incoming.dependencies).length > 0 ||
    installed.dependencies !== undefined
  return { ...plan, installations: records, fingerprint: composite ? JSON.stringify(snapshot) : plan.fingerprint }
}
