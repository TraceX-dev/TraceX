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

import core, {
  generateId,
  type AnyAttribute,
  type Class,
  type Doc,
  type Hierarchy,
  type ModelDb,
  type Ref
} from '@hcengineering/core'
import { authoringDataEqual, type Process } from '@hcengineering/process'
import {
  createDefinitionPackageRelease,
  DefinitionPackageError,
  parseDefinitionPackageSource
} from './definition-package'
import {
  prepareDefinitionPackageInstallation,
  type PreparedDefinitionPackageInstallation
} from './definition-package-installation'
import type { DefinitionPackageDependency, DefinitionPackageRelease } from './definition-package-types'
import type { DefinitionPackageDestination, DefinitionPackageInstallation } from './types'

export interface ResolvedDefinitionPackage {
  release: DefinitionPackageRelease
  dependencies: Record<string, ResolvedDefinitionPackage>
}

export interface PreparedDefinitionPackageRecord {
  id: Ref<DefinitionPackageInstallation>
  installation: PreparedDefinitionPackageInstallation['installation']
  current?: DefinitionPackageInstallation
}

export interface PreparedDefinitionPackageTree extends PreparedDefinitionPackageInstallation {
  installations: PreparedDefinitionPackageRecord[]
}

export type DefinitionPackageResolver = (dependency: DefinitionPackageDependency) => Promise<DefinitionPackageRelease>

/** Rejects incomplete or caller-tampered resolution trees before planning workspace writes. */
export function validateResolvedDefinitionPackage (resolved: ResolvedDefinitionPackage): void {
  let count = 0
  const versions = new Map<string, string>()
  const visit = (node: ResolvedDefinitionPackage, ancestors: readonly string[]): void => {
    const identity = JSON.stringify([node.release.package.author, node.release.package.id])
    if (++count > 100 || ancestors.length >= 16 || ancestors.includes(identity)) {
      throw new DefinitionPackageError('dependencies', 'Cyclic or oversized dependency tree')
    }
    const revision = JSON.stringify([node.release.package.version, node.release.contentHash])
    if (versions.has(identity) && versions.get(identity) !== revision) {
      throw new DefinitionPackageError('dependencies', 'Conflicting versions or hashes of the same package')
    }
    versions.set(identity, revision)
    const locks = parseDefinitionPackageSource(node.release.source).dependencies
    if (!authoringDataEqual(locks, node.release.dependencies ?? {})) {
      throw new DefinitionPackageError('dependencies', 'The derived dependency metadata differs from its source')
    }
    if (Object.keys(locks).length !== Object.keys(node.dependencies).length) {
      throw new DefinitionPackageError('dependencies', 'The resolved tree does not match the package dependency locks')
    }
    for (const [alias, lock] of Object.entries(locks)) {
      const child = node.dependencies[alias]
      if (
        child === undefined ||
        child.release.package.id !== lock.id ||
        child.release.package.author !== lock.author ||
        child.release.package.version !== lock.version ||
        child.release.contentHash !== lock.contentHash
      ) {
        throw new DefinitionPackageError(
          `dependencies.${alias}`,
          'The resolved dependency differs from its locked release'
        )
      }
      visit(child, [...ancestors, identity])
    }
  }
  visit(resolved, [])
}

