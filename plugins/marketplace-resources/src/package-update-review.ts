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

import core from '@hcengineering/core'
import marketplace, {
  type DefinitionPackageChange,
  type DefinitionPackageReviewComponents,
  type PreparedDefinitionPackageUpdate
} from '@hcengineering/marketplace'
import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
import process, { authoringDataEqual } from '@hcengineering/process'

export interface PackageUpdateProperty {
  key: string
  current: unknown
  incoming: unknown
}

export interface PackageUpdateDocument {
  id: string
  label: IntlString
  class: string
  operation: DefinitionPackageChange['operation']
  properties: PackageUpdateProperty[]
}

export type PackageUpdateStatus = 'decision' | 'update' | 'preserve' | 'matches'

/** Describes the actual update decision, including the default of preserving local-only edits. */
export function packageUpdateStatus (
  change: DefinitionPackageChange,
  choice?: 'local' | 'upstream',
  blocked = false
): PackageUpdateStatus {
  if (blocked) return 'decision'
  if (choice === 'local') return 'preserve'
  if (change.resolution === 'converged') return 'matches'
  if (change.resolution === 'upstream' || change.resolution === 'merged') return 'update'
  if (choice === 'upstream') return 'update'
  if (change.resolution === 'local') return 'preserve'
  return 'decision'
}

/** Local-only edits are preserved automatically; only a missing dependency needs an explicit restore choice. */
export function packageUpdateNeedsResolution (
  change: DefinitionPackageChange,
  missingDependencies: boolean,
  blocked = false
): boolean {
  return (
    blocked ||
    (change.resolution === 'conflict' && (change.conflictPaths?.length ?? 0) > 0) ||
    (missingDependencies &&
      change.resolution === 'local' &&
      change.operation === 'removed' &&
      change.class === process.class.Process)
  )
}

/** Lists actual workspace changes and decisions, omitting definitions that remain untouched. */
export function packageUpdateVisibleChanges (
  preview: Pick<
    PreparedDefinitionPackageUpdate,
    'changes' | 'reviewComponents' | 'missingDependencies' | 'blockedChanges'
  >
): DefinitionPackageChange[] {
  return preview.changes.filter(
    (change) =>
      packageUpdateNeedsResolution(change, preview.missingDependencies, preview.blockedChanges.includes(change.key)) ||
      packageUpdateDifferences(preview.reviewComponents[change.key], 'target').length > 0
  )
}

export function packageUpdateCanApply (
  preview: Pick<PreparedDefinitionPackageUpdate, 'blocked'> | undefined,
  busy: boolean,
  loading: boolean
): boolean {
  return !busy && !loading && preview !== undefined && !preview.blocked
}

export function packageUpdateDocuments (
  reviews: Record<string, DefinitionPackageReviewComponents>,
  side: keyof DefinitionPackageReviewComponents
): Record<string, unknown>[] {
  return Object.values(reviews).flatMap((review) =>
    Object.values(review[side]?.documents ?? {}).map((item) => item.document)
  )
}

function plainLabel (document: Record<string, unknown> | undefined, fallback: string): string {
  return String(document?.title ?? document?.label ?? document?.name ?? fallback).replace(/^embedded:embedded:/, '')
}

/** Uses authored names and transition endpoints rather than generated graph identities. */
export function packageUpdateDocumentLabel (
  document: Record<string, unknown>,
  documents: readonly Record<string, unknown>[]
): IntlString {
  if (typeof document.label === 'string') return document.label as IntlString
  if (document._class === process.class.Transition) {
    const name = (id: unknown): string =>
      id === null
        ? '▶'
        : plainLabel(
            documents.find((doc) => doc._id === id),
            String(id)
          )
    return getEmbeddedLabel(`${name(document.from)} → ${name(document.to)}`)
  }
  return getEmbeddedLabel(plainLabel(document, String(document._id)))
}

/** Compares the live definition to the chosen target, or to an unresolved incoming proposal. */
export function packageUpdateDifferences (
  review: DefinitionPackageReviewComponents,
  side: 'incoming' | 'target' = 'incoming',
  conflictPaths?: readonly string[]
): PackageUpdateDocument[] {
  const current = review.local?.documents ?? {}
  const incoming = review[side]?.documents ?? {}
  const documents = [...Object.values(incoming), ...Object.values(current)].map((item) => item.document)
  return [...new Set([...Object.keys(current), ...Object.keys(incoming)])].flatMap((id) => {
    const left = current[id]
    const right = incoming[id]
    const properties = [
      ...new Set([...Object.keys(left?.document ?? {}), ...Object.keys(right?.document ?? {}), '$order'])
    ]
      .filter((key) => key !== '_id')
      .map((key) => ({
        key,
        current: key === '$order' ? left?.order : left?.document[key],
        incoming: key === '$order' ? right?.order : right?.document[key]
      }))
      .filter((property) => !authoringDataEqual(property.current, property.incoming))
      .filter(
        (property) =>
          conflictPaths === undefined ||
          conflictPaths.some((path) => {
            const propertyPath = `$.documents.${id}.${property.key === '$order' ? 'order' : 'document.' + property.key}`
            return (
              path === '$' ||
              path === propertyPath ||
              path.startsWith(propertyPath + '.') ||
              propertyPath.startsWith(path + '.')
            )
          })
      )
    if (properties.length === 0) return []
    const document = right?.document ?? left.document
    const result: PackageUpdateDocument = {
      id,
      label: packageUpdateDocumentLabel(document, documents),
      class: String(document._class),
      operation: left === undefined ? 'added' : right === undefined ? 'removed' : 'modified',
      properties
    }
    return [result]
  })
}

/** Reuses domain labels; unknown native parameters remain visible with readable names. */
export function packageUpdatePropertyLabel (key: string): IntlString {
  const labels: Record<string, IntlString> = {
    label: core.string.Name,
    name: core.string.Name,
    title: core.string.Name,
    type: marketplace.string.FieldType,
    _class: marketplace.string.FieldType,
    required: marketplace.string.Required,
    defaultValue: marketplace.string.DefaultValue,
    readonly: marketplace.string.Readonly,
    automationOnly: marketplace.string.AutomationOnly,
    hidden: marketplace.string.Hidden,
    $order: marketplace.string.DisplayOrder,
    from: process.string.From,
    to: process.string.To,
    actions: process.string.Actions,
    trigger: process.string.Trigger,
    requiredSlots: process.string.RequiredSlots,
    bindings: process.string.RequiredSlots,
    context: marketplace.string.DeclaredOutputs
  }
  return labels[key] ?? getEmbeddedLabel(key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' '))
}
