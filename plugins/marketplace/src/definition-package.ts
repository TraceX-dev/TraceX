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

import core, { type AccountUuid } from '@hcengineering/core'
import { getEmbeddedLabel } from '@hcengineering/platform'
import { hash } from 'fast-sha256'
import { dump, JSON_SCHEMA, load, YAMLException } from 'js-yaml'
import { compileProcessYaml } from '@hcengineering/process'
import {
  assertAuthoringTree as assertTree,
  authoringObject as object,
  authoringText as text
} from '@hcengineering/process'
import type {
  DefinitionPackageDependency,
  DefinitionPackageManifest,
  DefinitionPackageRelease
} from './definition-package-types'
import type { DefinitionPackageDestination } from './types'

/** Invalid release metadata, integrity or upgrade identity. */
export class DefinitionPackageError extends Error {
  constructor (
    readonly path: string,
    message: string
  ) {
    super(`${path}: ${message}`)
    this.name = 'DefinitionPackageError'
  }
}

interface ReleaseVersion {
  core: string[]
  prerelease: string[]
}

/** Separates Marketplace dependency locks from the native card/process authoring definition. */
export function parseDefinitionPackageSource (source: string): {
  source: string
  dependencies: Record<string, DefinitionPackageDependency>
} {
  let parsed: unknown
  try {
    parsed = load(source, { schema: JSON_SCHEMA })
  } catch (error) {
    if (!(error instanceof YAMLException)) throw error
    throw new DefinitionPackageError('source', error.message)
  }
  const root = object(parsed, 'source')
  assertTree(root)
  const { dependencies: raw, version: syntaxVersion, kind, ...body } = root
  const dependencies: Record<string, DefinitionPackageDependency> = {}
  for (const [alias, value] of Object.entries(raw === undefined ? {} : object(raw, 'dependencies'))) {
    const path = `dependencies.${alias}`
    if (!/^[a-z][a-z0-9_-]*$/.test(alias) || ['constructor', 'prototype', '__proto__'].includes(alias)) {
      throw new DefinitionPackageError(path, 'Expected a safe dependency alias')
    }
    const dependency = object(value, path, ['id', 'author', 'version', 'contentHash', 'destinations'])
    const id = text(dependency.id, `${path}.id`)
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*\/[a-z][a-z0-9-]*$/.test(id)) {
      throw new DefinitionPackageError(`${path}.id`, 'Expected a publisher-qualified package identity')
    }
    const author = text(dependency.author, `${path}.author`) as AccountUuid
    const version = text(dependency.version, `${path}.version`)
    releaseVersion(version, `${path}.version`)
    const contentHash = text(dependency.contentHash, `${path}.contentHash`)
    if (!/^sha256:[a-f0-9]{64}$/.test(contentHash)) {
      throw new DefinitionPackageError(`${path}.contentHash`, 'Expected the inspected SHA-256 release digest')
    }
    const destinations: Record<string, DefinitionPackageDestination> = {}
    for (const [member, target] of Object.entries(object(dependency.destinations, `${path}.destinations`))) {
      const location = `${path}.destinations.${member}`
      const destination = object(target, location, ['masterTag', 'bindings'])
      const bindings: Record<string, string> = {}
      for (const [key, binding] of Object.entries(object(destination.bindings, `${location}.bindings`))) {
        bindings[key] = text(binding, `${location}.bindings.${key}`)
      }
      destinations[member] = {
        masterTag: text(destination.masterTag, `${location}.masterTag`) as DefinitionPackageDestination['masterTag'],
        bindings
      }
    }
    dependencies[alias] = { id, author, version, contentHash, destinations }
  }
  return { source: yaml({ version: syntaxVersion, kind, ...body }), dependencies }
}

/** Keeps dependency locks in authoring source without passing them to the process compiler. */
export function withDefinitionPackageDependencies (
  source: string,
  dependencies: Readonly<Record<string, DefinitionPackageDependency>>
): string {
  const definition: Record<string, unknown> = { ...object(load(source, { schema: JSON_SCHEMA }), 'source') }
  Reflect.deleteProperty(definition, 'dependencies')
  const result = yaml({ ...definition, ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}) })
  parseDefinitionPackageSource(result)
  return result
}

