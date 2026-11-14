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
import core from '@hcengineering/core'
import type { AuthoringNativeDocument, ProcessAuthoringResult } from '@hcengineering/process'
import process, { authoringDataEqual } from '@hcengineering/process'
import type { DefinitionPackageChange } from './definition-package-types'

const RANKED = new Set<string>([
  process.class.Process,
  process.class.State,
  process.class.Transition,
  core.class.Attribute,
  card.class.MasterTag,
  card.class.Tag
])
const RUNTIME_METADATA = new Set(['createdOn', 'createdBy', 'modifiedOn', 'modifiedBy'])
const COSMETIC = new Set(['label', 'description', 'icon', 'color', '$order'])
const MODEL_PROPERTIES = new Set(['_id', '_class', 'space', 'label', 'description', 'icon', 'color'])
const KNOWN_PROPERTIES: Record<string, Set<string>> = {
  [core.class.Attribute]: new Set([
    ...MODEL_PROPERTIES,
    'attributeOf',
    'name',
    'type',
    'isCustom',
    'required',
    'readonly',
    'automationOnly',
    'defaultValue'
  ]),
  [card.class.MasterTag]: new Set([...MODEL_PROPERTIES, 'extends', 'kind', 'baseType']),
  [card.class.Tag]: new Set([...MODEL_PROPERTIES, 'extends', 'kind']),
  [core.class.Enum]: new Set([...MODEL_PROPERTIES, 'name', 'enumValues']),
  [core.class.Association]: new Set([...MODEL_PROPERTIES, 'classA', 'classB', 'nameA', 'nameB', 'type'])
}

export interface DefinitionPackageDocument {
  document: Record<string, unknown>
  order?: number
}

export interface DefinitionPackageComponent {
  key: string
  class: string
  documents: Record<string, DefinitionPackageDocument>
}

/** Omits audit data, regenerable ranks and issued identifier numbers; retains definition order and literals. */
export function definitionPackageComponents (
  definition: ProcessAuthoringResult
): Map<string, DefinitionPackageComponent> {
  const ranked = new Map<string, AuthoringNativeDocument[]>()
  for (const doc of definition.docs) {
    if (!RANKED.has(doc._class) || typeof doc.rank !== 'string') continue
    const scope = doc.process ?? doc.attributeOf ?? doc.extends ?? doc.masterTag ?? ''
    const group = JSON.stringify([doc._class, scope, doc.from ?? ''])
    const entries = ranked.get(group) ?? []
    entries.push(doc)
    ranked.set(group, entries)
  }
  const orders = new Map<string, number>()
  for (const entries of ranked.values()) {
    entries.sort((a, b) => (String(a.rank) < String(b.rank) ? -1 : String(a.rank) > String(b.rank) ? 1 : 0))
    entries.forEach((doc, index) => orders.set(doc._id, index))
  }
  const components = new Map<string, DefinitionPackageComponent>()
  for (const doc of definition.docs) {
    const graphMember = doc._class === process.class.State || doc._class === process.class.Transition
    const key = graphMember ? String(doc.process) : doc._id
    const component = components.get(key) ?? {
      key,
      class: graphMember ? process.class.Process : doc._class,
      documents: Object.create(null) as Record<string, DefinitionPackageDocument>
    }
    const document = Object.fromEntries(
      Object.entries(doc).filter(
        ([key]) =>
          !RUNTIME_METADATA.has(key) &&
          !(key === 'rank' && orders.has(doc._id)) &&
          !(key === 'sequence' && (doc._class === core.class.Sequence || doc._class === core.class.CustomSequence))
      )
    )
    component.documents[doc._id] = { document, ...(orders.has(doc._id) ? { order: orders.get(doc._id) } : {}) }
    components.set(key, component)
  }
  return components
}

/** Keeps array order significant and reports changed leaf paths without interpreting opaque native values. */
export function definitionPackageDifferencePaths (left: unknown, right: unknown, path = '$'): string[] {
  if (authoringDataEqual(left, right)) return []
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Array.isArray(left) ||
    Array.isArray(right)
  ) {
    return [path]
  }
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .sort()
    .flatMap((key) => definitionPackageDifferencePaths(a[key], b[key], `${path}.${key}`))
}

function supportedType (value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const type = value as Record<string, unknown>
  if (Object.keys(type).some((key) => !['_class', 'label', 'of', 'to'].includes(key))) return false
  if (type._class === core.class.ArrOf) return supportedType(type.of)
  if (type._class === core.class.RefTo) return typeof type.to === 'string'
  if (type._class === core.class.EnumOf) return typeof type.of === 'string'
  return [
    core.class.TypeString,
    core.class.TypeNumber,
    core.class.TypeBoolean,
    core.class.TypeDate,
    core.class.TypeMarkup
  ].some((id) => id === type._class)
}

