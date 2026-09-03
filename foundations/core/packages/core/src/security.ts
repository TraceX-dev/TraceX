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

import { AccountRole, type Class, type Doc, type Ref } from './classes'

/**
 * Relative ordering of `AccountRole` values, low to high.
 * @public
 */
export const roleOrder: Record<AccountRole, number> = {
  [AccountRole.ReadOnlyGuest]: 5,
  [AccountRole.DocGuest]: 10,
  [AccountRole.Guest]: 20,
  [AccountRole.User]: 30,
  [AccountRole.Maintainer]: 40,
  [AccountRole.Owner]: 50,
  [AccountRole.Admin]: 100
}

/**
 * True for any role below `AccountRole.User`.
 * @public
 */
export function isRowLevelRestricted (role: AccountRole): boolean {
  return roleOrder[role] < roleOrder[AccountRole.User]
}

/**
 * Code-declared minimum role for create, update, and remove operations.
 * @public
 */
export interface TxAccessLevel extends Class<Doc> {
  createAccessLevel?: AccountRole
  removeAccessLevel?: AccountRole
  updateAccessLevel?: AccountRole
  isIdentity?: boolean
  /** Allows non-business-data mutations required for viewer presence and UI state. */
  allowViewerWrite?: boolean
}

/**
 * Identity of the caller a row-visibility traversal starts from.
 * @public
 */
export type IdentityKind = 'accountUuid' | 'personId' | 'socialId' | 'linkId'

/**
 * Constraint applicable to a traversal step. Deliberately an enumeration rather than a free-form
 * `DocumentQuery`: the security layer must stay analysable, cacheable and explainable, none of
 * which survives arbitrary queries embedded in policies.
 * @public
 */
export type NamedConstraint = 'ordinarySpacesOnly' | 'notArchived'

/**
 * One hop of a row-visibility traversal: read `via`, keep the records whose `match` field carries
 * a value from the previous hop, and pass on their `emit` field. Array-valued `match` fields are
 * matched by containment; array-valued `emit` fields are flattened.
 * @public
 */
/**
 * The class a step reads. Normally fixed; `classFromField` names a field on the protected row
 * that holds the class instead - for rows whose parent may be of any class (`attachedToClass`).
 * Such a step can only be evaluated with the row in hand, so a policy using it applies to writes
 * and denies on read narrowing, where no single query can express it.
 * @public
 */
export type TraversalVia = Ref<Class<Doc>> | { classFromField: string }

/**
 * @public
 */
export function viaClassField (field: string): TraversalVia {
  return { classFromField: field }
}

export interface TraversalStep {
  via: TraversalVia
  match: string
  emit: string
  where?: NamedConstraint
  /** Carries the incoming values forward alongside the emitted ones. */
  keepIncoming?: boolean
}

/**
 * Longest traversal the security layer will evaluate. Every known policy, including person
 * visibility, fits in two hops. A third requires an explicit decision, not one more array element.
 * @public
 */
export const MAX_TRAVERSAL_DEPTH = 2

/**
 * A path from the caller's own identity to the documents it may see. A path with no steps is
 * plain ownership: "this field of the document equals my identity".
 * @public
 */
export interface RelationPath {
  from: IdentityKind
  steps: TraversalStep[]
  /** Field on the protected document matched against the final value set. Defaults to `_id`. */
  to?: string
  /**
   * Unions the caller's own identity values into the final set: "me, plus whoever I reach".
   * Only meaningful when `to` holds values of the same kind as `from` - person visibility, where
   * an account reaches the accounts it shares a space with and must always see itself.
   */
  includeSelf?: boolean
}

/**
 * How a class derives row-level access. `relation` covers every ownership and link-based rule;
 * the remaining kinds describe the absence of a row rule rather than a rule.
 * @public
 */
export type RowVisibilityPolicy =
  | { kind: 'relation', path: RelationPath, reason?: string }
  | { kind: 'spaceMember' }
  | { kind: 'denyAll' }
  | { kind: 'spaceScoped', reason: string }

/**
 * Row-level access policy declared on a class.
 * @public
 */