function releaseVersion (value: unknown, path: string): ReleaseVersion {
  const version = text(value, path)
  const numeric = '(0|[1-9][0-9]*)'
  const identifier = '(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
  const pattern = new RegExp(
    `^${numeric}\\.${numeric}\\.${numeric}(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
  )
  const match = pattern.exec(version)
  if (match === null || match[0] !== version) {
    throw new DefinitionPackageError(path, 'Expected a SemVer release, for example 1.2.3')
  }
  return { core: match.slice(1, 4), prerelease: match[4]?.split('.') ?? [] }
}

/** Compares full SemVer precedence without losing precision on large numeric identifiers. */
export function compareDefinitionPackageVersions (left: string, right: string): number {
  const a = releaseVersion(left, 'version')
  const b = releaseVersion(right, 'version')
  for (let index = 0; index < 3; index++) {
    const difference = BigInt(a.core[index]) - BigInt(b.core[index])
    if (difference !== 0n) return difference < 0n ? -1 : 1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const left = a.prerelease[index]
    const right = b.prerelease[index]
    if (left === undefined || right === undefined) return left === undefined ? -1 : 1
    if (left === right) continue
    const leftNumeric = /^[0-9]+$/.test(left)
    const rightNumeric = /^[0-9]+$/.test(right)
    if (leftNumeric && rightNumeric) return BigInt(left) < BigInt(right) ? -1 : 1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return left < right ? -1 : 1
  }
  return 0
}

/** Creates an offline release from the existing YAML DSL, verifying any supplied artifact digest. */
export async function createDefinitionPackageRelease (value: unknown): Promise<DefinitionPackageRelease> {
  const artifact = object(value, '$', ['package', 'source', 'contentHash'])
  const metadata = object(artifact.package, 'package', ['id', 'version', 'author', 'description'])
  const id = text(metadata.id, 'package.id')
  if (id.trim() !== id || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*\/[a-z][a-z0-9-]*$/.test(id)) {
    throw new DefinitionPackageError(
      'package.id',
      'Expected a publisher-qualified identity, for example acme/procurement'
    )
  }
  const version = text(metadata.version, 'package.version')
  releaseVersion(version, 'package.version')
  const author = metadata.author === undefined ? undefined : (text(metadata.author, 'package.author') as AccountUuid)
  const description = typeof metadata.description === 'string' ? metadata.description : undefined
  if (metadata.description !== undefined && description === undefined) {
    throw new DefinitionPackageError('package.description', 'Expected description text')
  }
  const manifest: DefinitionPackageManifest = {
    id,
    version,
    ...(author !== undefined ? { author } : {}),
    ...(description !== undefined ? { description } : {})
  }
  const authoredSource = text(artifact.source, 'source')
  const parsed = parseDefinitionPackageSource(authoredSource)
  const definition = compileProcessYaml(parsed.source)
  const source = withDefinitionPackageDependencies(parsed.source, parsed.dependencies)
  const contentHash = releaseHash(manifest, source)
  if (
    artifact.contentHash !== undefined &&
    artifact.contentHash !== contentHash &&
    artifact.contentHash !== releaseHash(manifest, authoredSource)
  ) {
    throw new DefinitionPackageError('contentHash', 'Release content does not match its SHA-256 digest')
  }
  return {
    package: manifest,
    source,
    contentHash,
    definition,
    ...(Object.keys(parsed.dependencies).length > 0 ? { dependencies: parsed.dependencies } : {})
  }
}

function releaseHash (manifest: DefinitionPackageManifest, source: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ package: manifest, source }))
  return 'sha256:' + Array.from(hash(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function yaml (value: unknown): string {
  return dump(value, { noRefs: true, noCompatMode: true, lineWidth: 120, schema: JSON_SCHEMA })
}

/** Rewrites only field labels in the original authoring blocks and recalculates the release digest. */
export async function updateDefinitionPackageFieldLabels (
  release: DefinitionPackageRelease,
  labels: ReadonlyMap<string, string>,
  manifest: DefinitionPackageManifest = release.package
): Promise<DefinitionPackageRelease> {
  if (release.definition.kind !== 'card') {
    throw new DefinitionPackageError('kind', 'Only card modules contain editable field labels')
  }
  const source = object(load(release.source, { schema: JSON_SCHEMA }), 'source')
  const fields = new Map<string, Record<string, unknown>>()
  const attributes = new Set(
    release.definition.docs.filter((doc) => doc._class === core.class.Attribute).map((doc) => doc._id)
  )
  for (const [id, field] of Object.entries(object(source.fields ?? {}, 'fields'))) {
    fields.set(id, object(field, `fields.${id}`))
  }
  for (const section of ['cardTypes', 'tags']) {
    for (const [ownerId, value] of Object.entries(object(source[section] ?? {}, section))) {
      const path = `${section}.${ownerId}`
      const owner = object(value, path)
      for (const [id, field] of Object.entries(object(owner.fields ?? {}, `${path}.fields`))) {
        fields.set(id, object(field, `${path}.fields.${id}`))
      }
    }
  }
  for (const [id, label] of labels) {
    const field = fields.get(id)
    if (field === undefined || !attributes.has(id)) {
      throw new DefinitionPackageError(`fields.${id}`, 'Unknown package field')
    }
    const value = label.trim()
    if (value.length === 0) throw new DefinitionPackageError(`fields.${id}.label`, 'Enter a field label')
    if (field.native !== undefined) {
      const native = object(field.native, `fields.${id}.native`)
      delete native.label
      if (Object.keys(native).length === 0) delete field.native
    }
    field.label = getEmbeddedLabel(value)
  }
  const updated = await createDefinitionPackageRelease({ package: manifest, source: yaml(source) })
  if (new TextEncoder().encode(serializeDefinitionPackageRelease(updated)).byteLength > 3 * 1024 * 1024) {
    throw new DefinitionPackageError('$', 'Release artifact exceeds 3 MiB')
  }
  return updated
}

/** Detects package manifests at existing file import entry points. Invalid YAML is reported to the caller. */
export function isDefinitionPackageSource (source: string): boolean {
  if (new TextEncoder().encode(source).byteLength > 3 * 1024 * 1024) {
    throw new DefinitionPackageError('$', 'Release artifact exceeds 3 MiB')
  }
  const value: unknown = load(source, { schema: JSON_SCHEMA })
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'package')
}

/** Writes metadata beside the actual YAML definition, without a quoted source wrapper. */
export function serializeDefinitionPackageRelease (release: DefinitionPackageRelease): string {
  const { version, kind, ...body } = object(load(release.source, { schema: JSON_SCHEMA }), 'source')
  const definition = { version, kind, ...body }
  return yaml({
    version,
    kind,
    package: release.package,
    contentHash: releaseHash(release.package, yaml(definition)),
    ...body
  })
}

/** Reads package YAML; previously exported JSON envelopes remain readable. */
export async function parseDefinitionPackageRelease (source: string): Promise<DefinitionPackageRelease> {
  if (new TextEncoder().encode(source).byteLength > 3 * 1024 * 1024) {
    throw new DefinitionPackageError('$', 'Release artifact exceeds 3 MiB')
  }
  let value: unknown
  try {
    value = load(source, { schema: JSON_SCHEMA })
  } catch (error) {
    if (!(error instanceof YAMLException)) throw error
    throw new DefinitionPackageError('$', error.message)
  }
  assertTree(value)
  const root = object(value, '$')
  if (root.source !== undefined) return await createDefinitionPackageRelease(root)
  if (root.package === undefined) {
    throw new DefinitionPackageError('package', 'Expected package metadata and a version: 2 YAML definition')
  }
  const { package: manifest, contentHash, ...definition } = root
  return await createDefinitionPackageRelease({ package: manifest, source: yaml(definition), contentHash })
}