/** Resolves exact releases using the caller's authenticated catalog transport, with bounded graph checks. */
export async function resolveDefinitionPackageDependencies (
  release: DefinitionPackageRelease,
  resolve: DefinitionPackageResolver
): Promise<ResolvedDefinitionPackage> {
  const versions = new Map<string, string>()
  const cache = new Map<string, DefinitionPackageRelease>()
  let count = 0
  async function visit (
    candidate: DefinitionPackageRelease,
    ancestors: readonly string[]
  ): Promise<ResolvedDefinitionPackage> {
    const verified = await createDefinitionPackageRelease({
      package: candidate.package,
      source: candidate.source,
      contentHash: candidate.contentHash
    })
    const identity = JSON.stringify([verified.package.author, verified.package.id])
    if (ancestors.includes(identity)) throw new DefinitionPackageError('dependencies', 'Cyclic package dependency')
    if (++count > 100 || ancestors.length >= 16) {
      throw new DefinitionPackageError('dependencies', 'Package dependency graph exceeds 100 instances or 16 levels')
    }
    const revision = JSON.stringify([verified.package.version, verified.contentHash])
    if (versions.has(identity) && versions.get(identity) !== revision) {
      throw new DefinitionPackageError('dependencies', 'Conflicting versions or hashes of the same package')
    }
    versions.set(identity, revision)
    const dependencies: Record<string, ResolvedDefinitionPackage> = {}
    for (const [alias, lock] of Object.entries(verified.dependencies ?? {})) {
      const childIdentity = JSON.stringify([lock.author, lock.id])
      if ([...ancestors, identity].includes(childIdentity)) {
        throw new DefinitionPackageError(`dependencies.${alias}`, 'Cyclic package dependency')
      }
      const childRevision = JSON.stringify([lock.version, lock.contentHash])
      if (versions.has(childIdentity) && versions.get(childIdentity) !== childRevision) {
        throw new DefinitionPackageError(`dependencies.${alias}`, 'Conflicting versions or hashes of the same package')
      }
      const key = JSON.stringify([lock.author, lock.id, lock.version, lock.contentHash])
      let child = cache.get(key)
      if (child === undefined) {
        child = await resolve(lock)
        cache.set(key, child)
      }
      if (
        child.package.id !== lock.id ||
        child.package.author !== lock.author ||
        child.package.version !== lock.version ||
        child.contentHash !== lock.contentHash
      ) {
        throw new DefinitionPackageError(
          `dependencies.${alias}`,
          'The dependency does not match its locked author, ID, version and hash'
        )
      }
      dependencies[alias] = await visit(child, [...ancestors, identity])
    }
    return { release: verified, dependencies }
  }
  return await visit(release, [])
}