export interface RowVisibility extends Class<Doc> {
  policy: RowVisibilityPolicy
  /** Optional stricter policy for create/update/remove. Defaults to `policy`. */
  writePolicy?: RowVisibilityPolicy
  /** Enables known-reference lookup. Omitted values are treated as `false`. */
  allowKnownIdBypass?: boolean
  /** Required justification when `allowKnownIdBypass` is enabled. */
  knownIdBypassReason?: string
  /** Additional fields that count as known references. */
  knownIdBypassFields?: string[]
  /**
   * Opts this class into `GuestActivitySettings.activityScope`: restricted-role reads of an
   * `AttachedDoc` (chat message, etc.) whose `attachedToClass` is this class get narrowed to the
   * caller's own activity or activity on documents it collaborates on, per that setting - instead
   * of the attached class's own (often `spaceScoped`) policy. Set only on classes meant to be
   * "personal" documents (e.g. card.class.Card); leave unset for shared spaces like channels,
   * where every member should keep seeing all activity regardless of this setting.
   */
  scopeActivityToOwner?: boolean
}

/**
 * Activity visible to a restricted-role account on a personal document.
 * @public
 */
export enum GuestActivityScope {
  Own = 'own',
  Collaborator = 'collaborator',
  Any = 'any'
}

export enum GuestSecurityProfile {
  Viewer = 'viewer',
  Participant = 'participant',
  Advanced = 'advanced',
  Custom = 'custom'
}

/**
 * Per-role security profile and advanced activity visibility settings.
 * @public
 */
export interface GuestActivitySettings extends Doc {
  role: AccountRole
  securityProfile?: GuestSecurityProfile
  /** Activity visibility on classes that opt into this setting. */
  activityScope: GuestActivityScope
}

/**
 * Ownership: a path of length zero. `doc[field]` must equal the caller's own identity.
 * @public
 */
export function ownBy (field: string, identity: IdentityKind): RowVisibilityPolicy {
  return { kind: 'relation', path: { from: identity, steps: [], to: field } }
}

/**
 * Ownership established through a link record, optionally chained through a second class.
 * Kept as sugar over `relation` so existing model declarations read unchanged.
 * @public
 */
export function linkedViaCollaborator (
  linkClass: Ref<Class<Doc>>,
  linkTargetField: string,
  linkIdentityField: string,
  identity: IdentityKind,
  options?: {
    targetField?: string
    through?: {
      documentClass: Ref<Class<Doc>>
      sourceField: string
      targetField: string
      includeDirect?: boolean
    }
  }
): RowVisibilityPolicy {
  const steps: TraversalStep[] = [{ via: linkClass, match: linkIdentityField, emit: linkTargetField }]
  const through = options?.through
  if (through !== undefined) {
    steps.push({
      via: through.documentClass,
      match: through.sourceField,
      emit: through.targetField,
      keepIncoming: through.includeDirect
    })
  }
  return { kind: 'relation', path: { from: identity, steps, to: options?.targetField ?? '_id' } }
}

/**
 * Builds an arbitrary traversal. Prefer `ownBy`/`linkedViaCollaborator` where they fit.
 * @public
 */
export function relatedVia (path: RelationPath, reason?: string): RowVisibilityPolicy {
  return { kind: 'relation', path, reason }
}

export function spaceScoped (reason: string): RowVisibilityPolicy {
  return { kind: 'spaceScoped', reason }
}

/**
 * Validates a policy at model-build time. Returns the problems found, empty when the policy is
 * well formed.
 * @public
 */
export function validateRowVisibilityPolicy (policy: RowVisibilityPolicy): string[] {
  if (policy.kind !== 'relation') return []
  const problems: string[] = []
  const { steps, to } = policy.path
  if (steps.length > MAX_TRAVERSAL_DEPTH) {
    problems.push(`traversal depth ${steps.length} exceeds MAX_TRAVERSAL_DEPTH (${MAX_TRAVERSAL_DEPTH})`)
  }
  steps.forEach((step, index) => {
    if (step.match === '') problems.push(`step ${index}: empty match field`)
    if (step.emit === '') problems.push(`step ${index}: empty emit field`)
    if (typeof step.via !== 'string' && step.via.classFromField === '') {
      problems.push(`step ${index}: empty classFromField`)
    }
  })
  if (steps.some((step) => typeof step.via !== 'string') && policy.path.includeSelf === true) {
    problems.push('includeSelf cannot combine with a document-relative step')
  }
  if (to === '') problems.push('empty target field')
  return problems
}