/** Uses a deliberately small allowlist; round-trip support is not a compatibility contract. */
export function definitionPackageImpact (
  before: DefinitionPackageComponent | undefined,
  after: DefinitionPackageComponent | undefined
): Pick<DefinitionPackageChange, 'impact' | 'reason'> {
  const finding = (
    impact: DefinitionPackageChange['impact'],
    reason: string
  ): Pick<DefinitionPackageChange, 'impact' | 'reason'> => ({ impact, reason })
  if (after === undefined) return finding('destructive', 'Removing a component requires data and dependency analysis')
  if (before?.class !== undefined && before.class !== after.class) {
    return finding('destructive', 'The component class changed')
  }
  if (after.class === process.class.Process) {
    return finding(
      'behavioral',
      'Process graphs are one merge unit; changes require manual review and can affect current executions'
    )
  }
  const doc = after.documents[after.key].document
  const previous = before?.documents[before.key].document
  const known = KNOWN_PROPERTIES[after.class]
  if (
    known === undefined ||
    doc.space !== core.space.Model ||
    Object.keys(doc).some((key) => !known.has(key)) ||
    (previous !== undefined && Object.keys(previous).some((key) => !known.has(key)))
  ) {
    return finding('unknown', 'This component contains native properties without a verified compatibility contract')
  }
  if (previous === undefined) {
    if (after.class === core.class.Attribute) {
      if (doc.required === true) {
        return finding('destructive', 'A new required field needs existing-data and write-path checks')
      }
      if (!supportedType(doc.type)) {
        return finding('unknown', 'The new field type has no verified compatibility contract')
      }
      if (doc.defaultValue !== undefined || doc.readonly === true || doc.automationOnly === true) {
        return finding('behavioral', 'New field defaults or write restrictions need review')
      }
      return finding('additive', 'Optional field; destination ownership, references and consumers still need checking')
    }
    if ([card.class.MasterTag, card.class.Tag, core.class.Enum].some((id) => id === after.class)) {
      return finding('additive', 'New definition; inheritance and consumers still need destination checks')
    }
    return finding('behavioral', 'The new component can change relationship or application behavior')
  }
  const changed = new Set(
    [...Object.keys(previous), ...Object.keys(doc)].filter((key) => !authoringDataEqual(previous[key], doc[key]))
  )
  if (before?.documents[before.key].order !== after.documents[after.key].order) changed.add('$order')
  if (after.class === core.class.Attribute) {
    if (
      ['name', 'attributeOf', 'type'].some((key) => changed.has(key)) ||
      (changed.has('required') && doc.required === true)
    ) {
      return finding('destructive', 'Field identity, type, ownership or requiredness changed')
    }
    if (!supportedType(doc.type)) return finding('unknown', 'The field type has no verified compatibility contract')
  }
  if (
    (after.class === card.class.MasterTag || after.class === card.class.Tag) &&
    ['extends', 'kind', 'baseType'].some((key) => changed.has(key))
  ) {
    return finding('destructive', 'Card inheritance or type identity changed')
  }
  if (after.class === core.class.Association && ['classA', 'classB', 'type'].some((key) => changed.has(key))) {
    return finding('destructive', 'Association endpoints or cardinality changed')
  }
  if (after.class === core.class.Enum && changed.has('enumValues')) {
    const oldValues = previous.enumValues
    const newValues = doc.enumValues
    if (!Array.isArray(oldValues) || !Array.isArray(newValues)) {
      return finding('unknown', 'Enum values have an unsupported representation')
    }
    if (oldValues.some((value) => !newValues.includes(value))) {
      return finding('destructive', 'An existing enum value was removed or renamed')
    }
    return finding('behavioral', 'Enum additions or ordering can affect existing consumers')
  }
  if ([...changed].every((key) => COSMETIC.has(key))) {
    return finding('cosmetic', 'Only known display metadata or field/type order changed')
  }
  return finding('behavioral', 'Definition behavior or constraints changed')
}

/** Compares definitions using one unit per process graph and one unit per model component. */
export function compareDefinitionPackageDefinitions (
  baselineDefinition: ProcessAuthoringResult,
  localDefinition: ProcessAuthoringResult,
  incomingDefinition: ProcessAuthoringResult
): DefinitionPackageChange[] {
  const baseline = definitionPackageComponents(baselineDefinition)
  const current = definitionPackageComponents(localDefinition)
  const target = definitionPackageComponents(incomingDefinition)
  const changes: DefinitionPackageChange[] = []
  for (const key of [...new Set([...baseline.keys(), ...current.keys(), ...target.keys()])].sort()) {
    const before = baseline.get(key)
    const actual = current.get(key)
    const after = target.get(key)
    const upstreamChanged = !authoringDataEqual(before, after)
    const locallyChanged = !authoringDataEqual(before, actual)
    if (!upstreamChanged && !locallyChanged) continue
    const resolution = !upstreamChanged
      ? 'local'
      : !locallyChanged
        ? 'upstream'
        : authoringDataEqual(actual, after)
          ? 'converged'
          : 'conflict'
    const destination = upstreamChanged ? after : actual
    changes.push({
      key,
      class: (destination ?? before ?? actual)?.class ?? '',
      operation: before === undefined ? 'added' : destination === undefined ? 'removed' : 'modified',
      resolution,
      ...definitionPackageImpact(before, destination),
      paths:
        resolution === 'conflict'
          ? [
              ...new Set([
                ...definitionPackageDifferencePaths(before, actual),
                ...definitionPackageDifferencePaths(before, after)
              ])
            ].sort()
          : definitionPackageDifferencePaths(before, destination)
    })
  }
  return changes
}