/** Presents pending definitions to binding checks without mutating the workspace model or hierarchy. */
export function withDefinitionPackageModel (
  model: ModelDb,
  hierarchy: Hierarchy,
  documents: readonly Doc[]
): { model: ModelDb, hierarchy: Hierarchy } {
  const pending = new Map(documents.map((doc) => [String(doc._id), doc]))
  const attribute = (owner: string, name: string, visited = new Set<string>()): AnyAttribute | undefined => {
    if (visited.has(owner)) return undefined
    visited.add(owner)
    const found = documents.find(
      (doc) =>
        doc._class === core.class.Attribute &&
        Reflect.get(doc, 'attributeOf') === owner &&
        Reflect.get(doc, 'name') === name
    )
    if (found !== undefined) return found as AnyAttribute
    const definition = pending.get(owner)
    if (definition === undefined) return hierarchy.findAttribute(owner as Ref<Class<Doc>>, name)
    const parent: unknown = Reflect.get(definition, 'extends')
    return typeof parent === 'string' ? attribute(parent, name, visited) : undefined
  }
  const derived = (actual: string, expected: string, visited = new Set<string>()): boolean => {
    if (actual === expected) return true
    if (visited.has(actual)) return false
    visited.add(actual)
    const definition = pending.get(actual)
    if (definition === undefined) return hierarchy.isDerived(actual as Ref<Class<Doc>>, expected as Ref<Class<Doc>>)
    const parent: unknown = Reflect.get(definition, 'extends')
    return typeof parent === 'string' && derived(parent, expected, visited)
  }
  return {
    model: new Proxy(model, {
      get: (target, property) => {
        if (property === 'findObject') return (id: string) => pending.get(id) ?? target.findObject(id as Ref<Doc>)
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
    }),
    hierarchy: new Proxy(hierarchy, {
      get: (target, property) => {
        if (property === 'findAttribute') return attribute
        if (property === 'isDerived') return derived
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
  }
}

/** Resolves parent identities and field storage names after the parent's identity cloning. */
export function resolveDefinitionPackageDestinations (
  dependency: DefinitionPackageDependency,
  identities: Readonly<Record<string, string>>,
  parent: DefinitionPackageRelease,
  child: DefinitionPackageRelease,
  documents: readonly Doc[]
): Record<string, DefinitionPackageDestination> {
  const resolve = (value: string): string => {
    if (!value.startsWith('$parent.')) return value
    const id = identities[value.slice('$parent.'.length)]
    if (id === undefined)
      {throw new DefinitionPackageError('dependencies.destinations', `Unknown parent member ${value}`)}
    return id
  }
  const result: Record<string, DefinitionPackageDestination> = {}
  for (const [member, destination] of Object.entries(dependency.destinations)) {
    const masterTag = resolve(destination.masterTag) as DefinitionPackageDestination['masterTag']
    const bindings = Object.fromEntries(
      Object.entries(destination.bindings).map(([key, value]) => [key, resolve(value)])
    )
    const definition = child.definition.docs.find((doc) => doc._id === member && doc._class === 'process:class:Process')
    const slots = definition === undefined ? {} : ((definition as unknown as Process).requiredSlots ?? {})
    for (const [key, slot] of Object.entries(slots)) {
      const value = destination.bindings[key]
      if (slot.slotKind !== 'attribute' || value === undefined) continue
      const ownerSlot = slot.memberOf === undefined ? undefined : /^__SLOT_(.+)__$/.exec(slot.memberOf)?.[1]
      const owner =
        slot.memberOf === undefined ? masterTag : ownerSlot === undefined ? resolve(slot.memberOf) : bindings[ownerSlot]
      let original = Object.entries(identities).find(([, local]) => local === owner)?.[0]
      const visited = new Set<string>()
      while (original !== undefined && !visited.has(original)) {
        visited.add(original)
        const attribute = parent.definition.docs.find(
          (doc) => doc._class === core.class.Attribute && doc.attributeOf === original && doc.name === value
        )
        if (attribute !== undefined) {
          const local = documents.find((doc) => doc._id === identities[attribute._id])
          if (local !== undefined && typeof Reflect.get(local, 'name') === 'string')
            {bindings[key] = String(Reflect.get(local, 'name'))}
          break
        }
        const parentType = parent.definition.docs.find((doc) => doc._id === original)
        original = typeof parentType?.extends === 'string' ? parentType.extends : undefined
      }
    }
    result[member] = { masterTag, bindings }
  }
  return result
}

/** Prepares the complete tree before any writes; each package retains a separate installation baseline. */
export async function prepareDefinitionPackageTreeInstallation (
  resolved: ResolvedDefinitionPackage,
  destinations: Record<string, DefinitionPackageDestination>,
  id: Ref<DefinitionPackageInstallation>,
  model: ModelDb,
  hierarchy: Hierarchy
): Promise<PreparedDefinitionPackageTree> {
  validateResolvedDefinitionPackage(resolved)
  const prepared = await prepareDefinitionPackageInstallation(
    resolved.release,
    destinations,
    id,
    model,
    hierarchy,
    {},
    true
  )
  const documents = [...prepared.documents]
  const installations: PreparedDefinitionPackageRecord[] = [{ id, installation: prepared.installation }]
  const dependencies: Record<string, Ref<DefinitionPackageInstallation>> = {}
  for (const [alias, child] of Object.entries(resolved.dependencies)) {
    const lock = resolved.release.dependencies?.[alias]
    if (lock === undefined) throw new DefinitionPackageError(`dependencies.${alias}`, 'Missing dependency lock')
    const childId = generateId<DefinitionPackageInstallation>()
    const overlay = withDefinitionPackageModel(model, hierarchy, documents)
    const nested = await prepareDefinitionPackageTreeInstallation(
      child,
      resolveDefinitionPackageDestinations(
        lock,
        prepared.installation.identities,
        resolved.release,
        child.release,
        documents
      ),
      childId,
      overlay.model,
      overlay.hierarchy
    )
    documents.push(...nested.documents)
    installations.push(...nested.installations)
    dependencies[alias] = childId
  }
  if (Object.keys(dependencies).length > 0) prepared.installation.dependencies = dependencies
  return { ...prepared, documents, installations }
}
